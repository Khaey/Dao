import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SecretStoreError,
  assertAdminSecretMutation,
  unavailableSecretStore,
  validateSecretInput,
} from '../src/integrations/secretStore.js';

const id = '00000000-0000-4000-8000-000000000001';

test('secret boundary validates opaque connection/key and rejects multiline values', () => {
  validateSecretInput(id, 'api_key', 'sandbox-value');
  assert.throws(() => validateSecretInput('not-an-id', 'api_key', 'x'), (e) => e instanceof SecretStoreError && e.code === 'invalid_secret');
  assert.throws(() => validateSecretInput(id, 'API_KEY', 'x'), (e) => e instanceof SecretStoreError && e.code === 'invalid_secret');
  assert.throws(() => validateSecretInput(id, 'api_key', 'x\nleak'), (e) => e instanceof SecretStoreError && e.code === 'invalid_secret');
});

test('unavailable vault never pretends to store or verify a credential', async () => {
  await assert.rejects(() => unavailableSecretStore.put(id, 'api_key', 'x'), (e) => e instanceof SecretStoreError && e.code === 'vault_unavailable');
  await assert.rejects(() => unavailableSecretStore.presence(id, 'api_key'), (e) => e instanceof SecretStoreError && e.code === 'vault_unavailable');
});

test('only dao_admin may mutate provider secrets', () => {
  assert.doesNotThrow(() => assertAdminSecretMutation('dao_admin'));
  for (const role of ['dao_reviewer', 'client', 'artisan', 'anonymous', null, undefined]) {
    assert.throws(() => assertAdminSecretMutation(role), /forbidden/);
  }
});
