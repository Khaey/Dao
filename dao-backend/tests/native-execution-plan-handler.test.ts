import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeExecutionPlanHandler } from '../src/server/nativeExecutionPlanHandler.js';

const PROJECT = '00000000-0000-4000-8000-000000000001';
const CURSOR = '00000000-0000-4000-8000-000000000002';
const dto: any = {
  schemaVersion: 1, projectId: PROJECT, generatedAt: '2026-10-24T00:00:00Z',
  viewer: { workspace: 'client' }, sourceRevisions: { plan: 1, executionCursor: null },
  page: { limit: 50, nextCursor: null }, lots: [],
  activities: { supported: false, items: [] }, forecast: null,
};

function request(url: string, init: RequestInit = {}) {
  return new Request(`https://dao.test/api/projects/native-execution${url}`, {
    headers: { authorization: 'Bearer valid-test-jwt' }, ...init,
  });
}

function fixture(data: any = dto, error: any = null) {
  const calls: any[] = [];
  const db = { calls, rpc: async (name: string, args: any) => { calls.push({ name, args }); return { data, error }; } };
  const actor = async (header: string | null) => header === 'Bearer valid-test-jwt' ? { id: 'u1' } : null;
  return { db, handler: createNativeExecutionPlanHandler(db, actor) };
}

test('native plan API requires a verified actor and exposes GET only', async () => {
  const { db, handler } = fixture();
  assert.equal((await handler(new Request(`https://dao.test/api/projects/native-execution?project_id=${PROJECT}`))).status, 401);
  assert.equal((await handler(request(`?project_id=${PROJECT}`, { method: 'POST' }))).status, 405);
  assert.equal(db.calls.length, 0);
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
  assert.deepEqual(db.calls, [{ name: 'native_execution_plan_v1', args: {
    p_project_id: PROJECT, p_after_request_id: CURSOR, p_limit: 25,
  } }, { name: 'native_execution_plan_v1', args: {
    p_project_id: PROJECT, p_after_request_id: null, p_limit: 100,
  } }]);
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
  assert.deepEqual(await (await fixture(empty).handler(request(`?project_id=${PROJECT}`))).json(), { data: empty });
});

test('native plan API hides database detail on failure and performs no OCE work', async () => {
  const { handler, db } = fixture(null, { code: 'XX000', message: 'secret database detail' });
  const response = await handler(request(`?project_id=${PROJECT}`));
  assert.equal(response.status, 503);
  assert.ok(!JSON.stringify(await response.json()).includes('secret'));
  assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0].name, 'native_execution_plan_v1');
});
