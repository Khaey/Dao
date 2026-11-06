import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectWorkItemsHandler, normalizeWorkItemCommand, workItemErrorMessage } from '../src/server/projectWorkItemsHandler.js';

const P = '0f9fd432-1111-4222-8333-444455556666';
const R = '1a2b3c4d-1111-4222-8333-444455556666';
const S = '2a2b3c4d-1111-4222-8333-444455556666';
const W = '3a2b3c4d-1111-4222-8333-444455556666';
const I = '4a2b3c4d-1111-4222-8333-444455556666';

test('work item commands: strict shape, lower-cased ids, no quantity or price accepted', () => {
  const add = normalizeWorkItemCommand({ action: 'add', idempotencyKey: 'wi-key-0001', requestId: R.toUpperCase(), items: [{ subLotId: S, workId: W }, { label: '  Pergola  ', confirmation: 'to_confirm' }] });
  assert.deepEqual(add, { action: 'add', key: 'wi-key-0001', input: { requestId: R, items: [{ subLotId: S, workId: W, confirmation: 'selected' }, { subLotId: null, label: 'Pergola', confirmation: 'to_confirm' }] } });
  for (const bad of [
    { action: 'add', idempotencyKey: 'wi-key-0001', requestId: R, items: [{ workId: W, quantity: '12' }] },
    { action: 'add', idempotencyKey: 'wi-key-0001', requestId: R, items: [{ workId: W, label: 'Forgé' }] },
    { action: 'add', idempotencyKey: 'wi-key-0001', requestId: R, items: [{ label: 'x' }] },
    { action: 'add', idempotencyKey: 'wi-key-0001', requestId: R, items: [] },
    { action: 'add', idempotencyKey: 'short', requestId: R, items: [{ workId: W }] },
    { action: 'delete', idempotencyKey: 'wi-key-0001', itemId: I, expectedRevision: 1 },
    { action: 'update', idempotencyKey: 'wi-key-0001', itemId: I, expectedRevision: 1 },
    { action: 'remove', idempotencyKey: 'wi-key-0001', itemId: I, expectedRevision: 0 },
    { action: 'remove', idempotencyKey: 'wi-key-0001', itemId: I, expectedRevision: 1, budget: 1 },
  ]) assert.equal(normalizeWorkItemCommand(bad), null, JSON.stringify(bad));
  assert.deepEqual(normalizeWorkItemCommand({ action: 'update', idempotencyKey: 'wi-key-0002', itemId: I, expectedRevision: 2, subLotId: null }),
    { action: 'update', key: 'wi-key-0002', input: { itemId: I, expectedRevision: 2, subLotId: null } });
});

test('work item errors: lock reasons and conflicts are explained without leaking SQL', () => {
  assert.equal(workItemErrorMessage({ code: '23514', hint: 'work_items_locked:published' }).code, 'LOCKED');
  assert.match(workItemErrorMessage({ code: '23514', hint: 'work_items_locked:published' }).message, /figés dans la version envoyée aux Artisans/);
  assert.equal(workItemErrorMessage({ code: '23514', hint: 'work_item_has_takeoffs' }).code, 'HAS_TAKEOFFS');
  assert.equal(workItemErrorMessage({ code: '40001' }).status, 409);
  assert.equal(workItemErrorMessage({ code: '42501' }).status, 403);
  assert.equal(workItemErrorMessage({ code: 'XX000', message: 'relation secrète' }).message.includes('secrète'), false);
});

test('work item handler: JWT required, allowlisted RPCs, private no-store responses', async () => {
  const calls: Array<{ name: string; args: any }> = [];
  const db = { rpc: async (name: string, args: any) => { calls.push({ name, args }); return { data: { projectId: P, lots: [] }, error: null }; } };
  const api = createProjectWorkItemsHandler(db, async auth => auth === 'Bearer valid' ? { id: 'actor' } : null);
  assert.equal((await api(new Request(`https://dao.test/api/projects/work-items?project_id=${P}`))).status, 401);
  const auth = { authorization: 'Bearer valid' };
  const read = await api(new Request(`https://dao.test/api/projects/work-items?project_id=${P}`, { headers: auth }));
  assert.equal(read.status, 200); assert.equal(read.headers.get('cache-control'), 'private, no-store');
  assert.equal((await api(new Request(`https://dao.test/api/projects/work-items?project_id=${P}&item_id=${I}`, { headers: auth }))).status, 400);
  assert.equal((await api(new Request(`https://dao.test/api/projects/work-items?item_id=${I}`, { headers: auth }))).status, 200);
  const posted = await api(new Request('https://dao.test/api/projects/work-items', { method: 'POST', headers: auth, body: JSON.stringify({ action: 'remove', idempotencyKey: 'wi-key-0003', itemId: I, expectedRevision: 3 }) }));
  assert.equal(posted.status, 200);
  assert.deepEqual(calls.map(c => c.name), ['project_work_items_snapshot_v1', 'project_work_item_history_v1', 'project_work_item_command_v1']);
  assert.deepEqual(calls[2].args, { p_action: 'remove', p_input: { itemId: I, expectedRevision: 3 }, p_idempotency_key: 'wi-key-0003' });
  const locked = createProjectWorkItemsHandler({ rpc: async () => ({ data: null, error: { code: '23514', hint: 'work_items_locked:awarded' } }) }, async () => ({ id: 'a' }));
  const res = await locked(new Request('https://dao.test/api/projects/work-items', { method: 'POST', headers: auth, body: JSON.stringify({ action: 'add', idempotencyKey: 'wi-key-0004', requestId: R, items: [{ workId: W }] }) }));
  assert.equal(res.status, 409); assert.equal((await res.json()).code, 'LOCKED');
  assert.equal((await api(new Request('https://dao.test/api/projects/work-items', { method: 'DELETE', headers: auth }))).status, 405);
});
