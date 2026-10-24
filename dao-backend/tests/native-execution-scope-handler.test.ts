import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeExecutionScopeHandler } from '../src/server/nativeExecutionScopeHandler.js';

const VERSION = '11111111-1111-4111-8111-111111111111';
const AWARD_ITEM = '22222222-2222-4222-8222-222222222222';
const PROPOSAL = '33333333-3333-4333-8333-333333333333';
function fixture(error: any = null) {
  const calls: any[] = [];
  const db = { calls, rpc: async (name: string, args: any) => { calls.push({ name, args }); return { data: { state: 'pending_acceptance' }, error }; } };
  const actor = async (header: string | null) => header === 'Bearer valid' ? { id: 'actor' } : null;
  return { db, handler: createNativeExecutionScopeHandler(db, actor) };
}
const post = (body: unknown, headers: Record<string, string> = { authorization: 'Bearer valid' }) => new Request('https://dao.test/api/projects/native-execution/installment-scopes', {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});

test('installment scope commands require JWT and POST', async () => {
  const { handler, db } = fixture();
  assert.equal((await handler(post({}, {}))).status, 401);
  assert.equal((await handler(new Request('https://dao.test/api/projects/native-execution/installment-scopes', { method: 'GET', headers: { authorization: 'Bearer valid' } }))).status, 405);
  assert.equal(db.calls.length, 0);
});

test('installment scope preparation validates scope shape and maps to bilateral RPC', async () => {
  const { handler, db } = fixture();
  const body = { mode: 'prepare', agreementVersionId: VERSION, installmentNo: 1, scopeType: 'lot', awardItemId: AWARD_ITEM,
    subLotId: null, milestoneKey: null, periodStart: null, periodEnd: null, idempotencyKey: 'scope-proposal-1' };
  assert.equal((await handler(post({ ...body, awardItemId: null }))).status, 400);
  assert.equal((await handler(post({ ...body, extra: true }))).status, 400);
  const response = await handler(post(body));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(db.calls[0], { name: 'native_execution_prepare_installment_scope', args: {
    p_agreement_version_id: VERSION, p_installment_no: 1, p_scope_type: 'lot', p_award_item_id: AWARD_ITEM,
    p_sub_lot_id: null, p_milestone_key: null, p_period_start: null, p_period_end: null, p_idempotency_key: 'scope-proposal-1',
  } });
});

test('installment scope party decisions are sent to the explicit acceptance RPC', async () => {
  const { handler, db } = fixture();
  const response = await handler(post({ mode: 'respond', proposalId: PROPOSAL, decision: 'accepted', idempotencyKey: 'scope-accept-1' }));
  assert.equal(response.status, 200);
  assert.deepEqual(db.calls[0], { name: 'native_execution_accept_installment_scope', args: {
    p_proposal_id: PROPOSAL, p_decision: 'accepted', p_idempotency_key: 'scope-accept-1',
  } });
});
