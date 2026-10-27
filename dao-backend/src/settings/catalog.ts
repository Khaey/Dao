// D.A.O Settings catalogue (#423 S0, #426 S1). This file is the only place
// where a setting can be defined. The database receives a generated mirror
// (dao_private.setting_definitions) and a CI test fails when they diverge.
// Defaults reproduce today's hard-coded behaviour: S1 changes nothing.

export const SETTINGS_CATALOG_VERSION = 2;

export type SettingFamily = 'capability' | 'value' | 'catalog' | 'federated';
export type SettingWorkspace = 'client' | 'contractor' | 'staff';
export type SettingScope = 'global' | 'role' | 'account' | 'project';
export type SettingType =
  | { kind: 'boolean' }
  | { kind: 'int'; min: number; max: number; unit: 'day' | 'hour' | 'per_minute' | 'megabyte' }
  | { kind: 'enum_set'; values: string[]; minItems: number }
  | { kind: 'enum'; values: string[] }
  | { kind: 'flags'; values: string[] };
export type SettingValue = boolean | number | string | string[] | Record<string, boolean>;

export interface SettingDefinition {
  key: string;
  family: SettingFamily;
  type: SettingType;
  default: SettingValue;
  scopes: SettingScope[];
  workspaces: SettingWorkspace[];
  // A1: restriction/lift only, inside an Admin mandate (S4).
  delegable: boolean;
  effect: 'prospective' | 'live';
  sensitivity: 'normal' | 'sensitive';
  requires: string[];
  // Explicit coded conditions (no generic rules engine).
  conditions: Array<'contract_runtime_enabled'>;
  // Value must stay strictly below other key × factor (checked on write).
  lessThan?: { key: string; factor: number };
  // Owner choice combined with AND (federated key read from its own table).
  ownerChoice?: string;
  // Federated keys: real storage, never written by the settings engine.
  source?: string;
  implemented: boolean;
  enforcedBy: string[];
  label: string;
}

const ALL: SettingWorkspace[] = ['client', 'contractor', 'staff'];
const capability = (d: Omit<SettingDefinition, 'family' | 'type' | 'default' | 'effect' | 'sensitivity' | 'conditions' | 'requires'> &
  Partial<Pick<SettingDefinition, 'sensitivity' | 'conditions' | 'requires'>>): SettingDefinition => ({
  family: 'capability', type: { kind: 'boolean' }, default: true, effect: 'prospective', sensitivity: 'normal',
  conditions: [], requires: [], ...d,
});
const value = (d: Omit<SettingDefinition, 'family' | 'scopes' | 'delegable' | 'requires' | 'conditions'> &
  Partial<Pick<SettingDefinition, 'requires'>>): SettingDefinition => ({
  family: 'value', scopes: ['global'], delegable: false, requires: [], conditions: [], ...d,
});
const federated = (d: Omit<SettingDefinition, 'family' | 'scopes' | 'delegable' | 'requires' | 'conditions' | 'effect' | 'sensitivity' | 'implemented'>): SettingDefinition => ({
  family: 'federated', scopes: [], delegable: false, requires: [], conditions: [], effect: 'live', sensitivity: 'normal',
  implemented: true, ...d,
});

export const SETTINGS_CATALOG: SettingDefinition[] = [
  // 4.1 Capabilities (11)
  capability({ key: 'client.invite_professionals', scopes: ['global', 'role', 'account', 'project'], workspaces: ['client'],
    delegable: true, implemented: true, enforcedBy: ['issue_project_invitation'], label: 'Inviter des professionnels' }),
  { key: 'publication.visibility_modes', family: 'capability', type: { kind: 'enum_set', values: ['public', 'targeted', 'invite_only'], minItems: 1 },
    default: ['public', 'targeted', 'invite_only'], scopes: ['global', 'role', 'account'], workspaces: ['client'], delegable: true,
    effect: 'prospective', sensitivity: 'normal', requires: [], conditions: [], implemented: true,
    enforcedBy: ['publish_project'], label: 'Modes de publication' },
  capability({ key: 'bids.rfi', scopes: ['global', 'role', 'project'], workspaces: ['client', 'contractor'], delegable: true,
    implemented: true, enforcedBy: ['create_rfi_question'], label: 'Questions avant devis (RFI)' }),
  capability({ key: 'bids.counter_proposals', scopes: ['global', 'role', 'account', 'project'], workspaces: ['client', 'contractor'],
    delegable: true, ownerChoice: 'pref.contractor.counter_offers_optin', implemented: true,
    enforcedBy: ['propose_bid_counter'], label: 'Contre-propositions' }),
  capability({ key: 'bids.multi_lot', scopes: ['global', 'role', 'project'], workspaces: ['contractor'], delegable: false,
    implemented: true, enforcedBy: ['configure_bid_package'], label: 'Offres multi-lots' }),
  // #463: prior D.A.O. review of edits to an already published réalisation. OFF = such an edit
  // stays published. New réalisations, identity, legal data, files and suspensions stay gated.
  capability({ key: 'moderation.portfolio_edit_review', scopes: ['global'], workspaces: ['contractor'], delegable: false,
    sensitivity: 'sensitive', implemented: true, enforcedBy: ['settings_portfolio_republish'],
    label: 'Contrôle D.A.O. des réalisations publiées modifiées' }),
  capability({ key: 'bids.quote_pdf', scopes: ['global', 'role', 'account'], workspaces: ['contractor'], delegable: true,
    implemented: true, enforcedBy: ['DocumentService.bid_documents'], label: 'Devis PDF joint' }),
  capability({ key: 'bids.quote_lines', scopes: ['global', 'role', 'account'], workspaces: ['contractor'], delegable: true,
    implemented: true, enforcedBy: ['replace_bid_quote_lines'], label: 'Devis détaillé' }),
  capability({ key: 'bids.proposed_sub_lots', scopes: ['global', 'role', 'account'], workspaces: ['contractor'], delegable: true,
    implemented: true, enforcedBy: ['replace_bid_sub_lots'], label: 'Sous-lots techniques proposés' }),
  capability({ key: 'client.offer_comparison', scopes: ['global', 'role', 'account', 'project'], workspaces: ['client'], delegable: true,
    implemented: true, enforcedBy: [], label: 'Comparaison des offres' }),
  capability({ key: 'contract.preparation_after_award', scopes: ['global', 'role', 'account'], workspaces: ['client'], delegable: false,
    sensitivity: 'sensitive', conditions: ['contract_runtime_enabled'], implemented: true,
    enforcedBy: ['set_project_contract_enabled'], label: 'Option contrat après attribution' }),
  capability({ key: 'contract.precontract_agreement', scopes: ['global', 'role', 'project'], workspaces: ['client', 'contractor'],
    delegable: false, sensitivity: 'sensitive', implemented: true, enforcedBy: ['propose_precontract_agreement'],
    label: 'Accord précontractuel facultatif' }),

  // 4.2 Bounded values (6) + catalogue (1)
  value({ key: 'publication.default_submission_days', type: { kind: 'int', min: 7, max: 90, unit: 'day' }, default: 30,
    workspaces: ['client'], effect: 'prospective', sensitivity: 'normal', implemented: true,
    enforcedBy: ['submit_bid_version'], label: 'Délai de soumission par défaut' }),
  value({ key: 'invitations.ttl_days', type: { kind: 'int', min: 1, max: 30, unit: 'day' }, default: 7,
    workspaces: ['client', 'contractor'], effect: 'prospective', sensitivity: 'normal', implemented: true,
    enforcedBy: ['issue_project_invitation'], label: 'Validité des invitations' }),
  value({ key: 'invitations.reminder_hours_before', type: { kind: 'int', min: 1, max: 72, unit: 'hour' }, default: 24,
    workspaces: ['client', 'contractor'], effect: 'prospective', sensitivity: 'normal', implemented: true,
    lessThan: { key: 'invitations.ttl_days', factor: 24 }, enforcedBy: ['generate_invitation_expiry_reminders'],
    label: 'Rappel avant expiration d’une invitation' }),
  value({ key: 'messaging.max_per_minute', type: { kind: 'int', min: 5, max: 60, unit: 'per_minute' }, default: 20,
    workspaces: ALL, effect: 'live', sensitivity: 'sensitive', implemented: true,
    enforcedBy: ['send_conversation_message'], label: 'Messages par minute (anti-spam)' }),
  // A6: physical ceiling is the current 20 MB application limit; never raised blindly.
  value({ key: 'uploads.max_file_mb', type: { kind: 'int', min: 1, max: 20, unit: 'megabyte' }, default: 20,
    workspaces: ALL, effect: 'prospective', sensitivity: 'sensitive', implemented: true,
    enforcedBy: ['DocumentService', 'professionalHandler', 'RfiDocumentService'], label: 'Taille maximale des fichiers' }),
  value({ key: 'reviews.response_edit_days', type: { kind: 'int', min: 0, max: 90, unit: 'day' }, default: 30,
    workspaces: ['contractor'], effect: 'prospective', sensitivity: 'normal', implemented: true,
    enforcedBy: ['respond_to_contractor_review'], label: 'Modification d’une réponse à un avis' }),
  { key: 'catalog.trades.active', family: 'catalog', type: { kind: 'boolean' }, default: true, scopes: ['global'],
    workspaces: ['staff'], delegable: false, effect: 'prospective', sensitivity: 'sensitive', requires: [], conditions: [],
    source: 'public.trades.active', implemented: true, enforcedBy: ['trades'], label: 'Métiers actifs' },

  // 4.3 Federated owner choices (5): read only, never moved.
  federated({ key: 'pref.workspace', type: { kind: 'enum', values: ['client', 'contractor'] }, default: 'client',
    workspaces: ['client', 'contractor'], source: 'public.profiles.last_workspace', enforcedBy: ['set_my_workspace'],
    label: 'Espace préféré' }),
  federated({ key: 'pref.notify.invitation_expiring', type: { kind: 'boolean' }, default: true,
    workspaces: ['client', 'contractor'], source: 'public.notification_preferences.invitation_expiring',
    enforcedBy: ['update_my_notification_preferences'], label: 'Rappel d’invitation expirante' }),
  federated({ key: 'pref.contractor.counter_offers_optin', type: { kind: 'boolean' }, default: false,
    workspaces: ['contractor'], source: 'public.contractor_profiles.allow_counter_offers',
    enforcedBy: ['set_my_bid_counter_preference'], label: 'J’accepte les contre-propositions' }),
  federated({ key: 'pref.contractor.contact_visibility',
    type: { kind: 'flags', values: ['website', 'phone', 'whatsapp', 'email', 'social_links', 'exact_address'] },
    default: { website: false, phone: false, whatsapp: false, email: false, social_links: false, exact_address: false },
    workspaces: ['contractor'], source: 'public.contractor_profile_details.show_*', enforcedBy: ['professional_command'],
    label: 'Coordonnées publiques' }),
  federated({ key: 'project.contract_enabled', type: { kind: 'boolean' }, default: false,
    workspaces: ['client'], source: 'public.project_contract_settings.enabled', enforcedBy: ['set_project_contract_enabled'],
    label: 'Contrat préparé après attribution (chantier)' }),
];

export function settingDefinition(key: string): SettingDefinition | undefined {
  return SETTINGS_CATALOG.find(d => d.key === key);
}

export function validateSettingValue(def: SettingDefinition, input: unknown): SettingValue {
  const t = def.type;
  if (t.kind === 'boolean' && typeof input === 'boolean') return input;
  if (t.kind === 'int' && Number.isInteger(input) && (input as number) >= t.min && (input as number) <= t.max) return input as number;
  if (t.kind === 'enum' && typeof input === 'string' && t.values.includes(input)) return input;
  if (t.kind === 'enum_set' && Array.isArray(input) && input.length >= t.minItems && new Set(input).size === input.length
    && input.every(x => typeof x === 'string' && t.values.includes(x))) return [...input].sort((a, b) => t.values.indexOf(a) - t.values.indexOf(b));
  if (t.kind === 'flags' && input && typeof input === 'object' && !Array.isArray(input)) {
    const keys = Object.keys(input);
    if (keys.length === t.values.length && t.values.every(v => typeof (input as Record<string, unknown>)[v] === 'boolean'))
      return Object.fromEntries(t.values.map(v => [v, (input as Record<string, boolean>)[v]]));
  }
  throw new Error(`invalid_setting_value:${def.key}`);
}

// Structural checks: unique keys, defaults valid, dependencies known and acyclic.
export function assertCatalogConsistent(catalog = SETTINGS_CATALOG): void {
  const keys = new Set<string>();
  for (const d of catalog) {
    if (!/^[a-z]+(\.[a-z_]+)+$/.test(d.key) || keys.has(d.key)) throw new Error(`invalid_or_duplicate_key:${d.key}`);
    keys.add(d.key);
    validateSettingValue(d, d.default);
    if (d.family === 'federated' ? !d.source || d.scopes.length : d.scopes[0] !== 'global') throw new Error(`invalid_scopes:${d.key}`);
    if (d.delegable && d.family !== 'capability') throw new Error(`delegable_non_capability:${d.key}`);
  }
  for (const d of catalog) {
    for (const r of [...d.requires, ...(d.ownerChoice ? [d.ownerChoice] : []), ...(d.lessThan ? [d.lessThan.key] : [])])
      if (!keys.has(r) || r === d.key) throw new Error(`unknown_dependency:${d.key}->${r}`);
    if (d.lessThan) {
      const other = catalog.find(x => x.key === d.lessThan!.key)!;
      if (!((d.default as number) < (other.default as number) * d.lessThan.factor)) throw new Error(`invalid_default_relation:${d.key}`);
    }
  }
  const visiting = new Set<string>(), done = new Set<string>();
  const visit = (k: string) => {
    if (done.has(k)) return; if (visiting.has(k)) throw new Error(`dependency_cycle:${k}`);
    visiting.add(k); for (const r of catalog.find(x => x.key === k)!.requires) visit(r); visiting.delete(k); done.add(k);
  };
  catalog.forEach(d => visit(d.key));
}

// Database projection: only what SQL needs to resolve and validate.
export function catalogProjection(catalog = SETTINGS_CATALOG) {
  return catalog.map(d => ({
    key: d.key, family: d.family, type: d.type.kind, default: d.default,
    min: d.type.kind === 'int' ? d.type.min : null, max: d.type.kind === 'int' ? d.type.max : null,
    values: 'values' in d.type ? d.type.values : null, min_items: d.type.kind === 'enum_set' ? d.type.minItems : null,
    scopes: d.scopes, workspaces: d.workspaces, delegable: d.delegable, effect: d.effect, sensitivity: d.sensitivity,
    requires: d.requires, conditions: d.conditions, less_than: d.lessThan ?? null, owner_choice: d.ownerChoice ?? null,
    source: d.source ?? null, implemented: d.implemented,
  }));
}
