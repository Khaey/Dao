import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeExecutionPlanHandler } from '../src/server/nativeExecutionPlanHandler.js';

const PROJECT = '00000000-0000-4000-8000-000000000001';
const CURSOR = '00000000-0000-4000-8000-000000000002';
const dto: any = {
  schemaVersion: 1, projectId: PROJECT, generatedAt: '2026-10-24T00:00:00Z',
  viewer: { workspace: 'client' }, sourceRevisions: { plan: 1, executionCursor: null },
  page: { limit: 50, nextCursor: null }, lots: [],
  activities: { supported: false, items: [] }, dependencies: [], forecast: null,
};

function request(url: string, init: RequestInit = {}) {
  return new Request(`https://dao.test/api/projects/native-execution${url}`, {
    headers: { authorization: 'Bearer valid-test-jwt' }, ...init,
  });
}

function fixture(data: any = dto, error: any = null, dependencies: any[] = []) {
  const calls: any[] = [];
  const db = { calls, rpc: async (name: string, args: any) => { calls.push({ name, args }); return name === 'native_execution_dependencies_v1' ? { data: dependencies, error: null } : { data, error }; } };
  const actor = async (header: string | null) => header === 'Bearer valid-test-jwt' ? { id: 'u1' } : null;
  return { db, handler: createNativeExecutionPlanHandler(db, actor) };
}

test('native plan API requires a verified actor and exposes GET only', async () => {
  const { db, handler } = fixture();
  assert.equal((await handler(new Request(`https://dao.test/api/projects/native-execution?project_id=${PROJECT}`))).status, 401);
  assert.equal((await handler(request(`?project_id=${PROJECT}`, { method: 'POST' }))).status, 405);
  assert.equal(db.calls.length, 0);
});

test('native plan includes activity dependencies in the shared DTO and forecast graph', async () => {
  const activityA = { id: '00000000-0000-4000-8000-000000000010', requestId: 'request-a', title: 'Préparer', active: true,
    plannedDates: { start: '2026-03-01', end: '2026-03-01', durationDays: 1 }, execution: { observed: null } };
  const activityB = { ...activityA, id: '00000000-0000-4000-8000-000000000011', requestId: 'request-b', title: 'Installer',
    plannedDates: { start: null, end: null, durationDays: 2 } };
  const plan = { ...dto, activities: { supported: true, items: [activityA, activityB] }, lots: [
    { requestId: 'request-a', title: 'A', dates: { agreed: null, plan: null, proposed: null, observed: null }, executionSubLots: [], dependencies: [] },
    { requestId: 'request-b', title: 'B', dates: { agreed: null, plan: null, proposed: null, observed: null }, executionSubLots: [], dependencies: [] },
  ] };
  const dependency = { id: '00000000-0000-4000-8000-000000000020', from: `activity:${activityA.id}`, to: `activity:${activityB.id}`,
    state: 'effective', relation: 'FS', lagDays: 0, source: 'manual' };
  const body = await (await fixture(plan, null, [dependency]).handler(request(`?project_id=${PROJECT}`))).json() as any;
  assert.deepEqual(body.data.dependencies, [dependency]);
  assert.equal(body.data.forecast.state, 'incomplete');
  assert.equal(body.data.forecast.nodes.find((item: any) => item.id === `activity:${activityB.id}`)?.projectedStart, '2026-03-02');
});

test('native plan API strictly validates project, cursor, limit and duplicate query parameters', async () => {
  const { db, handler } = fixture();
  for (const query of [
    '', '?project_id=bad', `?project_id=${PROJECT}&cursor=bad`, `?project_id=${PROJECT}&limit=0`,
    `?project_id=${PROJECT}&limit=1.5`, `?project_id=${PROJECT}&limit=101`,
    `?project_id=${PROJECT}&project_id=${PROJECT}`, `?project_id=${PROJECT}&extra=1`,
  ]) assert.equal((await handler(request(query))).status, 400, query);
  assert.equal(db.calls.length, 0);
});

test('native plan API uses bounded JWT scoped RPCs and calculates a project-wide forecast', async () => {
  const { db, handler } = fixture();
  const response = await handler(request(`?project_id=${PROJECT.toUpperCase()}&cursor=${CURSOR}&limit=25`));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('vary'), 'Authorization');
  const body = await response.json() as any;
  assert.equal(body.data.forecast.state, 'none');
  assert.deepEqual({ canReadTracking: body.data.canReadTracking, canReadInspections: body.data.canReadInspections,
    canReadWorkSituations: body.data.canReadWorkSituations, canComment: body.data.canComment },
  { canReadTracking: true, canReadInspections: true, canReadWorkSituations: true, canComment: true });
  assert.deepEqual(db.calls, [{ name: 'native_execution_plan_v1', args: {
    p_project_id: PROJECT, p_after_request_id: CURSOR, p_limit: 25,
  } }, { name: 'native_execution_dependencies_v1', args: { p_project_id: PROJECT } }, { name: 'native_execution_plan_v1', args: {
    p_project_id: PROJECT, p_after_request_id: null, p_limit: 100,
  } }]);
});

test('native plan capabilities are returned only from an authorized project workspace', async () => {
  for (const workspace of ['client', 'contractor', 'dao_manager'] as const) {
    const plan = { ...dto, viewer: { workspace }, canReadTracking: false, canReadInspections: false,
      canReadWorkSituations: false, canComment: false } as any;
    const response = await fixture(plan).handler(request(`?project_id=${PROJECT}`));
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.deepEqual({ canReadTracking: body.data.canReadTracking, canReadInspections: body.data.canReadInspections,
      canReadWorkSituations: body.data.canReadWorkSituations, canComment: body.data.canComment },
    { canReadTracking: true, canReadInspections: true, canReadWorkSituations: true, canComment: true });
  }
});

test('native plan API distinguishes forbidden, not-found and invalid from empty data', async () => {
  for (const [error, status, code] of [
    [{ code: '42501' }, 403, 'FORBIDDEN'], [{ code: 'P0002' }, 404, 'NOT_FOUND'], [{ code: '22023' }, 400, 'BAD_REQUEST'],
  ] as const) {
    const { handler } = fixture(null, error);
    const response = await handler(request(`?project_id=${PROJECT}`));
    assert.equal(response.status, status);
    assert.equal((await response.json() as any).code, code);
  }
  const empty = { ...dto, lots: [] };
  const response = await fixture(empty).handler(request(`?project_id=${PROJECT}`));
  const body = await response.json() as any;
  assert.deepEqual(body.data.lots, []);
  assert.equal(body.data.forecast.state, 'none');
});

test('native plan API hides database detail on failure and performs no OCE work', async () => {
  const { handler, db } = fixture(null, { code: 'XX000', message: 'secret database detail' });
  const response = await handler(request(`?project_id=${PROJECT}`));
  assert.equal(response.status, 503);
  assert.ok(!JSON.stringify(await response.json()).includes('secret'));
  assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0].name, 'native_execution_plan_v1');
});
