import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLotPlan, LotPlanSynchronizer, type LotPlanSource } from '../src/oce/lotPlanSync.js';
import { validatePlan, OceOrchestrator } from '../src/oce/orchestrator.js';
import { InMemoryOceGateway } from '../src/oce/inMemoryGateway.js';
import { InMemoryOceSyncStore } from '../src/oce/oceSyncStore.js';
import { createOceLotPlanHandler } from '../src/server/oceLotPlanHandler.js';

// #301 — automatic D.A.O -> OCE trigger for a minimal lot plan. No live gateway, no database.
const P = '11111111-1111-4111-8111-111111111111', L = '22222222-2222-4222-8222-222222222222';
const ref = { dao_project_id: P, dao_lot_id: L };
const source: LotPlanSource = { lot_title: 'Gros œuvre', region: 'Nabeul', planned_start: '2026-11-02', planned_end: '2026-12-18' };
const actor = async (h: string | null) => (h ? { id: 'u1' } : null);
const req = (method: string, body?: unknown, qs = '') => new Request(`https://dao.test/api/oce/lot-plan${qs}`, { method, headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const db = (map: Record<string, { data?: unknown; error?: unknown }>) => { const calls: any[] = []; return { calls, rpc: async (name: string, args: any) => { calls.push([name, args]); const r = map[name] ?? { data: null }; return { data: r.data ?? null, error: r.error ?? null }; } }; };
const put = { project_id: P, lot_id: L, planned_start: '2026-11-02', planned_end: '2026-12-18', ready: true };

test('minimal plan: one WBS, one activity, only explicit dates, no invented dependency', () => {
  const plan = buildLotPlan(source);
  assert.doesNotThrow(() => validatePlan(plan));
  assert.deepEqual(plan.dependencies, []);
  assert.equal(plan.wbs.length, 1); assert.equal(plan.activities.length, 1);
  assert.deepEqual([plan.schedule.start_date, plan.schedule.end_date], ['2026-11-02', '2026-12-18']);
  assert.deepEqual([plan.activities[0].start_date, plan.activities[0].end_date], ['2026-11-02', '2026-12-18']);
  assert.equal(plan.project.currency, 'TND');
});

test('synchroniser: skips a lot without ready plan, syncs idempotently, reports failures without throwing', async () => {
  const gateway = new InMemoryOceGateway(); const store = new InMemoryOceSyncStore(); gateway.authorize(ref);
  const none = new LotPlanSynchronizer(async () => null, new OceOrchestrator(gateway, store));
  assert.equal((await none.run(ref)).state, 'skipped'); assert.equal(store.mappings.size, 0);
  const sync = new LotPlanSynchronizer(async () => source, new OceOrchestrator(gateway, store));
  const first = await sync.run(ref); assert.equal(first.state, 'synced'); assert.ok(first.report!.planning);
  const writes = gateway.calls.length;
  const again = await sync.run(ref); assert.equal(again.state, 'synced'); assert.equal(again.report!.written, 0);
  assert.equal(gateway.calls.length, writes, 'replay must not call the gateway again');
  const unauthorized = new LotPlanSynchronizer(async () => source, new OceOrchestrator(new InMemoryOceGateway(), new InMemoryOceSyncStore()));
  assert.equal((await unauthorized.run(ref)).state, 'failed');
  const broken = new LotPlanSynchronizer(async () => { throw new Error('x'); }, new OceOrchestrator(gateway, store));
  assert.equal((await broken.run(ref)).state, 'failed');
});

test('synchroniser coalesces a concurrent run of the same lot', async () => {
  const gateway = new InMemoryOceGateway(); gateway.authorize(ref);
  let release!: () => void; const gate = new Promise<void>(r => { release = r; });
  const sync = new LotPlanSynchronizer(async () => { await gate; return source; }, new OceOrchestrator(gateway, new InMemoryOceSyncStore()));
  const a = sync.run(ref); const b = await sync.run(ref); release();
  assert.equal(b.state, 'skipped'); assert.equal((await a).state, 'synced');
});

test('PUT ready saves through the user-scoped RPC then triggers the synchronisation automatically', async () => {
  const d = db({ oce_save_lot_plan: { data: { status: 'ready', revision: 1 } } }); const runs: any[] = []; const tasks: Promise<unknown>[] = [];
  const h = createOceLotPlanHandler(d, actor, async r => { runs.push(r); }, t => tasks.push(t));
  const r = await h(req('PUT', put)); assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).data.sync, { state: 'pending' });
  await Promise.all(tasks); assert.deepEqual(runs, [ref]);
  assert.deepEqual(d.calls[0], ['oce_save_lot_plan', { p_project_id: P, p_request_id: L, p_start: '2026-11-02', p_end: '2026-12-18', p_ready: true }]);
});

test('PUT draft never triggers; unauthorized and invalid plans never trigger', async () => {
  const runs: any[] = [];
  const mk = (map: any) => createOceLotPlanHandler(db(map), actor, async r => { runs.push(r); }, t => { void t; });
  assert.equal((await mk({ oce_save_lot_plan: { data: { status: 'draft' } } })(req('PUT', { ...put, ready: false }))).status, 200);
  assert.equal((await mk({ oce_save_lot_plan: { error: { code: '42501' } } })(req('PUT', put))).status, 403);
  assert.equal((await mk({ oce_save_lot_plan: { error: { code: '22023' } } })(req('PUT', put))).status, 422);
  assert.equal((await mk({ oce_save_lot_plan: { error: { code: 'XX' } } })(req('PUT', put))).status, 503);
  assert.deepEqual(runs, []);
});

test('strict input: auth, method, ids, dates, exact keys', async () => {
  const d = db({}); const h = createOceLotPlanHandler(d, actor, async () => {});
  assert.equal((await h(new Request('https://dao.test/x', { method: 'PUT' }))).status, 401);
  assert.equal((await h(req('DELETE'))).status, 405);
  for (const body of [{ ...put, project_id: 'bad' }, { ...put, planned_start: '2026-02-30' }, { ...put, planned_end: '18/12/2026' }, { ...put, ready: 'yes' }, { ...put, oce_id: '1' }, { project_id: P, lot_id: L }]) {
    assert.equal((await h(req('PUT', body))).status, 400, JSON.stringify(body));
  }
  assert.equal((await h(req('GET', undefined, `?project_id=${P}`))).status, 400);
  assert.equal(d.calls.length, 0);
});

test('GET returns the plan and sync state; POST relaunch is reserved to D.A.O management', async () => {
  const state = { status: 'ready', sync: { state: 'failed', error_kind: 'transient', error_code: 'unavailable' } };
  const runs: any[] = [];
  const h = createOceLotPlanHandler(db({ oce_get_lot_plan: { data: state }, oce_resync_access: { data: true } }), actor, async r => { runs.push(r); }, t => { void t; });
  assert.deepEqual((await (await h(req('GET', undefined, `?project_id=${P}&lot_id=${L}`))).json()).data, state);
  assert.equal((await h(req('POST', { project_id: P, lot_id: L }))).status, 202); await new Promise(r => setImmediate(r)); assert.deepEqual(runs, [ref]);
  const denied = createOceLotPlanHandler(db({ oce_resync_access: { data: false } }), actor, async r => { runs.push(r); });
  assert.equal((await denied(req('POST', { project_id: P, lot_id: L }))).status, 403); assert.equal(runs.length, 1);
});
