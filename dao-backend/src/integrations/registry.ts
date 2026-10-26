import { CAPABILITY_DOMAIN, type ProviderCapability, type ProviderCountry, type ProviderDomain, type ProviderEnvironment } from './contracts.js';

/**
 * #505 I0.5 — fail-closed, side-effect-free provider selection.
 * This module never connects to an API or writes a record, and live activation
 * is deliberately blocked until a separate, legally approved implementation.
 */
export type ProviderCandidate = Readonly<{
  id: string;
  domain: ProviderDomain;
  country: ProviderCountry;
  status: 'candidate';
}>;

/** Public facts only; a commercial candidate is NOT an installed connector. */
export const PROVIDER_CANDIDATES: readonly ProviderCandidate[] = Object.freeze([
  Object.freeze({ id: 'ngsign', domain: 'signature', country: 'TN', status: 'candidate' as const }),
  Object.freeze({ id: 'tuntrust_digigo', domain: 'signature', country: 'TN', status: 'candidate' as const }),
]);

/** Registered in compiled server code following review, not created by admin UI. */
export type InstalledAdapter = Readonly<{
  id: string;
  domain: ProviderDomain;
  version: string;
  countries: readonly ProviderCountry[];
  verifiedCapabilities: readonly ProviderCapability[];
  supportedEnvironments: readonly ProviderEnvironment[];
}>;

/** Future audited configuration read from server, not a browser request. */
export type ProviderPolicy = Readonly<{
  id: string;
  providerId: string;
  domain: ProviderDomain;
  capability: ProviderCapability;
  country: ProviderCountry;
  legalEntityId: string;
  environment: ProviderEnvironment;
  state: 'disabled' | 'enabled';
  version: number;
  connectionId: string; // Opaque, no API keys/secrets.
}>;

export type ProviderQuery = Readonly<{
  domain: ProviderDomain;
  capability: ProviderCapability;
  country: ProviderCountry;
  legalEntityId: string;
  environment: ProviderEnvironment;
}>;

export type PinnedProvider = Readonly<{
  providerId: string;
  adapterVersion: string;
  policyId: string;
  policyVersion: number;
  connectionId: string;
  domain: ProviderDomain;
  capability: ProviderCapability;
  country: ProviderCountry;
  environment: ProviderEnvironment;
  legalEntityId: string;
}>;

export type ProviderResolution =
  | Readonly<{ kind: 'unavailable'; reason: 'invalid_capability' | 'live_not_enabled' | 'not_configured' | 'ambiguous_policy' | 'disabled' | 'adapter_not_installed' | 'capability_not_verified' | 'environment_not_supported' }>
  | Readonly<{ kind: 'selected_sandbox'; pinned: PinnedProvider }>;

/** No fallback to another provider; session metadata is frozen for future persistence. */
export function resolveProviderForNewOperation(
  query: ProviderQuery,
  policies: readonly ProviderPolicy[],
  installedAdapters: ReadonlyMap<string, InstalledAdapter>,
): ProviderResolution {
  if (CAPABILITY_DOMAIN[query.capability] !== query.domain) return { kind: 'unavailable', reason: 'invalid_capability' };
  // No live provider execution whatsoever in I0.5, even if configuration claims enabled.
  if (query.environment === 'live') return { kind: 'unavailable', reason: 'live_not_enabled' };
  const matches = policies.filter(p => p.domain === query.domain && p.capability === query.capability
    && p.country === query.country && p.legalEntityId === query.legalEntityId && p.environment === query.environment);
  if (!matches.length) return { kind: 'unavailable', reason: 'not_configured' };
  if (matches.length !== 1) return { kind: 'unavailable', reason: 'ambiguous_policy' };
  const policy = matches[0];
  if (policy.state !== 'enabled') return { kind: 'unavailable', reason: 'disabled' };
  const adapter = installedAdapters.get(policy.providerId);
  if (!adapter || adapter.id !== policy.providerId || adapter.domain !== query.domain || !adapter.version.trim()
    || !policy.id.trim() || !policy.connectionId.trim() || !Number.isSafeInteger(policy.version) || policy.version < 1) {
    return { kind: 'unavailable', reason: 'adapter_not_installed' };
  }
  if (!adapter.countries.includes(query.country) || !adapter.verifiedCapabilities.includes(query.capability)) {
    return { kind: 'unavailable', reason: 'capability_not_verified' };
  }
  if (!adapter.supportedEnvironments.includes(query.environment)) {
    return { kind: 'unavailable', reason: 'environment_not_supported' };
  }
  const pinned = Object.freeze({
    providerId: adapter.id, adapterVersion: adapter.version, policyId: policy.id,
    policyVersion: policy.version, connectionId: policy.connectionId,
    domain: query.domain, capability: query.capability, country: query.country,
    environment: query.environment, legalEntityId: query.legalEntityId,
  });
  return Object.freeze({ kind: 'selected_sandbox' as const, pinned });
}
