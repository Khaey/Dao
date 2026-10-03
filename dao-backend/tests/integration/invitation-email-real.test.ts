import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createInvitationEmailApi } from '../../src/server/runtime.js';
import { ProjectService } from '../../src/services/ProjectService.js';
import { invitationSecretColumns } from '../../src/services/ProjectInvitationEmailService.js';

test('invitation email: production handler, real JWT/RLS and mocked Resend without writes', async t => {
  const url = process.env.DAO_SUPABASE_URL;
  assert.equal(url, 'http://127.0.0.1:54321', 'Email integration requires disposable local Supabase');
  const key = process.env.DAO_SUPABASE_PUBLISHABLE_KEY!, secret = process.env.DAO_SUPABASE_SECRET_KEY!;
  assert.ok(key && secret);
  const admin = createClient(url!, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const suffix = randomUUID(); const password = randomBytes(24).toString('base64url') + '-A9!';
  async function command(db: any, name: string, args: any) {
    const result = await db.rpc(name, args);
    assert.equal(Boolean(result.error), false, `${name} must succeed`);
    return result.data;
  }
  async function actor(label: string, role: 'client' | 'contractor') {
    const email = `email-test-${label}-${suffix}@example.invalid`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.equal(Boolean(created.error), false, 'Disposable Auth account must be created');
    const auth = createClient(url!, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const signed = await auth.auth.signInWithPassword({ email, password });
    assert.equal(Boolean(signed.error), false, 'Disposable Auth account must sign in');
    const jwt = signed.data.session!.access_token;
    const db = createClient(url!, key, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false, autoRefreshToken: false } });
    await command(db, 'initialize_my_account', { p_display_name: `Test ${label}`, p_phone_e164: null, p_account_type: role, p_business_name: role === 'contractor' ? 'Atelier test' : null });
    return { id: created.data.user!.id, email, jwt, db };
  }
  const owner = await actor('owner', 'client'), outside = await actor('outside', 'client');
  const pro = await actor('initiator', 'contractor'), member = await actor('member', 'contractor');
  const region = await admin.from('governorates').select('id').eq('code', 'E2E_TEST').single(); assert.ifError(region.error);
  const trade = await admin.from('trades').select('id').eq('code', 'plumbing').single(); assert.ifError(trade.error);
  const create = (db: any, origin: string) => command(db, 'create_collaborative_project', {
    p_origin: origin, p_title: 'Chantier email <test>', p_description: 'Description publique', p_governorate_id: region.data!.id,
    p_delegation_id: null, p_locality_id: null, p_stage: 'in_progress', p_payment_status: 'partial',
  });
  const project = await create(owner.db, 'client_existing_team');
  const invite = async (actor: typeof owner, projectId = project.id, role = 'contractor', email = member.email) => {
    let requestId: string | null = null;
    if (role === 'contractor') {
      const lot = await command(actor.db, 'add_project_request', {
        p_project_id: projectId,
        p_trade_id: trade.data!.id,
        p_title: 'Lot email ' + randomUUID(),
        p_scope: 'Lot principal pour invitation e-mail',
        p_budget_millimes: 1000,
      });
      requestId = lot.id;
    }
    return new ProjectService(actor.db).issueInvitation({
      project_id: projectId,
      expected_role: role,
      recipient_email: email,
      request_id: requestId,
      can_view_private_details: false,
    }, actor.id);
  };
  const invitation = await invite(owner);
  const memberInvite = await invite(owner);
  await command(member.db, 'respond_project_invitation', { p_token: memberInvite.token, p_accept: true });
  const environment = { NEXT_PUBLIC_SUPABASE_URL: url!, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key, RESEND_API_KEY: 'mock-only-no-live-email', DAO_EMAIL_FROM: 'D.A.O <test@example.invalid>', DAO_PUBLIC_URL: 'https://ci.example.invalid' };
  const previous = Object.fromEntries(Object.keys(environment).map(name => [name, process.env[name]]));
  Object.assign(process.env, environment);
  const originalFetch = globalThis.fetch;
  const privilegedReads: any[] = [], deliveries: any[] = [], requestOrder: string[] = [];
  let failProvider = false;
  globalThis.fetch = async (input, init) => {
    const target = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (target.origin === 'https://api.resend.com') {
      requestOrder.push('provider'); deliveries.push({ body: JSON.parse(String(init?.body)), key: new Headers(init?.headers).get('Idempotency-Key') });
      return failProvider ? Response.json({ message: 'unsafe provider details' }, { status: 503 }) : Response.json({ id: 'mock-accepted' });
    }
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    if (target.pathname === '/auth/v1/user') requestOrder.push('verify-jwt');
    if (target.pathname === '/rest/v1/rpc/project_team') requestOrder.push('jwt-authority');
    if (target.pathname === '/rest/v1/project_invitations' && headers.get('apikey') === secret) {
      requestOrder.push('secret-read');
      privilegedReads.push({ method: init?.method || 'GET', id: target.searchParams.get('id'), columns: target.searchParams.get('select') });
    }
    return originalFetch(input, init);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    // The complete Supabase stack is disposable and destroyed by CI; no DEV data.
  });
  async function send(actor: typeof owner | null, invitation: any, body: any = { token: invitation.token }) {
    const request = new Request('http://localhost/api/project-invitations/' + invitation.id + '/send-email', {
      method: 'POST', headers: { 'content-type': 'application/json', ...(actor ? { authorization: 'Bearer ' + actor.jwt } : {}) }, body: JSON.stringify(body),
    });
    return createInvitationEmailApi(request)(request, invitation.id);
  }
  async function snapshot() {
    const result = await admin.from('project_invitations').select('id,token_hash,expires_at,status').eq('project_id', project.id).order('id');
    assert.ifError(result.error); return JSON.stringify(result.data);
  }
  await t.test('anonymous, outside and ordinary member are refused before secret lookup', async () => {
    for (const actor of [null, outside, member]) {
      const before = privilegedReads.length;
      assert.equal((await send(actor, invitation)).status, actor ? 403 : 401);
      assert.equal(privilegedReads.length, before);
    }
    const forbiddenHash = await owner.db.from('project_invitations').select('token_hash').eq('id', invitation.id);
    assert.ok(forbiddenHash.error, 'Authenticated clients cannot select the hash');
    await assert.rejects(new ProjectService(member.db).issueInvitation({ project_id: project.id, expected_role: 'contractor' }, member.id));
    await assert.rejects(new ProjectService(member.db).revokeInvitation(invitation.id, member.id));
  });
  await t.test('authorized owner, DB recipient, provider failure and retry preserve the same invitation', async () => {
    const before = await snapshot(); const countBefore = deliveries.length;
    assert.equal((await send(owner, invitation, { token: invitation.token, recipient_email: outside.email })).status, 400);
    assert.equal((await send(owner, invitation, { token: randomBytes(32).toString('hex') })).status, 403);
    assert.equal(deliveries.length, countBefore);
    requestOrder.length = 0; failProvider = true;
    const failure = await send(owner, invitation); assert.equal(failure.status, 502);
    assert.equal((await failure.text()).includes('unsafe'), false);
    assert.equal((await snapshot()) === before, true, 'Failed delivery must not mutate invitations');
    failProvider = false; const success = await send(owner, invitation); assert.equal(success.status, 200);
    const response = await success.text();
    assert.equal(response.includes(invitation.token) || response.includes('token_hash'), false);
    assert.equal((await snapshot()) === before, true, 'Accepted delivery must not mutate invitations');
    assert.ok(requestOrder.indexOf('verify-jwt') < requestOrder.indexOf('jwt-authority'));
    assert.ok(requestOrder.indexOf('jwt-authority') < requestOrder.indexOf('secret-read'));
    const attempts = deliveries.slice(countBefore);
    assert.equal(attempts.length, 2); assert.equal(attempts[0].key, attempts[1].key);
    assert.equal(JSON.stringify(attempts[0].body) === JSON.stringify(attempts[1].body), true);
    for (const delivery of attempts) {
      assert.deepEqual(delivery.body.to, [member.email]);
      assert.ok(delivery.body.html && delivery.body.text);
      assert.equal(delivery.body.text.includes(`${environment.DAO_PUBLIC_URL}/invite/${invitation.token}`), true);
      assert.equal(delivery.body.text.includes('Description publique'), false);
    }
    // Ignore this test's own explicit admin snapshot reads, which select no metadata.
    for (const read of privilegedReads.filter(read => read.columns === invitationSecretColumns)) {
      assert.equal(read.method, 'GET'); assert.equal(read.id, `eq.${invitation.id}`);
    }
    assert.ok(privilegedReads.some(read => read.columns === invitationSecretColumns));
  });
  await t.test('real accepted/revoked/declined/expired invitations cannot be sent', async () => {
    const accepted = memberInvite;
    const revoked = await invite(owner); await new ProjectService(owner.db).revokeInvitation(revoked.id, owner.id);
    const declined = await invite(owner); await command(member.db, 'respond_project_invitation', { p_token: declined.token, p_accept: false });
    const expired = await invite(owner);
    const changed = await admin.from('project_invitations').update({ created_at: '2026-01-01T00:00:00Z', expires_at: '2026-01-02T00:00:00Z' }).eq('id', expired.id); assert.ifError(changed.error);
    for (const value of [accepted, revoked, declined, expired]) {
      const reads = privilegedReads.length, count = deliveries.length;
      assert.equal((await send(owner, value)).status, 409); assert.equal(privilegedReads.length, reads); assert.equal(deliveries.length, count);
    }
  });
  await t.test('contractor initiator uses the same RPC authorization and remains contractor', async () => {
    const chantier = await create(pro.db, 'contractor_existing_client');
    const invitation = await invite(pro, chantier.id, 'client', owner.email);
    assert.equal((await send(pro, invitation)).status, 200);
    const current = await admin.from('projects').select('client_id,initiator_id').eq('id', chantier.id).single(); assert.ifError(current.error);
    assert.equal(current.data!.client_id, null); assert.equal(current.data!.initiator_id, pro.id);
    const roles = await admin.from('user_roles').select('role').eq('user_id', pro.id); assert.ifError(roles.error); assert.deepEqual(roles.data!.map(value => value.role), ['contractor']);
    await assert.rejects(new ProjectService(pro.db).issueInvitation({ project_id: chantier.id, expected_role: 'contractor' }, pro.id));
  });
});
