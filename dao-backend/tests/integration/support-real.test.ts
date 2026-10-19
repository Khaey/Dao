import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createSupportApi } from '../../src/server/runtime.js';

test('support center: real JWT isolation, staff lifecycle and append-only history', async t => {
  const url = process.env.DAO_SUPABASE_URL!;
  assert.equal(url, 'http://127.0.0.1:54321', 'Disposable local stack only');
  const publishable = process.env.DAO_SUPABASE_PUBLISHABLE_KEY!;
  const secret = process.env.DAO_SUPABASE_SECRET_KEY!;
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, secret, options);
  const anon = createClient(url, publishable, options);
  const actors: Record<string, { id: string; db: any }> = {};

  async function actor(name: string, roles: string[]) {
    const email = `support-${name}-${randomUUID()}@example.invalid`;
    const password = `Support!${randomUUID()}`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.ifError(created.error);
    const id = created.data.user!.id;
    assert.ifError((await admin.from('profiles').insert({ user_id: id, display_name: `Support ${name}` })).error);
    for (const role of roles) assert.ifError((await admin.from('user_roles').insert({ user_id: id, role })).error);
    const auth = createClient(url, publishable, options);
    const signed = await auth.auth.signInWithPassword({ email, password });
    assert.ifError(signed.error);
    const db = createClient(url, publishable, { ...options, global: { headers: { Authorization: `Bearer ${signed.data.session!.access_token}` } } });
    actors[name] = { id, db };
  }
  async function rpc(db: any, name: string, input: Record<string, unknown> = {}) {
    const response = await db.rpc(name, input);
    assert.ifError(response.error);
    return response.data;
  }
  async function denied(db: any, name: string, input: Record<string, unknown> = {}) {
    const response = await db.rpc(name, input);
    assert.ok(response.error, `${name} must deny access`);
    return response.error;
  }

  await actor('client-a', ['client']);
  await actor('client-b', ['client']);
  await actor('contractor', ['contractor']);
  await actor('dual', ['client', 'contractor']);
  await actor('reviewer', ['dao_reviewer']);
  await actor('admin', ['dao_admin']);
  await actor('suspended', ['client']);
  assert.ifError((await admin.from('account_states').insert({ user_id: actors.suspended.id, status: 'suspended' })).error);
  const [clientA, clientB, contractor, dual, reviewer, operator, suspended] =
    ['client-a', 'client-b', 'contractor', 'dual', 'reviewer', 'admin', 'suspended'].map(name => actors[name]);

  const create = (db: any, key = randomUUID(), extra: Record<string, unknown> = {}) => rpc(db, 'create_support_ticket', {
    p_subject: 'Synthetic support request', p_category: 'technical', p_body: 'Synthetic body',
    p_project_id: null, p_origin_route: '/app/messages', p_origin_faq_id: 'messages-help', p_idempotency_key: key, ...extra,
  });

  await t.test('anonymous, invalid JWT, suspended and direct table access fail closed', async () => {
    await denied(anon, 'my_support_summary');
    await denied(anon, 'create_support_ticket', { p_subject: 'Anonymous', p_category: 'other', p_body: 'No', p_idempotency_key: randomUUID() });
    const invalid = createClient(url, publishable, { ...options, global: { headers: { Authorization: 'Bearer forged.jwt.invalid' } } });
    await denied(invalid, 'my_support_summary');
    await denied(suspended.db, 'my_support_summary');
    await denied(suspended.db, 'create_support_ticket', { p_subject: 'Suspended', p_category: 'other', p_body: 'No', p_idempotency_key: randomUUID() });
    for (const table of ['support_tickets', 'support_messages', 'support_events', 'support_command_receipts']) {
      assert.ok((await clientA.db.from(table).select('*')).error, `${table} must not be browser-readable directly`);
      assert.ok((await clientA.db.from(table).insert({})).error, `${table} must not be browser-writable directly`);
    }
  });

  let ticketId = '';
  await t.test('creation is actor-derived, idempotent and isolated from other users', async () => {
    const key = randomUUID();
    const first = await create(clientA.db, key);
    const replay = await create(clientA.db, key);
    assert.deepEqual(replay, first);
    ticketId = first.id;
    assert.match(first.reference, /^AS-\d{6}$/);
    assert.equal((await rpc(clientA.db, 'list_my_support_tickets')).length, 1);
    assert.deepEqual(await rpc(clientB.db, 'list_my_support_tickets'), []);
    await denied(clientB.db, 'get_support_ticket', { p_ticket_id: ticketId });
    await denied(clientB.db, 'reply_support_ticket', { p_ticket_id: ticketId, p_body: 'Forged', p_idempotency_key: randomUUID() });
    await denied(clientB.db, 'mark_support_ticket_read', { p_ticket_id: ticketId });
    await denied(clientB.db, 'support_queue');
    const stored = await admin.from('support_tickets').select('requester_id,origin_route,origin_faq_id').eq('id', ticketId).single();
    assert.ifError(stored.error);
    assert.deepEqual(stored.data, { requester_id: clientA.id, origin_route: '/app/messages', origin_faq_id: 'messages-help' });
  });

  await t.test('client, contractor and dual-role accounts keep separate personal tickets', async () => {
    await create(contractor.db);
    await create(dual.db);
    assert.equal((await rpc(contractor.db, 'list_my_support_tickets')).length, 1);
    assert.equal((await rpc(dual.db, 'list_my_support_tickets')).length, 1);
    assert.equal((await rpc(clientA.db, 'list_my_support_tickets')).length, 1);
  });

  await t.test('reviewer/admin queue is separate and lifecycle is audited', async () => {
    const queue = await rpc(reviewer.db, 'support_queue', { p_status: 'open', p_assignee: 'all' });
    const unassigned = queue.find((item: any) => item.id === ticketId);
    assert.ok(unassigned);
    assert.equal(unassigned.assignee_label, null, 'an unassigned ticket must not receive the DAO team fallback label');
    await rpc(reviewer.db, 'assign_support_ticket_to_me', { p_ticket_id: ticketId });
    const key = randomUUID();
    const [one, two] = await Promise.all([1, 2].map(() => rpc(reviewer.db, 'reply_support_ticket', {
      p_ticket_id: ticketId, p_body: 'Staff response', p_idempotency_key: key,
    })));
    assert.deepEqual(one, two, 'concurrent replay must converge');
    await rpc(operator.db, 'set_support_ticket_status', { p_ticket_id: ticketId, p_status: 'resolved', p_reason: 'Synthetic resolution' });
    await rpc(operator.db, 'set_support_ticket_status', { p_ticket_id: ticketId, p_status: 'closed', p_reason: 'Synthetic closure' });
    await denied(clientA.db, 'reply_support_ticket', { p_ticket_id: ticketId, p_body: 'Too late', p_idempotency_key: randomUUID() });
    const messages = await admin.from('support_messages').select('id').eq('ticket_id', ticketId);
    const events = await admin.from('support_events').select('event_type').eq('ticket_id', ticketId);
    assert.ifError(messages.error); assert.ifError(events.error);
    assert.equal(messages.data!.length, 2);
    assert.deepEqual(events.data!.map(row => row.event_type).sort(), ['assigned', 'created', 'replied', 'status_changed', 'status_changed'].sort());
    assert.ok((await admin.from('support_messages').update({ body: 'tampered' }).eq('ticket_id', ticketId)).error);
    assert.ok((await admin.from('support_events').delete().eq('ticket_id', ticketId)).error);
  });

  await t.test('project association is live-authorized and a revoked session is refused', async () => {
    const project = await admin.from('projects').insert({ client_id: clientA.id }).select('id').single();
    assert.ifError(project.error);
    await create(clientA.db, randomUUID(), { p_project_id: project.data!.id });
    await denied(clientB.db, 'create_support_ticket', {
      p_subject: 'Forged project link', p_category: 'project', p_body: 'No', p_project_id: project.data!.id,
      p_origin_route: null, p_origin_faq_id: null, p_idempotency_key: randomUUID(),
    });
    const revokedEmail = `support-revoked-${randomUUID()}@example.invalid`;
    const revokedPassword = `Support!${randomUUID()}`;
    const revoked = await admin.auth.admin.createUser({ email: revokedEmail, password: revokedPassword, email_confirm: true });
    assert.ifError(revoked.error);
    const revokedAuth = createClient(url, publishable, options);
    const revokedLogin = await revokedAuth.auth.signInWithPassword({ email: revokedEmail, password: revokedPassword });
    assert.ifError(revokedLogin.error);
    const staleToken = revokedLogin.data.session!.access_token;
    assert.ifError((await admin.auth.admin.deleteUser(revoked.data.user!.id)).error);
    const request = new Request('http://dao.test/api/support/summary', { headers: { Authorization: `Bearer ${staleToken}` } });
    const response = await createSupportApi(request).summary(request);
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, 'unauthenticated');
  });
});
