import test from 'node:test';
import assert from 'node:assert/strict';
import { createTicketInput, nextSupportCursor, replyInput, statusInput, supportListQuery, supportOrigin } from '../src/support/contract.js';

const id = '11111111-1111-4111-8111-111111111111';
const key = 'support-test-00000001';

test('support creation keeps only bounded allowlisted user input', () => {
  assert.deepEqual(createTicketInput({ subject: ' Besoin d’aide ', category: 'technical', body: 'Une erreur apparaît.',
    project_id: id, origin: { route: '/app/messages', faq_id: 'messages' }, idempotency_key: key }), {
    subject: 'Besoin d’aide', category: 'technical', body: 'Une erreur apparaît.', project_id: id,
    origin: { route: '/app/messages', faq_id: 'messages' }, idempotency_key: key,
  });
});

test('support contract rejects forged ownership, roles, assignee and hidden page context', () => {
  for (const extra of ['user_id', 'requester_id', 'role', 'assignee_id', 'transcript', 'page_content'])
    assert.throws(() => createTicketInput({ subject: 'Question test', category: 'other', body: 'Contenu', idempotency_key: key, [extra]: id }));
  for (const origin of [{ route: 'https://evil.invalid', faq_id: null }, { route: '/app/messages?ticket=secret', faq_id: null },
    { route: '/app/../private', faq_id: null }, { route: '/app/messages', faq_id: 'BAD SPACE' }]) assert.throws(() => supportOrigin(origin));
});

test('messages, idempotency and lifecycle reasons are bounded', () => {
  assert.deepEqual(replyInput({ body: ' Réponse ', idempotency_key: key }), { body: 'Réponse', idempotency_key: key });
  assert.throws(() => replyInput({ body: 'x', idempotency_key: 'short' }));
  assert.throws(() => statusInput({ status: 'resolved' }));
  assert.deepEqual(statusInput({ status: 'resolved', reason: 'Solution confirmée' }), { status: 'resolved', reason: 'Solution confirmée' });
  assert.throws(() => statusInput({ status: 'admin_override', reason: 'x' }));
});

test('real public routes and opaque cursor queries stay allowlisted', () => {
  for (const route of ['/', '/auth/login', '/auth/register', '/invite', '/app', '/app/messages'])
    assert.equal(supportOrigin({ route, faq_id: 'messages-help' })?.route, route);
  for (const route of ['/auth/activate-staff', '/invite/secret', '/app/messages?ticket=secret'])
    assert.throws(() => supportOrigin({ route, faq_id: null }));
  const cursor = nextSupportCursor({ id, last_message_at: '2026-10-19T00:00:00.000Z' });
  assert.deepEqual(supportListQuery(new URLSearchParams({ limit: '25', cursor })), {
    limit: 25, cursor: { before: '2026-10-19T00:00:00.000Z', id }, status: null, assignee: 'all',
  });
  assert.throws(() => supportListQuery(new URLSearchParams({ offset: '20' })));
  assert.throws(() => supportListQuery(new URLSearchParams({ assignee: id }), true));
});
