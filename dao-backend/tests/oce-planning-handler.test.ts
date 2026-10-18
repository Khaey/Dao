import test from 'node:test';
import assert from 'node:assert/strict';
import { createOcePlanningHandler } from '../src/server/ocePlanningHandler.js';
import { InMemoryOceGateway } from '../src/oce/inMemoryGateway.js';
import { disabledGateway } from '../src/oce/gatewayClient.js';
import { OceGatewayError } from '../src/oce/gatewayContract.js';

// #58 — read-only technical summary route: authentication, strict input, DB-decided authorization, failure isolation.
const P = '11111111-1111-4111-8111-111111111111', L = '22222222-2222-4222-8222-222222222222';
const ref = { dao_project_id: P, dao_lot_id: L };
const get = (qs: string, init: RequestInit = {}) => new Request(`https://dao.test/api/oce/planning-summary${qs}`, { headers: { authorization: 'Bearer t' }, ...init });
const actor = async (h: string | null) => (h ? { id: 'u1' } : null);
const db = (allowed: unknown, error: unknown = null) => { const calls: any[] = []; return { calls, rpc: async (name: string, args: any) => { calls.push([name, args]); return { data: allowed, error }; } }; };
async function seeded() {
  const gateway = new InMemoryOceGateway(); gateway.authorize(ref);
  await gateway.ensureProject({ ...ref, name: 'X', region: 'Tunis', currency: 'TND' });
  await gateway.ensureSchedule({ ...ref, start_date: '2026-11-01', end_date: '2026-12-31' });
  await gateway.upsertActivity({ ...ref, activity_code: 'A1', name: 'Fondations', start_date: '2026-11-01', end_date: '2026-11-20' });
  return gateway;
}

test('requires authentication and GET only; never reaches the database or gateway otherwise', async () => {
  const d = db(true); const g = await seeded(); g.calls.length = 0;
  const handler = createOcePlanningHandler(d, actor, g);
  assert.equal((await handler(new Request('https://dao.test/x?project_id=' + P + '&lot_id=' + L))).status, 401);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const r = await handler(get(`?project_id=${P}&lot_id=${L}`, { method }));
    assert.equal(r.status, 405); assert.equal(r.headers.get('allow'), 'GET');
  }
  assert.equal(d.calls.length, 0); assert.deepEqual(g.calls, []);
});

test('strict parameters: exactly project_id and lot_id as UUIDs', async () => {
  const d = db(true); const g = await seeded(); g.calls.length = 0;
  const handler = createOcePlanningHandler(d, actor, g);
  for (const qs of ['', `?project_id=${P}`, `?lot_id=${L}`, `?project_id=bad&lot_id=${L}`, `?project_id=${P}&lot_id=${L}&oce_id=1`, `?project_id=${P}&project_id=${P}&lot_id=${L}`, `?project_id=${P}&lot_id=../${L}`]) {
    assert.equal((await handler(get(qs))).status, 400, qs);
  }
  assert.equal(d.calls.length, 0); assert.deepEqual(g.calls, []);
});

test('the database decision gates the gateway; every denial looks the same', async () => {
  for (const allowed of [false, null, undefined, 'true', 1]) {
    const d = db(allowed); const g = await seeded(); g.calls.length = 0;
    const r = await createOcePlanningHandler(d, actor, g)(get(`?project_id=${P}&lot_id=${L}`));
    assert.equal(r.status, 403); assert.deepEqual(await r.json(), { error: 'Accès au résumé technique refusé.', code: 'FORBIDDEN' });
    assert.deepEqual(g.calls, [], 'gateway untouched when denied');
  }
  const failing = db(null, { code: 'XX000', message: 'secret internal detail' });
  const r = await createOcePlanningHandler(failing, actor, await seeded())(get(`?project_id=${P}&lot_id=${L}`));
  assert.equal(r.status, 503); assert.ok(!JSON.stringify(await r.json()).includes('secret'));
});

test('authorized caller gets only the minimal summary, no-store, no OCE identifier', async () => {
  const d = db(true); const g = await seeded();
  const r = await createOcePlanningHandler(d, actor, g)(get(`?project_id=${P.toUpperCase()}&lot_id=${L}`));
  assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'private, no-store');
  const body = await r.json();
  assert.deepEqual(Object.keys(body), ['data']); assert.equal(body.data.ok, true); assert.equal(body.data.total_activities, 1);
  assert.deepEqual(d.calls[0], ['oce_summary_access', { p_project_id: P, p_request_id: L }], 'ids are lower-cased; actor id is never sent');
});

test('gateway failures stay local: disabled, not admitted, outage', async () => {
  const d = db(true);
  const off = await createOcePlanningHandler(d, actor, disabledGateway)(get(`?project_id=${P}&lot_id=${L}`));
  assert.equal(off.status, 503); assert.equal((await off.json()).code, 'OCE_DISABLED');
  const notAdmitted = await createOcePlanningHandler(d, actor, new InMemoryOceGateway())(get(`?project_id=${P}&lot_id=${L}`));
  assert.equal(notAdmitted.status, 403);
  const g = await seeded(); g.failNext = new OceGatewayError('unavailable', 'oce_unavailable', 503);
  const down = await createOcePlanningHandler(d, actor, g)(get(`?project_id=${P}&lot_id=${L}`));
  assert.equal(down.status, 503); assert.deepEqual(await down.json(), { error: 'Résumé technique temporairement indisponible.', code: 'UNAVAILABLE' });
});
