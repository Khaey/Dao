import test from 'node:test';
import assert from 'node:assert/strict';
import { createOceStatusHandler, oceIntegrationEnabled } from '../src/server/oceStatusHandler.js';

// OCE is optional: the interface hides every OCE planning block (and its calls) while the integration is off.
test('oce status reflects the opt-in switch without exposing configuration', async () => {
  assert.equal(oceIntegrationEnabled({}), false);
  assert.equal(oceIntegrationEnabled({ DAO_OCE_ENABLED: '0' }), false);
  assert.equal(oceIntegrationEnabled({ DAO_OCE_ENABLED: '1', DAO_OCE_GATEWAY_SOCKET: 'relative.sock' }), false);
  assert.equal(oceIntegrationEnabled({ DAO_OCE_ENABLED: '1' }), true);

  const off = await createOceStatusHandler({})(new Request('https://dao.test/api/oce/status'));
  assert.equal(off.status, 200); assert.equal(off.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await off.json(), { data: { enabled: false } });
  const on = await createOceStatusHandler({ DAO_OCE_ENABLED: '1', DAO_OCE_GATEWAY_SOCKET: '/run/x/gateway.sock' })(new Request('https://dao.test/api/oce/status'));
  assert.deepEqual(await on.json(), { data: { enabled: true } });
  assert.equal((await createOceStatusHandler({})(new Request('https://dao.test/api/oce/status', { method: 'POST' }))).status, 405);
});
