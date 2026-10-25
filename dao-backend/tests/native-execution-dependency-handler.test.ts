import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeExecutionDependencyHandler } from '../src/server/nativeExecutionDependencyHandler.js';

const PROJECT = '00000000-0000-4000-8000-000000000001';
const ACTIVITY = '00000000-0000-4000-8000-000000000002';
const LOT = '00000000-0000-4000-8000-000000000003';
function fixture(error: any = null) {
  const calls: any[] = [];
  const db = { calls, rpc: async (name: string, args: any) => { calls.push({ name, args }); return { data: { links: [] }, error }; } };
  const actor = async (header: string | null) => header === 'Bearer valid' ? { id: 'actor' } : null;
  return { db, handler: createNativeExecutionDependencyHandler(db, actor) };
}
const request = (body: unknown, method = 'POST', authorization = 'Bearer valid') => new Request('https://dao.test/api/projects/native-execution/dependencies', {
  method, headers: { authorization, 'content-type': 'application/json' }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
});

test('native dependency edits require authentication and allow only POST', async () => {
  const { db, handler } = fixture();
  assert.equal((await handler(request({ projectId: PROJECT }, 'POST', ''))).status, 401);
  assert.equal((await handler(request({ projectId: PROJECT }, 'GET'))).status, 405);
  assert.equal(db.calls.length, 0);
});

test('native dependencies accept activity, lot and node targets without scheduling OCE', async () => {
  const { db, handler } = fixture();
  const response = await handler(request({ action: 'add', projectId: PROJECT, predTarget: `activity:${ACTIVITY}`, succTarget: `lot:${LOT}` }));
  assert.equal(response.status, 200);
  assert.equal((await response.json() as any).synchronization, 'not_requested');
  assert.deepEqual(db.calls[0], { name: 'add_plan_link', args: {
    p_project_id: PROJECT, p_pred: `activity:${ACTIVITY}`, p_succ: `lot:${LOT}`,
  } });
  assert.equal((await handler(request({ action: 'add', projectId: PROJECT, predTarget: `node:${ACTIVITY}`, succTarget: `activity:${LOT}` }))).status, 200);
});

test('native dependencies validate strict commands and map cycle errors', async () => {
  const { handler } = fixture();
  assert.equal((await handler(request({ action: 'add', projectId: PROJECT, predTarget: `activity:${ACTIVITY}`, succTarget: `activity:${ACTIVITY}` }))).status, 400);
  assert.equal((await handler(request({ action: 'remove', projectId: PROJECT, linkId: 'bad' }))).status, 400);
  assert.equal((await fixture({ code: '23514', message: 'dependency_cycle' }).handler(request({
    action: 'add', projectId: PROJECT, predTarget: `activity:${ACTIVITY}`, succTarget: `lot:${LOT}`,
  }))).status, 422);
  assert.equal((await fixture({ code: '42501' }).handler(request({
    action: 'remove', projectId: PROJECT, linkId: ACTIVITY,
  }))).status, 403);
});
