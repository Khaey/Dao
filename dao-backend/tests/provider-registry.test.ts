import test from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDER_CANDIDATES, resolveProviderForNewOperation, type InstalledAdapter, type ProviderPolicy, type ProviderQuery } from '../src/integrations/registry.js';

const query: ProviderQuery = { domain: 'signature', capability: 'signature.sequential', country: 'TN', legalEntityId: 'logiclab-tn', environment: 'sandbox' };
const policy: ProviderPolicy = { id: 'policy-1', providerId: 'test-only', domain: 'signature', capability: 'signature.sequential', country: 'TN', legalEntityId: 'logiclab-tn', environment: 'sandbox', state: 'enabled', version: 1, connectionId: 'private-reference' };
const adapter: InstalledAdapter = { id: 'test-only', domain: 'signature', version: '0.0-test', countries: ['TN'], verifiedCapabilities: ['signature.sequential'], supportedEnvironments: ['sandbox'] };
const installed = new Map([[adapter.id, adapter]]);
const resolve = (q = query, p: readonly ProviderPolicy[] = [policy], a: ReadonlyMap<string, InstalledAdapter> = installed) => resolveProviderForNewOperation(q, p, a);
const reason = (res: ReturnType<typeof resolve>) => res.kind === 'unavailable' ? res.reason : null;

test('commercial candidates are not active, and no adapter is installed by default', () => {
  assert.deepEqual(PROVIDER_CANDIDATES.map(c => c.status), ['candidate', 'candidate']);
  assert.equal(reason(resolve(query, [], new Map())), 'not_configured');
  assert.equal(reason(resolve(query, [{ ...policy, providerId: 'ngsign' }], new Map())), 'adapter_not_installed');
  assert.equal(reason(resolve(query, [{ ...policy, providerId: 'tuntrust_digigo' }], new Map())), 'adapter_not_installed');
});

test('fails closed for live, regardless of forged configuration and installed test adapter', () => {
  const liveQuery: ProviderQuery = { ...query, environment: 'live' };
  const livePolicy: ProviderPolicy = { ...policy, environment: 'live' };
  assert.equal(reason(resolve(liveQuery, [livePolicy])), 'live_not_enabled');
});

test('does not silently choose among ambiguous, wrong-country or disabled policies', () => {
  assert.equal(reason(resolve(query, [policy, { ...policy, id: 'policy-2', providerId: 'backup' }])), 'ambiguous_policy');
  assert.equal(reason(resolve(query, [{ ...policy, country: 'TN', state: 'disabled' }])), 'disabled');
  assert.equal(reason(resolve({ ...query, legalEntityId: 'different-entity' })), 'not_configured');
  assert.equal(reason(resolve({ ...query, capability: 'escrow.hold' })), 'invalid_capability');
});

test('requires compiled adapter with verified capability and matching environment', () => {
  assert.equal(reason(resolve(query, [policy], new Map())), 'adapter_not_installed');
  assert.equal(reason(resolve(query, [policy], new Map([['test-only', { ...adapter, verifiedCapabilities: [] }]]))), 'capability_not_verified');
  assert.equal(reason(resolve(query, [policy], new Map([['test-only', { ...adapter, supportedEnvironments: ['live'] }]]))), 'environment_not_supported');
  assert.equal(reason(resolve(query, [{ ...policy, connectionId: '' }])), 'adapter_not_installed');
});

test('pins immutable sandbox selection; changing defaults does not rewrite an existing operation', () => {
  const selected = resolve();
  assert.equal(selected.kind, 'selected_sandbox');
  if (selected.kind !== 'selected_sandbox') return;
  assert.ok(Object.isFrozen(selected.pinned));
  assert.equal(selected.pinned.providerId, 'test-only');
  assert.equal(selected.pinned.policyVersion, 1);
  assert.equal(selected.pinned.adapterVersion, '0.0-test');
  const newDefault = { ...policy, providerId: 'other', version: 2 };
  assert.equal(reason(resolve(query, [newDefault])), 'adapter_not_installed');
  assert.equal(selected.pinned.providerId, 'test-only');
  assert.equal(selected.pinned.policyVersion, 1);
  assert.ok(!JSON.stringify(selected).includes('apiKey'));
});
