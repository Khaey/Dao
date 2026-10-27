'use client';
import { supabaseBrowser } from './supabase-browser';

// #515 — contrat DTO de l'interface Admin « Intégrations & API ».
// Le serveur (DEV 4, #505) calcule tous les états ; l'UI n'en déduit aucun à partir d'un nom.
// Aucun secret n'est jamais renvoyé : seulement sa présence et sa date de rotation.

export type IntegrationEnvironment = 'sandbox' | 'live';
export type ConnectorStatus = 'candidate' | 'installed';
export type ConnectionState = 'unconfigured' | 'configured' | 'verified' | 'active_sandbox' | 'active_live' | 'error' | 'suspended';

export type ManifestField = {
  key: string; label: string; help?: string | null; required: boolean;
  type: 'text' | 'enum' | 'boolean' | 'number';
  options?: Array<{ value: string; label: string }> | null;
  secret: boolean; // Saisi uniquement via le flux serveur ; jamais relu.
};
export type IntegrationManifest = {
  provider_id: string; label: string; category: string; status: ConnectorStatus;
  adapter_version: string | null; countries: string[]; capabilities: string[];
  environments: IntegrationEnvironment[]; live_locked: boolean; fields: ManifestField[];
};
export type IntegrationCategory = { key: string; label: string; sensitive: boolean; capabilities: Array<{ key: string; label: string }> };
export type IntegrationCheck = { status: 'unknown' | 'unconfigured' | 'verified' | 'error'; at: string | null; reason: string | null };
export type IntegrationConnection = {
  id: string; provider_id: string; alias: string; category: string; country: string; legal_entity_id: string;
  environment: IntegrationEnvironment; state: ConnectionState; params: Record<string, string | number | boolean>;
  secrets: Array<{ key: string; present: boolean; rotated_at: string | null }>;
  last_check: IntegrationCheck | null; version: number;
};
export type IntegrationPolicy = {
  id: string; category: string; capability: string; country: string; legal_entity_id: string;
  environment: IntegrationEnvironment; connection_id: string | null; version: number;
};
export type IntegrationsOverview = {
  version: number; markets: string[]; legal_entities: Array<{ id: string; label: string }>;
  categories: IntegrationCategory[]; connectors: IntegrationManifest[];
  connections: IntegrationConnection[]; policies: IntegrationPolicy[];
};
export type IntegrationEvent = { id: string; at: string; actor: string | null; action: string; connection_id: string | null; reason: string; summary: string };

export type IntegrationCommand =
  | { action: 'create_connection'; provider_id: string; alias: string; country: string; legal_entity_id: string; environment: IntegrationEnvironment; params: Record<string, unknown> }
  | { action: 'update_connection'; connection_id: string; expected_version: number; alias: string; params: Record<string, unknown> }
  | { action: 'test_connection'; connection_id: string }
  | { action: 'suspend' | 'resume'; connection_id: string; expected_version: number }
  | { action: 'set_default'; category: string; capability: string; country: string; legal_entity_id: string; environment: IntegrationEnvironment; connection_id: string | null; expected_version: number | null };

export class IntegrationsError extends Error {
  constructor(message: string, public code = '') { super(message); }
  /** Le backend #505 n'est pas encore déployé : RPC absente. */
  get unavailable() { return this.code === 'PGRST202' || this.code === '42883'; }
}

export function integrationErrorMessage(e: unknown) {
  const err = e instanceof IntegrationsError ? e : null;
  if (err?.code === '42501') return 'Action réservée à l’Admin D.A.O.';
  if (err?.code === '40001') return 'La configuration a changé entre-temps. Rechargez avant de réessayer.';
  if (err?.unavailable) return 'Le service des intégrations n’est pas encore disponible sur cet environnement.';
  return err?.message || 'Action impossible pour le moment.';
}

async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabaseBrowser().rpc(name, args);
  if (error) throw new IntegrationsError(error.message || 'Action impossible', error.code);
  return data as T;
}

export type IntegrationsApi = {
  overview(): Promise<IntegrationsOverview>;
  events(connectionId: string | null): Promise<IntegrationEvent[]>;
  command(cmd: IntegrationCommand, reason: string): Promise<{ version: number; connection_id?: string }>;
  setSecret(connectionId: string, key: string, value: string, reason: string): Promise<{ present: boolean; rotated_at: string }>;
};

export const integrationsApi: IntegrationsApi = {
  overview: () => call<IntegrationsOverview>('admin_integrations_overview'),
  events: connectionId => call<IntegrationEvent[]>('admin_integration_events', { p_connection_id: connectionId, p_limit: 50 }),
  command: ({ action, ...input }, reason) => call<{ version: number; connection_id?: string }>('admin_integration_command', { p_action: action, p_input: { ...input, reason } }),
  // Le secret part directement vers une fonction serveur (coffre) et n'est jamais stocké côté navigateur.
  setSecret: async (connectionId, key, value, reason) => {
    const { data, error } = await supabaseBrowser().functions.invoke('integration-secret', { body: { connection_id: connectionId, key, value, reason } });
    if (error) throw new IntegrationsError('Le secret n’a pas pu être enregistré.', 'secret');
    return data as { present: boolean; rotated_at: string };
  },
};

export const STATE_LABEL: Record<ConnectionState, string> = {
  unconfigured: 'Non configuré', configured: 'Configuré, non testé', verified: 'Vérifié', active_sandbox: 'Actif (test)',
  active_live: 'Actif (réel)', error: 'Erreur', suspended: 'Suspendu',
};
export const STATE_TONE: Record<ConnectionState, string> = {
  unconfigured: 'bg-black/5 text-black/60', configured: 'bg-amber-50 text-amber-800', verified: 'bg-teal/10 text-teal',
  active_sandbox: 'bg-teal/10 text-teal', active_live: 'bg-emerald-100 text-emerald-800', error: 'bg-red-50 text-red-700', suspended: 'bg-black/10 text-black/70',
};

export type CatalogFilter = 'all' | 'active' | 'sandbox' | 'error' | 'not_installed';
/** Filtres du catalogue : un connecteur candidat n'est jamais compté comme connecté. */
export function connectorMatches(m: IntegrationManifest, conns: IntegrationConnection[], filter: CatalogFilter, query: string) {
  const q = query.trim().toLowerCase();
  if (q && !`${m.label} ${m.provider_id}`.toLowerCase().includes(q)) return false;
  const mine = conns.filter(c => c.provider_id === m.provider_id);
  switch (filter) {
    case 'active': return mine.some(c => c.state === 'active_sandbox' || c.state === 'active_live');
    case 'sandbox': return mine.some(c => c.environment === 'sandbox');
    case 'error': return mine.some(c => c.state === 'error');
    case 'not_installed': return m.status === 'candidate';
    default: return true;
  }
}

/** Connexions éligibles comme défaut : installées, même catégorie/pays/entité/environnement, non suspendues. */
export function eligibleForDefault(p: Pick<IntegrationPolicy, 'category' | 'capability' | 'country' | 'legal_entity_id' | 'environment'>, o: IntegrationsOverview) {
  return o.connections.filter(c => {
    const m = o.connectors.find(x => x.provider_id === c.provider_id);
    return !!m && m.status === 'installed' && m.capabilities.includes(p.capability) && c.category === p.category && c.country === p.country
      && c.legal_entity_id === p.legal_entity_id && c.environment === p.environment && c.state !== 'suspended' && c.state !== 'unconfigured';
  });
}
