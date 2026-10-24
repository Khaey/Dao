import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeExecutionActivityHandler } from '../src/server/nativeExecutionActivityHandler.js';

const AWARD_ITEM = '00000000-0000-4000-8000-000000000001';
const ACTIVITY = '00000000-0000-4000-8000-000000000002';
const PROPOSAL = '00000000-0000-4000-8000-000000000003';

function fixture(error: any = null) {
  const calls: any[] = [];
  const db = { calls, rpc: async (name: string, args: any) => { calls.push({ name, args }); return { data: { state: 'pending_acceptance' }, error }; } };
  const resolveActor = async (header: string | null) => header === 'Bearer valid' ? { id: 'actor' } : null;
  const handler = createNativeExecutionActivityHandler(db, resolveActor);
  return { db, handler };
}

const post = (body: unknown, headers: Record<string, string> = { authorization: 'Bearer valid' }) => new Request('https://dao.test/api/projects/native-execution/activities', {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});

const activity = {
  mode: 'write', awardItemId: AWARD_ITEM, activityId: null, action: 'create', parentActivityId: null,
  kind: 'sub_lot', title: 'Gros œuvre', scope: null, position: 1, plannedStart: null, plannedEnd: null,
  durationDays: null, expectedRevision: null, idempotencyKey: 'create-activity-1',
};

test('native activity commands require an actor and POST', async () => {
  const { handler, db } = fixture();
  assert.equal((await handler(post(activity, {}))).status, 401);
  assert.equal((await handler(new Request('https://dao.test/api/projects/native-execution/activities', { method: 'GET', headers: { authorization: 'Bearer valid' } }))).status, 405);
  assert.equal(db.calls.length, 0);
});

test('native activity write validates fields and sends one atomic idempotent RPC', async () => {
  const { handler, db } = fixture();
  assert.equal((await handler(post({ ...activity, plannedStart: '2026-02-31' }))).status, 400);
  assert.equal((await handler(post({ ...activity, extra: true }))).status, 400);
  assert.equal(db.calls.length, 0);
  const response = await handler(post(activity));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(db.calls, [{ name: 'native_execution_activity_write', args: {
    p_award_item_id: AWARD_ITEM, p_activity_id: null, p_action: 'create', p_parent_activity_id: null,
    p_kind: 'sub_lot', p_title: 'Gros œuvre', p_scope: null, p_position: 1,
    p_planned_start: null, p_planned_end: null, p_duration_days: null, p_expected_revision: null,
    p_idempotency_key: 'create-activity-1',
  } }]);
});

test('manager proposals and party decisions use isolated RPCs', async () => {
  const { handler, db } = fixture();
  const prepared = await handler(post({ ...activity, mode: 'prepare', action: 'create', idempotencyKey: 'prepare-activity-1' }));
  assert.equal(prepared.status, 200);
  const accepted = await handler(post({ mode: 'respond', proposalId: PROPOSAL, decision: 'accepted', idempotencyKey: 'proposal-accept-1' }));
  assert.equal(accepted.status, 200);
  assert.equal(db.calls[0].name, 'native_execution_prepare_activity_change');
  assert.equal(db.calls[1].name, 'native_execution_accept_activity_change');
  assert.equal(db.calls[1].args.p_proposal_id, PROPOSAL);
});

test('native activity write hides SQL details and maps authorization and revision conflicts', async () => {
  for (const [error, expected] of [[{ code: '42501', message: 'sensitive' }, 403], [{ code: '40001' }, 409], [{ code: '22023' }, 400], [{ code: 'XX000', message: 'secret' }, 503]] as const) {
    const { handler } = fixture(error);
    const response = await handler(post(activity));
    assert.equal(response.status, expected);
    assert.ok(!JSON.stringify(await response.json()).includes('secret'));
  }
});
