import test from 'node:test';
import assert from 'node:assert/strict';
import { SupportService } from '../src/services/SupportService.js';
import { createSupportHandler } from '../src/server/supportHandler.js';

const id = '11111111-1111-4111-8111-111111111111';
const auth = { authorization: 'Bearer valid' };

function database(result: unknown = []) {
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  return {
    calls,
    rpc: async (name: string, input: Record<string, unknown> = {}) => ({ data: result, error: null, value: calls.push({ name, input }) }),
  };
}

test('support HTTP rejects anonymous requests before touching storage', async () => {
  const db = database();
  const api = createSupportHandler(new SupportService(db), async () => null);
  const response = await api.summary(new Request('https://dao.test/api/support/summary'));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, 'unauthenticated');
  assert.equal(db.calls.length, 0);
});

test('ticket creation sends only normalized allowlisted RPC parameters', async () => {
  const db = database({ id, reference: 'AS-000001' });
  const api = createSupportHandler(new SupportService(db), async () => ({ id: 'actor' }));
  const response = await api.create(new Request('https://dao.test/api/support/tickets', {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ subject: ' Besoin technique ', category: 'technical', body: ' Aide ',
      origin: { route: '/auth/login', faq_id: 'login-help' }, idempotency_key: 'support-test-00000001' }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(db.calls[0], { name: 'create_support_ticket', input: {
    p_subject: 'Besoin technique', p_category: 'technical', p_body: 'Aide', p_project_id: null,
    p_origin_route: '/auth/login', p_origin_faq_id: 'login-help', p_idempotency_key: 'support-test-00000001',
  } });
});

test('staff queue and assignment expose only bounded filters and self assignment', async () => {
  const db = database([]);
  const api = createSupportHandler(new SupportService(db), async () => ({ id: 'staff' }));
  const queue = await api.queue(new Request('https://dao.test/api/support/queue?status=open&assignee=unassigned&limit=10', { headers: auth }));
  assert.equal(queue.status, 200);
  assert.equal(db.calls[0].name, 'support_queue');
  const forged = await api.assign(new Request('https://dao.test/api/support/tickets/x/assign', {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ assignee: id }),
  }), id);
  assert.equal(forged.status, 400);
  assert.equal((await forged.json()).code, 'invalid');
  assert.equal(db.calls.length, 1);
});

test('database authorization, rate and availability errors map to stable private responses', async () => {
  for (const [dbCode, status, code] of [['42501', 403, 'forbidden'], ['P0001', 429, 'rate_limited'], ['XX000', 503, 'unavailable']] as const) {
    const service = { summary: async () => { throw Object.assign(new Error('database detail'), { code: dbCode }); } } as unknown as SupportService;
    const api = createSupportHandler(service, async () => ({ id: 'actor' }));
    const response = await api.summary(new Request('https://dao.test/api/support/summary', { headers: auth }));
    assert.equal(response.status, status);
    const payload = await response.json();
    assert.equal(payload.code, code);
    assert.doesNotMatch(payload.error, /database detail/);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
});
