import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeLotDatesHandler } from '../src/server/nativeLotDatesHandler.js';

const PROJECT = '00000000-0000-4000-8000-000000000001';
const LOT = '00000000-0000-4000-8000-000000000002';
function fixture(error: any = null) {
  const calls: any[] = [];
  const db = { calls, rpc: async (name: string, args: any) => { calls.push({ name, args }); return { data: { status: 'draft', planned_start: null, planned_end: null }, error }; } };
  const actor = async (header: string | null) => header === 'Bearer valid' ? { id: 'actor' } : null;
  return { db, handler: createNativeLotDatesHandler(db, actor) };
}
const request = (method: string, body?: unknown, query = '?project_id=' + PROJECT + '&lot_id=' + LOT) =>
  new Request('https://dao.test/api/projects/native-execution/dates' + query, {
    method, headers: { authorization: 'Bearer valid', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const dates = { projectId: PROJECT, lotId: LOT, plannedStart: '2026-11-01', plannedEnd: '2026-11-12' };

test('native lot dates use DAO RPCs only and save as non-syncing plans', async () => {
  const { db, handler } = fixture();
  assert.equal((await handler(request('GET'))).status, 200);
  const response = await handler(request('PUT', dates));
  assert.equal(response.status, 200);
  assert.equal((await response.json() as any).data.synchronization, 'not_requested');
  assert.deepEqual(db.calls, [
    { name: 'oce_get_lot_plan', args: { p_project_id: PROJECT, p_request_id: LOT } },
    { name: 'oce_save_lot_plan', args: { p_project_id: PROJECT, p_request_id: LOT, p_start: dates.plannedStart, p_end: dates.plannedEnd, p_ready: false } },
  ]);
});

test('native lot dates validate complete optional ranges and reject OCE-ready mode', async () => {
  const { db, handler } = fixture();
  for (const body of [
    { ...dates, plannedEnd: null }, { ...dates, plannedStart: '2026-02-31' },
    { ...dates, plannedEnd: '2026-10-30' }, { ...dates, ready: true },
  ]) assert.ok([400, 422].includes((await handler(request('PUT', body))).status));
  assert.equal(db.calls.length, 0);
});

test('native lot dates distinguish authorization and invalid-state errors', async () => {
  for (const [error, status] of [[{ code: '42501' }, 403], [{ code: '22023' }, 422], [{ code: 'XX000' }, 503]] as const) {
    assert.equal((await fixture(error).handler(request('PUT', dates))).status, status);
  }
});
