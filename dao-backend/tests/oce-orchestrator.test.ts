import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryOceGateway } from '../src/oce/inMemoryGateway.js';
import { InMemoryOceSyncStore, canonical, sha256 } from '../src/oce/oceSyncStore.js';
import { OceOrchestrator, OcePlanError, validatePlan, type OcePlan } from '../src/oce/orchestrator.js';
import { OceGatewayError } from '../src/oce/gatewayContract.js';

// #58 lot 3 — orchestration of a lot planning: ordering, idempotent replay, resume, isolation. No live gateway, no database.
const ref = { dao_project_id: '11111111-1111-4111-8111-111111111111', dao_lot_id: '22222222-2222-4222-8222-222222222222' };
const plan = (): OcePlan => ({
  project: { name: 'Villa Hammamet', region: 'Nabeul', currency: 'TND' },
  wbs: [{ code: 'GO', name: 'Gros œuvre' }, { code: 'FIN', name: 'Finitions' }],
  schedule: { start_date: '2026-11-01', end_date: '2027-03-31' },
  activities: [
    { activity_code: 'A1', name: 'Fondations', wbs_code: 'GO', start_date: '2026-11-01', end_date: '2026-11-20' },
    { activity_code: 'A2', name: 'Élévation', wbs_code: 'GO', start_date: '2026-11-21', end_date: '2026-12-31' },
    { activity_code: 'A3', name: 'Peinture', wbs_code: 'FIN', start_date: '2027-01-01', end_date: '2027-01-31' },
  ],
  dependencies: [{ predecessor_activity_code: 'A1', successor_activity_code: 'A2' }, { predecessor_activity_code: 'A2', successor_activity_code: 'A3' }],
});
const setup = () => { const gateway = new InMemoryOceGateway(); const store = new InMemoryOceSyncStore(); gateway.authorize(ref); return { gateway, store, orch: new OceOrchestrator(gateway, store) }; };
const writes = (g: InMemoryOceGateway) => g.calls.filter(c => c !== 'health' && c !== 'ready');

test('canonical hashing ignores key order and undefined', () => {
  assert.equal(canonical({ b: 1, a: [2, { d: 1, c: undefined }] }), '{"a":[2,{"d":1}],"b":1}');
  assert.equal(sha256({ a: 1, b: 2 }), sha256({ b: 2, a: 1 }));
  assert.notEqual(sha256({ a: 1 }), sha256({ a: 2 }));
});

test('plan validation rejects inconsistent plans without any I/O', async () => {
  const cases: [string, (p: OcePlan) => void][] = [
    ['activity_code_duplicate', p => { p.activities[1].activity_code = 'A1'; }],
    ['activity_wbs_unknown', p => { p.activities[0].wbs_code = 'ZZ'; }],
    ['activity_dates_invalid', p => { p.activities[0].end_date = '2026-10-01'; }],
    ['dependency_activity_unknown', p => { p.dependencies[0].successor_activity_code = 'NOPE'; }],
    ['dependency_self', p => { p.dependencies[0].successor_activity_code = 'A1'; }],
    ['dependency_duplicate', p => { p.dependencies.push({ ...p.dependencies[0] }); }],
    ['dependency_cycle', p => { p.dependencies.push({ predecessor_activity_code: 'A3', successor_activity_code: 'A1' }); }],
    ['wbs_code_invalid', p => { p.wbs[0].code = 'bad code'; }],
    ['schedule_dates_invalid', p => { p.schedule.end_date = '2026-01-01'; }],
  ];
  const { gateway, store, orch } = setup();
  for (const [code, mutate] of cases) {
    const p = plan(); mutate(p);
    assert.throws(() => validatePlan(p), (e: any) => e instanceof OcePlanError && e.code === code, code);
    await assert.rejects(orch.sync(ref, p), (e: any) => e instanceof OcePlanError && e.code === code);
  }
  assert.deepEqual(gateway.calls, []); assert.equal(store.mappings.size, 0);
});

test('first sync writes in dependency order and calculates once; replay is a no-op', async () => {
  const { gateway, store, orch } = setup();
  const first = await orch.sync(ref, plan());
  assert.equal(first.ok, true); assert.equal(first.written, 10); assert.equal(first.skipped, 0);
  const ops = first.steps.map(s => s.operation);
  assert.deepEqual(ops, ['ensure-project', 'ensure-wbs', 'ensure-wbs', 'ensure-schedule', 'upsert-activity', 'upsert-activity', 'upsert-activity', 'ensure-dependency', 'ensure-dependency', 'calculate-planning']);
  assert.ok(first.planning);
  const before = gateway.calls.length;
  const second = await orch.sync(ref, plan());
  assert.equal(second.ok, true); assert.equal(second.written, 0);
  assert.equal(gateway.calls.length, before, 'no gateway call on replay');
  assert.ok(second.steps.every(s => s.outcome === 'unchanged'));
  assert.equal(store.mappings.size, 1);
});

test('changing one activity writes only that activity and recalculates', async () => {
  const { gateway, orch } = setup();
  await orch.sync(ref, plan());
  gateway.calls.length = 0;
  const p = plan(); p.activities[2].end_date = '2027-02-15';
  const report = await orch.sync(ref, p);
  assert.equal(report.ok, true); assert.equal(report.written, 2);
  assert.deepEqual(report.steps.filter(s => s.outcome === 'done').map(s => `${s.operation}:${s.code ?? ''}`), ['upsert-activity:A3', 'calculate-planning:']);
  assert.equal(gateway.calls.length, 2);
});

test('failure stops the run, is journaled without content, and the retry resumes', async () => {
  const { gateway, store, orch } = setup();
  // Fail the third gateway write (second WBS) with a non-retryable error already surfaced by the adapter.
  let n = 0; const real = gateway.ensureWbs.bind(gateway);
  gateway.ensureWbs = async input => { if (++n === 2) throw new OceGatewayError('unavailable', 'oce_unavailable', 503); return real(input); };
  const failed = await orch.sync(ref, plan());
  assert.equal(failed.ok, false);
  const last = failed.steps.at(-1)!;
  assert.deepEqual([last.operation, last.outcome, last.errorKind, last.errorCode], ['ensure-wbs', 'failed', 'unavailable', 'oce_unavailable']);
  assert.ok(![...store.journal.values()].some(j => JSON.stringify(j).includes('Hammamet')), 'journal holds no payload');
  const resumed = await orch.sync(ref, plan());
  assert.equal(resumed.ok, true);
  assert.deepEqual(resumed.steps.slice(0, 3).map(s => s.outcome), ['unchanged', 'unchanged', 'done']);
  assert.equal(resumed.steps.filter(s => s.operation === 'ensure-wbs' && s.outcome === 'done').length, 1);
});

test('unexpected errors are recorded as unknown without leaking the message', async () => {
  const { gateway, store, orch } = setup();
  gateway.ensureProject = async () => { throw new Error('secret=abc /run/dao-oce-gateway'); };
  const report = await orch.sync(ref, plan());
  assert.equal(report.ok, false); assert.deepEqual([report.steps[0].errorKind, report.steps[0].errorCode], ['unknown', 'internal_error']);
  assert.ok(![...store.journal.values()].some(j => JSON.stringify(j).includes('secret')));
});

test('a not-yet-admitted lot is refused by the gateway and a revoked mapping is refused by the store', async () => {
  const { gateway, store, orch } = setup();
  const other = { ...ref, dao_lot_id: '33333333-3333-4333-8333-333333333333' };
  const denied = await orch.sync(other, plan());
  assert.equal(denied.ok, false); assert.equal(denied.steps[0].errorKind, 'not_authorized');
  store.revoke([...store.mappings.keys()][0]);
  await assert.rejects(orch.sync(other, plan()), /mapping_revoked/);
  assert.equal(writes(gateway).length, 1);
});

test('a pending journal entry (concurrent run) is reported, not duplicated', async () => {
  const { gateway, store, orch } = setup();
  const id = await store.requestMapping(ref.dao_project_id, ref.dao_lot_id);
  const body = plan().project;
  await store.begin(id, 'ensure-project', `ensure-project:${sha256(body).slice(0, 40)}`, sha256(body));
  const report = await orch.sync(ref, plan());
  assert.equal(report.ok, false); assert.equal(report.steps[0].outcome, 'in_progress'); assert.deepEqual(gateway.calls, []);
});

test('technical summary is read-only and goes through the gateway', async () => {
  const { gateway, orch } = setup();
  await orch.sync(ref, plan());
  const s = await orch.summary(ref);
  assert.equal(s.ok, true); assert.equal(s.total_activities, 3);
});
