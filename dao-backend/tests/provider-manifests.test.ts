import test from 'node:test';
import assert from 'node:assert/strict';
import { CAPABILITY_DOMAIN } from '../src/integrations/contracts.js';
import { PROVIDER_INTEGRATIONS_CONTRACT_VERSION, PROVIDER_MANIFESTS } from '../src/integrations/manifests.js';

test('provider manifests are versioned, unique and capability-scoped', () => {
  assert.equal(PROVIDER_INTEGRATIONS_CONTRACT_VERSION, 'provider-integrations.v1');
  assert.equal(new Set(PROVIDER_MANIFESTS.map(manifest => manifest.providerId)).size, PROVIDER_MANIFESTS.length);
  for (const manifest of PROVIDER_MANIFESTS) {
    assert.match(manifest.providerId, /^[a-z][a-z0-9_]{1,63}$/);
    assert.ok(manifest.countries.length > 0); assert.ok(manifest.environments.length > 0); assert.ok(manifest.capabilities.length > 0);
    for (const capability of manifest.capabilities) assert.equal(CAPABILITY_DOMAIN[capability], manifest.category);
    if (manifest.status === 'candidate') { assert.equal(manifest.adapterVersion, null); assert.equal(manifest.connectionCheckSupported, false); }
    else assert.ok(manifest.adapterVersion);
    for (const field of manifest.fields) assert.doesNotMatch(field.key, /url|endpoint|script|javascript|callback/i);
  }
});

test('Dropbox Sign TEST exposes only a bounded real sandbox check', () => {
  const manifest=PROVIDER_MANIFESTS.find(item=>item.providerId==='dropbox_sign_test');
  assert.ok(manifest); assert.equal(manifest.status,'installed'); assert.deepEqual(manifest.environments,['sandbox']);
  assert.equal(manifest.liveLocked,true); assert.equal(manifest.connectionCheckSupported,true);
  assert.deepEqual(manifest.fields.map(field=>({key:field.key,secret:field.secret})),[{key:'api_key',secret:true}]);
});
