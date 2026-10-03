import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { InvitationAuthorization, invitationMetadataColumns } from '../src/services/InvitationAuthorization.js';
import { ProjectInvitationEmailService, invitationSecretColumns, invitationTokenMatches } from '../src/services/ProjectInvitationEmailService.js';
import { emailConfiguration, invitationEmailFailure, projectInvitationMessage, ResendEmailTransport } from '../src/services/ResendEmailTransport.js';
import { createInvitationEmailHandler } from '../src/server/invitationEmailHandler.js';
import { ProjectService } from '../src/services/ProjectService.js';

const invitationId = '10000000-0000-4000-8000-000000000001';
const projectId = '20000000-0000-4000-8000-000000000002';
const actorId = '30000000-0000-4000-8000-000000000003';
const now = Date.UTC(2026, 9, 2);
const config = { apiKey: 'mock-provider-key', from: 'D.A.O <test@example.invalid>', publicUrl: 'https://staging.example.invalid' };

function fixture() {
  const token = randomBytes(32).toString('hex');
  const invitation: any = {
    id: invitationId, project_id: projectId, created_by: actorId, expected_role: 'contractor',
    recipient_email: 'recipient@example.invalid', recipient_name: 'Artisan Test', principal_request_id: '40000000-0000-4000-8000-000000000004', status: 'pending', expires_at: new Date(now + 7 * 86400_000).toISOString(),
    accepted_at: null, revoked_at: null, declined_at: null,
    token_hash: createHash('sha256').update(token, 'utf8').digest('hex'),
  };
  const project: any = { id: projectId, status: 'draft', client_id: actorId, initiator_id: actorId, project_origin: 'client_existing_contractor' };
  const team: any = { can_prepare: true, is_client: true };
  const events: string[] = [];
  const delivered: any[] = [];
  const reads: any[] = [];
  let visible = true;
  let secretTransform = (value: any) => value;
  let transportError = false;
  let configuration = () => config;
  const db = {
    from(table: string) {
      return { select(columns: string) { return { eq(column: string, id: string) { return { async maybeSingle() {
        events.push(`jwt:${table}`); reads.push({ table, columns, column, id });
        return { data: table === 'projects' ? { ...project } : visible ? Object.fromEntries(columns.split(',').map(key => [key, invitation[key]])) : null, error: null };
      } }; } }; } };
    },
    async rpc(name: string, args: any) {
      events.push(`rpc:${name}`);
      if (name === 'project_team') return { data: { ...team }, error: null };
      if (name === 'preview_project_invitation') return { data: { project_id: projectId, title: '<Chantier & équipe>', inviter_name: 'Client <test>', location: 'Sousse · Sahloul', lots: [{ title: 'Lot plomberie' }], private_address: 'Must never leave RPC' }, error: null };
      return { data: {}, error: null };
    },
  };
  const authorization = new InvitationAuthorization(db);
  const service = new ProjectInvitationEmailService(authorization, async id => {
    events.push('secret:invitation'); assert.equal(id, invitationId);
    return secretTransform({ ...invitation });
  }, { async sendProjectInvitationEmail(input, settings) {
    events.push('provider');
    if (transportError) throw new Error('unsafe provider response');
    delivered.push({ input, settings });
  } }, () => configuration(), () => now);
  const handler = createInvitationEmailHandler(service, async header => header === 'Bearer fixture' ? { id: actorId } : null);
  async function send(body: any = { token }, authenticated = true) {
    return handler(new Request('http://localhost/api/project-invitations/' + invitationId + '/send-email', {
      method: 'POST', headers: { 'content-type': 'application/json', ...(authenticated ? { authorization: 'Bearer fixture' } : {}) }, body: JSON.stringify(body),
    }), invitationId);
  }
  return { token, invitation, project, team, db, authorization, service, events, reads, delivered, send,
    invisible: () => { visible = false; }, secret: (fn: typeof secretTransform) => { secretTransform = fn; },
    fail: (value: boolean) => { transportError = value; }, config: (fn: typeof configuration) => { configuration = fn; } };
}

test('email authentication and canonical authorization precede any secret read', async t => {
  await t.test('anonymous request', async () => {
    const f = fixture(); assert.equal((await f.send(undefined, false)).status, 401); assert.deepEqual(f.events, []);
  });
  for (const label of ['outside RLS', 'contractor member', 'staff with visibility']) await t.test(label, async () => {
    const f = fixture();
    if (label === 'outside RLS') f.invisible();
    else { f.team.can_prepare = false; f.team.is_client = false; }
    assert.equal((await f.send()).status, 403); assert.equal(f.events.includes('secret:invitation'), false); assert.equal(f.delivered.length, 0);
  });
  await t.test('authorized client', async () => {
    const f = fixture(); const result = await f.send(); assert.equal(result.status, 200);
    assert.deepEqual(f.events.slice(0, 4), ['jwt:project_invitations', 'rpc:project_team', 'jwt:projects', 'secret:invitation']);
    assert.equal(f.reads[0].columns.includes('token_hash'), false);
    assert.equal(f.delivered[0].input.to, f.invitation.recipient_email);
    assert.equal(f.delivered[0].input.recipientName, f.invitation.recipient_name);
    assert.equal(f.delivered[0].input.location, 'Sousse · Sahloul');
    assert.equal(f.delivered[0].input.principalLot, 'Lot plomberie');
    assert.equal(f.delivered[0].input.expectedRole, 'contractor');
    assert.equal(f.delivered[0].input.url === `${config.publicUrl}/invite/${f.token}`, true);
    const body = await result.text();
    assert.equal(body.includes(f.token) || body.includes(f.invitation.token_hash), false);
    assert.deepEqual(JSON.parse(body), { data: { sent: true, recipient_masked: 'r***@example.invalid' } });
    assert.equal(result.headers.get('cache-control'), 'no-store');
  });
  await t.test('contractor initiator remains contractor', async () => {
    const f = fixture(); f.team.is_client = false; f.project.client_id = null; f.project.project_origin = 'contractor_existing_client'; f.invitation.expected_role = 'client';
    assert.equal((await f.send()).status, 200); assert.equal(f.project.client_id, null);
  });
  await t.test('preparer cannot manage an invitation created by another initiator', async () => {
    const f = fixture(); f.team.is_client = false; f.invitation.created_by = 'another';
    assert.equal((await f.send()).status, 403); assert.equal(f.events.includes('secret:invitation'), false);
  });
});

test('issuance, revocation and email use the shared invitation authorization', async () => {
  const f = fixture(); const projects = new ProjectService(f.db);
  await projects.issueInvitation({ project_id: projectId, expected_role: 'contractor', recipient_email: 'recipient@example.invalid', request_id: f.invitation.principal_request_id }, actorId);
  await projects.revokeInvitation(invitationId, actorId);
  assert.equal((await f.send()).status, 200);
  f.team.can_prepare = false;
  await assert.rejects(projects.issueInvitation({ project_id: projectId, expected_role: 'contractor' }, actorId), (e: any) => e.code === 'FORBIDDEN');
  await assert.rejects(projects.revokeInvitation(invitationId, actorId), (e: any) => e.code === 'FORBIDDEN');
  assert.equal((await f.send()).status, 403);
  assert.equal(f.events.filter(e => e === 'rpc:issue_project_invitation').length, 1);
  assert.equal(f.events.filter(e => e === 'rpc:revoke_project_invitation').length, 1);
  const pro = fixture(); pro.team.is_client = false; pro.project.client_id = null; pro.project.project_origin = 'contractor_existing_client';
  await pro.authorization.issuance(actorId, projectId, 'client');
  await assert.rejects(pro.authorization.issuance(actorId, projectId, 'contractor'));
  pro.project.client_id = 'confirmed-client'; await assert.rejects(pro.authorization.issuance(actorId, projectId, 'client'));
});

test('token comparison uses SHA-256 UTF-8 and refuses mismatches generically', async () => {
  const f = fixture();
  assert.equal(invitationTokenMatches(f.token, createHash('sha256').update(f.token, 'utf8').digest('hex')), true);
  assert.equal(invitationTokenMatches(randomBytes(32).toString('hex'), f.invitation.token_hash), false);
  assert.equal(invitationTokenMatches(f.token, 'not a hash'), false);
  assert.equal(invitationTokenMatches('', f.invitation.token_hash), false);
  const response = await f.send({ token: randomBytes(32).toString('hex') });
  assert.equal(response.status, 403); assert.deepEqual(await response.json(), { error: 'Invitation indisponible.' }); assert.equal(f.delivered.length, 0);
});

test('invalid invitation lifecycle is refused before privileged reads', async t => {
  const changes = [
    { status: 'accepted' }, { status: 'revoked' }, { status: 'declined' },
    { expires_at: new Date(now).toISOString() }, { expires_at: 'invalid' },
    { accepted_at: new Date(now).toISOString() }, { revoked_at: new Date(now).toISOString() }, { declined_at: new Date(now).toISOString() },
    { expected_role: 'dao_admin' },
  ];
  for (const [index, change] of changes.entries()) await t.test(`state ${index}`, async () => {
    const f = fixture(); Object.assign(f.invitation, change);
    assert.equal((await f.send()).status, 409); assert.equal(f.events.includes('secret:invitation'), false);
  });
  const archived = fixture(); archived.project.status = 'archived';
  assert.equal((await archived.send()).status, 409); assert.equal(archived.events.includes('secret:invitation'), false);
});

test('secret snapshot revalidates ID, project, creator, role and lifecycle', async t => {
  for (const change of [{ id: 'other' }, { project_id: 'other' }, { created_by: 'other' }, { expected_role: 'client' }, { status: 'accepted' }, { expires_at: new Date(now - 1).toISOString() }, { declined_at: new Date(now).toISOString() }]) {
    await t.test(Object.keys(change)[0], async () => {
      const f = fixture(); f.secret(value => ({ ...value, ...change }));
      assert.equal((await f.send()).status, 409); assert.equal(f.delivered.length, 0);
    });
  }
  assert.deepEqual(invitationSecretColumns.split(',').sort(), [...invitationMetadataColumns.split(','), 'recipient_name', 'token_hash'].sort());
});

test('body cannot inject recipient or any arbitrary email parameter', async () => {
  const f = fixture();
  for (const body of [{ token: f.token, recipient_email: 'attacker@example.invalid' }, { token: f.token, url: 'https://attacker.invalid' }, { token: f.token, expected_role: 'client' }, { token: 'malformed' }, null, []]) {
    assert.equal((await f.send(body)).status, 400);
  }
  assert.equal(f.events.length, 0);
  f.invitation.recipient_email = 'db-only@example.invalid'; assert.equal((await f.send()).status, 200); assert.equal(f.delivered[0].input.to, 'db-only@example.invalid');
  f.invitation.recipient_email = null; assert.equal((await f.send()).status, 409);
});

test('provider errors are sanitized and retry never changes or recreates the invitation', async t => {
  const logs = ['log', 'warn', 'error'].map(method => t.mock.method(console, method as 'log', () => {}));
  const f = fixture(); const before = JSON.stringify(f.invitation);
  f.fail(true); const failure = await f.send(); assert.equal(failure.status, 502); assert.deepEqual(await failure.json(), { error: invitationEmailFailure });
  assert.equal(JSON.stringify(f.invitation) === before, true);
  f.fail(false); assert.equal((await f.send()).status, 200);
  assert.equal(JSON.stringify(f.invitation) === before, true);
  assert.equal(f.events.some(e => /issue|revoke|respond/.test(e)), false);
  assert.equal(Object.keys(f.invitation).includes('token'), false);
  assert.equal(f.delivered.length, 1);
  assert.equal(logs.every(log => log.mock.callCount() === 0), true, 'The email path must not log tokens, payloads or provider errors');
});

test('server email configuration validates origin and exposes no environment names on failure', async () => {
  const valid = { RESEND_API_KEY: 'mock-key', DAO_EMAIL_FROM: 'test@example.invalid', DAO_PUBLIC_URL: 'https://prod.example.invalid/' };
  assert.equal(emailConfiguration(valid).publicUrl, 'https://prod.example.invalid');
  assert.equal(emailConfiguration({ ...valid, DAO_EMAIL_FROM: 'D.A.O <test@example.invalid>' }).from, 'D.A.O <test@example.invalid>');
  assert.equal(emailConfiguration({ ...valid, DAO_PUBLIC_URL: 'http://127.0.0.1:3000' }).publicUrl, 'http://127.0.0.1:3000');
  for (const bad of [{ RESEND_API_KEY: '' }, { DAO_EMAIL_FROM: '' }, { DAO_EMAIL_FROM: 'a@example.invalid,b@example.invalid' }, { DAO_PUBLIC_URL: '' }, ...['http://prod.example.invalid', 'javascript:alert(1)', 'https://user:password@prod.example.invalid', 'https://prod.example.invalid/path', 'https://prod.example.invalid/?key=value', 'https://prod.example.invalid/#fragment'].map(DAO_PUBLIC_URL => ({ DAO_PUBLIC_URL }))]) {
    const f = fixture(); f.config(() => emailConfiguration({ ...valid, ...bad }));
    const response = await f.send(); assert.equal(response.status, 503);
    const text = await response.text(); assert.equal(/RESEND|DAO_|mock-key|password/.test(text), false);
    assert.equal(f.events.includes('secret:invitation'), false);
  }
});

test('HTML and plain text are branded, responsive, safe and keep the raw URL out of visible HTML', () => {
  const input = {
    to: 'db@example.invalid',
    recipientName: 'Artisan <test>',
    inviterName: '<img src=x onerror=alert(1)>',
    title: 'Chantier <script>&"',
    location: 'Sousse · Sahloul',
    principalLot: 'Lot plomberie',
    expectedRole: 'contractor' as const,
    url: 'https://prod.example.invalid/invite/opaque',
    expiresAt: new Date(now + 7 * 86400_000).toISOString(),
    invitationId,
  };
  const message = projectInvitationMessage(input, config.from);
  assert.equal(message.subject, 'Invitation à rejoindre un chantier sur D.A.O');
  assert.deepEqual(message.to, ['db@example.invalid']);
  assert.equal(message.html.includes('<img') || message.html.includes('<script>'), false);
  assert.ok(message.html.includes('&lt;img') && message.html.includes('&amp;'));
  assert.ok(message.html.includes('Transparence · Précision · Confiance'));
  assert.ok(message.html.includes('Artisan / Entreprise'));
  assert.ok(message.html.includes('Sousse · Sahloul'));
  assert.ok(message.html.includes('en quelques secondes'));
  assert.ok(message.html.includes(`href="${input.url}"`));
  assert.equal(message.html.includes(`>${input.url}<`), false, 'The raw invitation URL must not be visible in HTML');
  assert.ok(message.text.includes(input.url), 'Plain text keeps the fallback URL');
  for (const body of [message.html, message.text]) { assert.ok(body.includes('7 jours')); assert.ok(body.includes('seule fois')); }
});

test('Resend stable idempotency allows retry before acceptance and never caches failures', async () => {
  const calls: any[] = []; let attempts = 0;
  const request = (async (url: any, init: any) => {
    calls.push({ url, init }); attempts++;
    if (attempts === 1) throw new Error('failure before acceptance');
    if (attempts === 2) return Response.json({ message: 'unsafe error' }, { status: 503 });
    return Response.json({ id: 'mock-accepted-id' });
  }) as typeof fetch;
  const transport = new ResendEmailTransport(request);
  const input = { to: 'db@example.invalid', recipientName: 'Artisan test', inviterName: 'Client test', title: 'Chantier test', location: 'Sousse', principalLot: 'Lot plomberie', expectedRole: 'contractor' as const, url: 'https://prod.example.invalid/invite/opaque', expiresAt: new Date(now + 7 * 86400_000).toISOString(), invitationId };
  for (let i = 0; i < 2; i++) await assert.rejects(transport.sendProjectInvitationEmail(input, config), (e: any) => e.code === 'EMAIL_DELIVERY' && e.message === invitationEmailFailure);
  await transport.sendProjectInvitationEmail(input, config);
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.url, 'https://api.resend.com/emails'); assert.equal(call.init.method, 'POST');
    assert.equal(call.init.headers['Idempotency-Key'], `project-invitation-email/${invitationId}`);
    const payload = JSON.parse(call.init.body); assert.ok(payload.html && payload.text); assert.deepEqual(payload.to, ['db@example.invalid']);
  }
  assert.equal(calls.every(call => call.init.body === calls[0].init.body), true);
});

test('all provider HTTP failures and malformed success responses return a clean error', async () => {
  const input = { to: 'db@example.invalid', recipientName: null, inviterName: 'Client', title: 'Chantier', location: null, principalLot: null, expectedRole: 'client' as const, url: 'https://prod.example.invalid/invite/opaque', expiresAt: new Date(now + 7 * 86400_000).toISOString(), invitationId };
  for (const status of [400, 401, 403, 409, 429, 500, 503, 200]) {
    const transport = new ResendEmailTransport((async () => Response.json({ message: 'provider secret/details', id: null }, { status })) as typeof fetch);
    await assert.rejects(transport.sendProjectInvitationEmail(input, config), (e: any) => e.code === 'EMAIL_DELIVERY' && !e.message.includes('provider'));
  }
});
