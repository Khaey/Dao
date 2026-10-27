import test from 'node:test';
import assert from 'node:assert/strict';
import { createClientOfficialSubLotHandler } from '../src/server/clientOfficialSubLotHandler.js';

const REQUEST = '00000000-0000-4000-8000-000000000001';
const VERSION = '00000000-0000-4000-8000-000000000002';
const SUBLOT = '00000000-0000-4000-8000-000000000003';
const result = { requestId: REQUEST, requestVersionId: VERSION, canEdit: true, items: [] };
function fixture(error: any = null) {
  const calls: any[] = [];
  const db = { calls, rpc: async (name: string, args: any) => { calls.push({ name, args }); return { data: result, error }; } };
  const actor = async (header: string | null) => header === 'Bearer valid' ? { id: 'actor' } : null;
  return { db, handler: createClientOfficialSubLotHandler(db, actor) };
}
const request = (url: string, method = 'GET', body?: unknown, authorization = 'Bearer valid') =>
  new Request('https://dao.test/api/projects/requests/sub-lots' + url, {
    method, headers: { authorization, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

test('official sub-lot API requires authentication and accepts only GET/PUT', async () => {
  const { handler, db } = fixture();
  assert.equal((await handler(request('?request_id=' + REQUEST, 'GET', undefined, ''))).status, 401);
  assert.equal((await handler(request('?request_id=' + REQUEST, 'POST'))).status, 405);
  assert.equal(db.calls.length, 0);
});

test('read endpoint validates query and uses the JWT scoped read RPC', async () => {
  const { handler, db } = fixture();
  assert.equal((await handler(request('?request_id=bad'))).status, 400);
  const response = await handler(request('?request_id=' + REQUEST));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(db.calls, [{ name: 'native_request_sub_lots_v1', args: { p_request_id: REQUEST } }]);
});

test('replacement validates ordered list and preserves millimes as strings', async () => {
  const { handler, db } = fixture();
  const body = { requestId: REQUEST, expectedRequestVersionId: VERSION,
    items: [{ id: SUBLOT, title: ' Pose ', scope: ' Installation ', budgetMillimes: '9007199254740991' }] };
  assert.equal((await handler(request('', 'PUT', { ...body, items: [{ ...body.items[0], extra: true }] }))).status, 400);
  const response = await handler(request('', 'PUT', body));
  assert.equal(response.status, 200);
  assert.deepEqual(db.calls[0], { name: 'replace_client_request_sub_lots_v1', args: {
    p_request_id: REQUEST, p_expected_request_version_id: VERSION,
    p_items: [{ id: SUBLOT, title: 'Pose', scope: 'Installation', budgetMillimes: '9007199254740991' }],
  } });
});

test('database authorization, stale-version and unavailable errors remain distinct', async () => {
  for (const [error, status, code] of [
    [{ code: '42501' }, 403, 'FORBIDDEN'], [{ code: 'P0002' }, 404, 'NOT_FOUND'],
    [{ code: '40001' }, 409, 'CONFLICT'], [{ code: '23514' }, 400, 'BAD_REQUEST'],
    [{ code: 'XX000', message: 'secret' }, 503, 'UNAVAILABLE'],
  ] as const) {
    const response = await fixture(error).handler(request('', 'PUT', {
      requestId: REQUEST, expectedRequestVersionId: VERSION, items: [],
    }));
    assert.equal(response.status, status);
    const json = await response.json() as any;
    assert.equal(json.code, code);
    assert.ok(!JSON.stringify(json).includes('secret'));
  }
});
