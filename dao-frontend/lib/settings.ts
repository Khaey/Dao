'use client';
import { useEffect, useState } from 'react';
import { supabaseBrowser } from './supabase-browser';
import { SETTINGS_CATALOG, type SettingDefinition } from '../../dao-backend/src/settings/catalog';

export { SETTINGS_CATALOG };
export type { SettingDefinition };
export type SettingEntry = { value: any; state: 'available' | 'unavailable' | 'owner_choice'; source: string; reason?: string; owner_choice?: any; requires?: string };
export type EffectiveSettings = { catalog_version: number; version: number; workspace: string; project_id: string | null; settings: Record<string, SettingEntry> };
export type SettingOverride = { id: string; key: string; scope: 'global' | 'role' | 'account' | 'project'; workspace: string | null; user_id: string | null; project_id: string | null;
  target_label: string | null; value: any; locked: boolean; valid_until: string | null; live: boolean; reason: string; mandate_id: string | null; created_at: string };
export type AdminOverview = { catalog_version: number; version: number; overrides: SettingOverride[]; trades: Array<{ id: string; code: string; name: string; active: boolean }>;
  definitions: Array<{ key: string; family: string; type: string; default: any; min: number | null; max: number | null; values: string[] | null; scopes: string[]; workspaces: string[];
    delegable: boolean; effect: string; sensitivity: string; implemented: boolean; global_value: number | null }> };
export type SettingEvent = { id: string; created_at: string; action: string; key: string; scope: string; workspace: string | null; target_label: string | null; target_ref: string | null;
  old_value: any; new_value: any; old_locked: boolean | null; new_locked: boolean | null; valid_until: string | null; reason: string; actor: string | null; version: number; mandate_id: string | null };

export class SettingsError extends Error { constructor(message: string, public code = '') { super(message); } }
async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabaseBrowser().rpc(name, args);
  if (error) throw new SettingsError(error.message || 'Action impossible', error.code);
  return data as T;
}

export const fetchMySettings = (workspace: string | null = null, projectId: string | null = null) =>
  call<EffectiveSettings>('my_effective_settings', { p_workspace: workspace, p_project_id: projectId });
export const fetchAdminOverview = () => call<AdminOverview>('admin_settings_overview');
export const fetchAdminHistory = (key: string | null, before?: { created_at: string; id: string }) =>
  call<SettingEvent[]>('admin_settings_history', { p_key: key, p_limit: 50, p_before: before?.created_at ?? null, p_before_id: before?.id ?? null });
export const fetchAdminPreview = (userId: string, workspace: string, projectId: string | null = null) =>
  call<EffectiveSettings>('admin_preview_settings', { p_user: userId, p_workspace: workspace, p_project_id: projectId });
export const adminSettingCommand = (action: 'set' | 'clear', input: Record<string, unknown>) =>
  call<{ override_id: string | null; version: number }>('admin_setting_command', { p_action: action, p_input: input });
export const adminSetTradeActive = (tradeId: string, active: boolean, reason: string) =>
  call('admin_set_trade_active', { p_trade_id: tradeId, p_active: active, p_reason: reason });
// #465 : référentiel métiers (ajout/renommage audités) et propositions Client/Artisan revues par l'Admin.
export type TradeProposal = { id: string; created_at: string; label: string; context: 'project' | 'profile'; proposer: string };
export const adminSaveTrade = (tradeId: string | null, name: string, reason: string) =>
  call<{ trade_id: string; changed: boolean }>('admin_save_trade', { p_trade_id: tradeId, p_name_fr: name, p_name_ar: null, p_reason: reason });
export const fetchTradeProposals = () => call<TradeProposal[]>('admin_trade_proposals');
export const adminReviewTradeProposal = (id: string, decision: 'accept' | 'reject', tradeId: string | null, name: string | null, reason: string) =>
  call('admin_review_trade_proposal', { p_proposal_id: id, p_decision: decision, p_trade_id: tradeId, p_name: name, p_reason: reason });
export const proposeTrade = (label: string, context: 'project' | 'profile') =>
  call<{ status: 'pending' | 'exists'; proposal_id?: string; trade_id?: string; name?: string }>('propose_trade', { p_label: label, p_context: context });

// S4 delegations (A1/A2/A7/A8).
export type Mandate = { id: string; staff_user_id?: string; staff_label?: string | null; keys: string[]; actions: string[]; scopes: string[]; valid_until: string;
  live?: boolean; reason?: string; created_at?: string; revoked_at?: string | null };
export type Delegations = { managers: Target[]; mandates: Mandate[];
  portfolio: Array<{ id: string; staff_user_id: string; staff_label: string | null; account_user_id: string; account_label: string | null; reason: string; created_at: string }> };
export type Target = { id: string; name: string };
export type MyDelegation = { mandates: Mandate[]; accounts?: Array<Target & { roles: string[] }>; projects?: Target[]; overrides?: SettingOverride[] };
export const fetchAdminDelegations = () => call<Delegations>('admin_settings_delegations');
export const adminDelegationCommand = (action: 'grant_mandate' | 'revoke_mandate' | 'assign_account' | 'unassign_account', input: Record<string, unknown>) =>
  call<{ id: string }>('admin_delegation_command', { p_action: action, p_input: input });
export const fetchMyDelegation = () => call<MyDelegation>('my_settings_delegation');
export const managerSettingCommand = (action: 'set' | 'clear', input: Record<string, unknown>) =>
  call<{ override_id: string | null; version: number }>('manager_setting_command', { p_action: action, p_input: input });
export const fetchManagerPreview = (userId: string, workspace: string, projectId: string | null = null) =>
  call<EffectiveSettings>('manager_preview_settings', { p_user: userId, p_workspace: workspace, p_project_id: projectId });
export const MANAGER_MAX_DAYS = 90;

export const definitionOf = (key: string) => SETTINGS_CATALOG.find(d => d.key === key);
export const settingLabel = (key: string) => definitionOf(key)?.label ?? key;
export const workspaceLabels: Record<string, string> = { client: 'Client', contractor: 'Artisan', staff: 'Équipe D.A.O.' };
export const scopeLabels: Record<string, string> = { global: 'Plateforme', role: 'Espace', account: 'Compte', project: 'Chantier' };
export const modeLabels: Record<string, string> = { public: 'Public', targeted: 'Ciblé', invite_only: 'Sur invitation' };
export const unitLabels: Record<string, string> = { day: 'jours', hour: 'heures', per_minute: 'par minute', megabyte: 'Mo' };
export const sourceLabels: Record<string, string> = { default: 'Valeur par défaut', global: 'Plateforme', global_locked: 'Plateforme (verrouillée)', role: 'Espace',
  account: 'Exception compte', project: 'Exception chantier', owner: 'Choix du titulaire', platform: 'Plateforme' };

export function formatSettingValue(key: string, value: any): string {
  const def = definitionOf(key);
  if (value === null || value === undefined) return '—';
  if (def?.type.kind === 'int') return `${value} ${unitLabels[def.type.unit]}`;
  if (def?.type.kind === 'enum_set' && Array.isArray(value)) return value.length ? value.map(v => modeLabels[v] ?? v).join(', ') : 'Aucun';
  if (def?.type.kind === 'enum') return workspaceLabels[value] ?? String(value);
  if (def?.type.kind === 'flags' && typeof value === 'object') return Object.entries(value).filter(([, on]) => on).map(([k]) => k).join(', ') || 'Aucune';
  if (typeof value === 'boolean') return value ? 'Actif' : 'Inactif';
  return String(value);
}

// A10: neutral wording for Clients/Artisans; never the author or internal reason.
export function settingAvailable(settings: EffectiveSettings | null | undefined, key: string) {
  const entry = settings?.settings[key];
  return !entry || entry.state === 'available';
}
export const RESTRICTED_MESSAGE = 'Option non disponible pour ce dossier. Contactez l’assistance si besoin.';

// One read per screen; refreshed when the tab becomes visible again. Errors
// (role not held, no access) leave the UI unchanged: the server still decides.
export function useMySettings(workspace: string | null | undefined, projectId: string | null = null) {
  const [settings, setSettings] = useState<EffectiveSettings | null>(null);
  useEffect(() => {
    if (workspace === undefined) { setSettings(null); return; }
    let live = true; const load = () => fetchMySettings(workspace, projectId).then(s => { if (live) setSettings(s); }).catch(() => { if (live) setSettings(null); });
    void load(); const visible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', visible); return () => { live = false; document.removeEventListener('visibilitychange', visible); };
  }, [workspace, projectId]);
  return settings;
}
