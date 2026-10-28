import type { ProviderCapability, ProviderCountry, ProviderDomain, ProviderEnvironment } from './contracts.js';

export const PROVIDER_INTEGRATIONS_CONTRACT_VERSION = 'provider-integrations.v1' as const;

export type ProviderManifestField = Readonly<{
  key: string;
  label: string;
  help: string;
  required: boolean;
  type: 'text' | 'enum' | 'boolean' | 'number';
  options?: readonly string[];
  secret: boolean;
}>;

export type ProviderManifest = Readonly<{
  providerId: string;
  manifestVersion: string;
  label: string;
  category: ProviderDomain;
  status: 'candidate' | 'installed';
  adapterVersion: string | null;
  countries: readonly ProviderCountry[];
  capabilities: readonly ProviderCapability[];
  environments: readonly ProviderEnvironment[];
  authModes: readonly ('api_key' | 'oauth2' | 'service_account' | 'platform_managed')[];
  liveLocked: boolean;
  connectionCheckSupported: boolean;
  fields: readonly ProviderManifestField[];
}>;

/**
 * Versioned allowlist only. A manifest describes a reviewed adapter; it never
 * accepts an endpoint, script, callback verifier or protocol from an Admin.
 */
export const PROVIDER_MANIFESTS: readonly ProviderManifest[] = Object.freeze([
  Object.freeze({
    providerId: 'dropbox_sign_test', manifestVersion: '1', label: 'Dropbox Sign TEST',
    category: 'signature', status: 'installed', adapterVersion: '1.0.0-test', countries: ['TN'],
    capabilities: ['signature.sequential', 'signature.evidence'], environments: ['sandbox'],
    authModes: ['api_key'], liveLocked: true, connectionCheckSupported: false, fields: [{ key: 'api_key', label: 'Clé API Dropbox Sign TEST', help: 'Clé sandbox Dropbox Sign, conservée uniquement dans le coffre serveur.', required: true, type: 'text', secret: true }],
  } satisfies ProviderManifest),
  Object.freeze({
    providerId: 'ngsign', manifestVersion: '1', label: 'NGSign', category: 'signature',
    status: 'candidate', adapterVersion: null, countries: ['TN'],
    capabilities: ['signature.sequential', 'signature.simple', 'signature.qualified', 'signature.evidence'],
    environments: ['sandbox', 'live'], authModes: ['api_key'], liveLocked: true,
    connectionCheckSupported: false, fields: [],
  } satisfies ProviderManifest),
  Object.freeze({
    providerId: 'tuntrust_digigo', manifestVersion: '1', label: 'TunTrust DigiGO', category: 'signature',
    status: 'candidate', adapterVersion: null, countries: ['TN'],
    capabilities: ['signature.qualified', 'signature.evidence'], environments: ['sandbox', 'live'],
    authModes: ['api_key'], liveLocked: true, connectionCheckSupported: false, fields: [],
  } satisfies ProviderManifest),
  Object.freeze({
    providerId: 'mapbox', manifestVersion: '1', label: 'Mapbox', category: 'maps',
    status: 'candidate', adapterVersion: null, countries: ['TN'],
    capabilities: ['maps.map', 'maps.geocode', 'maps.autocomplete', 'maps.route'],
    environments: ['sandbox', 'live'], authModes: ['api_key'], liveLocked: true,
    connectionCheckSupported: false, fields: [],
  } satisfies ProviderManifest),
  Object.freeze({
    providerId: 'resend', manifestVersion: '1', label: 'Resend', category: 'messaging',
    status: 'candidate', adapterVersion: null, countries: ['TN'], capabilities: ['messaging.email'],
    environments: ['sandbox', 'live'], authModes: ['api_key'], liveLocked: true,
    connectionCheckSupported: false, fields: [],
  } satisfies ProviderManifest),
  Object.freeze({
    providerId: 'supabase_storage', manifestVersion: '1', label: 'Supabase Storage', category: 'documents',
    status: 'candidate', adapterVersion: null, countries: ['TN'],
    capabilities: ['documents.store', 'documents.archive'], environments: ['sandbox', 'live'],
    authModes: ['platform_managed'], liveLocked: true, connectionCheckSupported: false, fields: [],
  } satisfies ProviderManifest),
]);
