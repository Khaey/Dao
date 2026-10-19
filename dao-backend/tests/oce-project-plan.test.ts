import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectPlan, ProjectPlanSynchronizer, lotActivityCode, nodeActivityCode, type ProjectPlanSource } from '../src/oce/projectPlanSync.js';
import { validatePlan, OceOrchestrator } from '../src/oce/orchestrator.js';
import { InMemoryOceGateway } from '../src/oce/inMemoryGateway.js';
import { InMemoryOceSyncStore } from '../src/oce/oceSyncStore.js';
import { createOceProjectPlanHandler } from '../src/server/oceProjectPlanHandler.js';

// #325 tranche B — planning global du projet : un graphe pour tous les lots. Ni passerelle réelle ni base.
const P = '11111111-1111-4111-8111-111111111111', CTX = '99999999-9999-4999-8999-999999999999';
const [L1, L2, L3] = ['a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', 'a3333333-3333-4333-8333-333333333333'];
const [N1, N2, N3] = ['b1111111-1111-4111-8111-111111111111', 'b2222222-2222-4222-8222-222222222222', 'b3333333-3333-4333-8333-333333333333'];
const source = (over: Partial<ProjectPlanSource> = {}): ProjectPlanSource => ({
  revision: 4, context_id: CTX, project_title: 'Villa Hammamet', region: 'Nabeul',
  lots: [
    { id: L1, title: 'Gros œuvre', planned_start: '2027-01-10', planned_end: '2027-01-20', ready: true },
    { id: L2, title: 'Électricité', planned_start: '2027-01-21', planned_end: '2027-01-31', ready: true },
    { id: L3, title: 'Peinture', planned_start: null, planned_end: null, ready: false },
  ],
  nodes: [
    { id: N1, request_id: L1, title: 'Fondations', start_date: '2027-01-10', end_date: '2027-01-14' },
    { id: N2, request_id: L2, title: 'Câblage', start_date: '2027-01-21', end_date: '2027-01-31' },
    { id: N3, request_id: L3, title: 'Peinture finale', start_date: '2027-02-01', end_date: '2027-02-10' },
  ],
  links: [
    { id: 'k1', pred_target: `node:${N1}`, succ_target: `node:${N2}`, state: 'effective' },
    { id: 'k2', pred_target: `node:${N2}`, succ_target: `node:${N3}`, state: 'effective' },
    { id: 'k3', pred_target: `lot:${L1}`, succ_target: `lot:${L2}`, state: 'awaiting_confirmation' },
    { id: 'k4', pred_target: `node:${N3}`, succ_target: null, state: 'unresolved' },
  ], ...over,
});

test('global plan: one project, one WBS per lot, only effective links, schedule spans every lot', () => {
  const plan = buildProjectPlan(source())!;
  assert.doesNotThrow(() => validatePlan(plan));
  assert.equal(plan.wbs.length, 3);
  assert.equal(plan.activities.length, 5); // 2 ready lots + 3 dated sub-lots (the unready lot has none)
  assert.deepEqual(plan.dependencies.map(d => [d.predecessor_activity_code, d.successor_activity_code, d.relationship_type, d.lag_days]),
    [[nodeActivityCode(N1), nodeActivityCode(N2), 'FS', 0], [nodeActivityCode(N2), nodeActivityCode(N3), 'FS', 0]]);
  assert.deepEqual([plan.schedule.start_date, plan.schedule.end_date], ['2027-01-10', '2027-02-10']);
  assert.ok(plan.activities.some(a => a.activity_code === lotActivityCode(L1) && a.activity_type === 'summary'));
});

test('global plan: nothing schedulable yields no plan; a link to an unscheduled node is dropped, never invented', () => {
  assert.equal(buildProjectPlan(source({ lots: [], nodes: [], links: [] })), null);
  const plan = buildProjectPlan(source({ links: [{ id: 'x', pred_target: `node:${N1}`, succ_target: 'node:c0000000-0000-4000-8000-000000000000', state: 'effective' }] }))!;
  assert.deepEqual(plan.dependencies, []);
});

test('global plan: a cycle across lots is rejected before any write', () => {
  const plan = buildProjectPlan(source({ links: [
    { id: 'k1', pred_target: `node:${N1}`, succ_target: `node:${N2}`, state: 'effective' },
    { id: 'k2', pred_target: `node:${N2}`, succ_target: `node:${N3}`, state: 'effective' },
    { id: 'k3', pred_target: `node:${N3}`, succ_target: `node:${N1}`, state: 'effective' },
  ] }))!;
  assert.throws(() => validatePlan(plan), (e: any) => e.code === 'dependency_cycle');
});

test('synchroniser: syncs the common context (not per-lot), records the OCE result, replays idempotently', async () => {
  const gateway = new InMemoryOceGateway(); const store = new InMemoryOceSyncStore(); gateway.authorize({ dao_project_id: P, dao_lot_id: CTX });
  const results: any[] = [];
  let current = source();
  const sync = new ProjectPlanSynchronizer(async () => current, new OceOrchestrator(gateway, store), async (...args) => { results.push(args); });
  const first = await sync.run(P);
  assert.equal(first.state, 'synced'); assert.equal(store.mappings.size, 1);
  assert.deepEqual(results[0].slice(0, 2), [P, 4]); assert.ok(results[0][2].duration > 0);
  const calls = gateway.calls.length;
  assert.equal((await sync.run(P)).state, 'synced');
  assert.equal(gateway.calls.length, calls, 'replay must not call the gateway again');
  current = source({ revision: 5, nodes: source().nodes.map(n => (n.id === N2 ? { ...n, end_date: '2027-02-15' } : n)) });
  assert.equal((await sync.run(P)).state, 'synced');
  assert.ok(gateway.calls.length > calls, 'a changed revision reaches the gateway again');
  assert.equal(results.at(-1)[1], 5);
});

test('synchroniser: skips without source, records failures, never throws', async () => {
  const gateway = new InMemoryOceGateway(); const store = new InMemoryOceSyncStore();
  const none = new ProjectPlanSynchronizer(async () => null, new OceOrchestrator(gateway, store), async () => undefined);
  assert.equal((await none.run(P)).state, 'skipped');
  const results: any[] = [];
  const unauthorized = new ProjectPlanSynchronizer(async () => source(), new OceOrchestrator(new InMemoryOceGateway(), new InMemoryOceSyncStore()), async (...a) => { results.push(a); });
  assert.equal((await unauthorized.run(P)).state, 'failed'); assert.equal(results.at(-1)[2], null); assert.match(results.at(-1)[3], /^[a-z0-9_]+$/);
  const cyc = new ProjectPlanSynchronizer(async () => source({ links: [
    { id: 'a', pred_target: `node:${N1}`, succ_target: `node:${N2}`, state: 'effective' }, { id: 'b', pred_target: `node:${N2}`, succ_target: `node:${N1}`, state: 'effective' }] }),
    new OceOrchestrator(gateway, store), async (...a) => { results.push(a); });
  assert.equal((await cyc.run(P)).state, 'failed'); assert.equal(results.at(-1)[3], 'dependency_cycle');
  const broken = new ProjectPlanSynchronizer(async () => { throw new Error('x'); }, new OceOrchestrator(gateway, store), async () => undefined);
  assert.equal((await broken.run(P)).state, 'failed');
});

const actor = async (h: string | null) => (h ? { id: 'u1' } : null);
const req = (method: string, body?: unknown, qs = '') => new Request(`https://dao.test/api/oce/project-plan${qs}`, { method, headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const db = (map: Record<string, { data?: unknown; error?: unknown }>) => { const calls: any[] = []; return { calls, rpc: async (name: string, args: any) => { calls.push([name, args]); const r = map[name] ?? { data: null }; return { data: r.data ?? null, error: r.error ?? null }; } }; };

test('handler: authentication, strict inputs, database-decided access, automatic sync when pending', async () => {
  const synced: string[] = []; const tasks: Promise<unknown>[] = [];
  const handler = (d: ReturnType<typeof db>) => createOceProjectPlanHandler(d, actor, async id => { synced.push(id); }, t => { tasks.push(t); });
  const anonymous = await handler(db({}))(new Request(`https://dao.test/api/oce/project-plan?project_id=${P}`)); assert.equal(anonymous.status, 401);
  const h = handler(db({ get_project_plan: { data: { sync: { state: 'pending' }, lots: [] } } }));
  assert.equal((await h(req('GET', undefined, '?project_id=nope'))).status, 400);
  assert.equal((await h(req('GET', undefined, `?project_id=${P}&x=1`))).status, 400);
  assert.equal((await h(req('PUT', {}))).status, 405);
  const ok = await h(req('GET', undefined, `?project_id=${P}`)); assert.equal(ok.status, 200);
  await Promise.all(tasks); assert.deepEqual(synced, [P]);
  const forbidden = await handler(db({ get_project_plan: { error: { code: '42501' } } }))(req('GET', undefined, `?project_id=${P}`)); assert.equal(forbidden.status, 403);
  assert.equal((await h(req('POST', { project_id: P, link_id: 'bad', decision: 'confirmed' }))).status, 400);
  assert.equal((await h(req('POST', { project_id: P, link_id: N1, decision: 'maybe' }))).status, 400);
  assert.equal((await h(req('POST', { project_id: P, link_id: N1, decision: 'confirmed', extra: 1 }))).status, 400);
});

test('handler: decisions go through the database; a cycle is a readable 422; relaunch needs access', async () => {
  const synced: string[] = []; const tasks: Promise<unknown>[] = [];
  const mk = (d: ReturnType<typeof db>) => createOceProjectPlanHandler(d, actor, async id => { synced.push(id); }, t => { tasks.push(t); });
  const good = db({ decide_plan_link: { data: { links: [] } } });
  const res = await mk(good)(req('POST', { project_id: P, link_id: N1, decision: 'confirmed' }));
  assert.equal(res.status, 200); assert.equal(good.calls[0][0], 'decide_plan_link'); await Promise.all(tasks); assert.deepEqual(synced, [P]);
  const cycle = await mk(db({ decide_plan_link: { error: { code: '23514', message: 'dependency_cycle' } } }))(req('POST', { project_id: P, link_id: N1, decision: 'confirmed' }));
  assert.equal(cycle.status, 422); assert.equal((await cycle.json()).code, 'DEPENDENCY_CYCLE');
  const denied = await mk(db({ decide_plan_link: { error: { code: '42501' } } }))(req('POST', { project_id: P, link_id: N1, decision: 'confirmed' })); assert.equal(denied.status, 403);
  const relaunch = await mk(db({ get_project_plan: { data: {} } }))(req('POST', { project_id: P })); assert.equal(relaunch.status, 202);
  const refused = await mk(db({ get_project_plan: { error: { code: '42501' } } }))(req('POST', { project_id: P })); assert.equal(refused.status, 403);
});
