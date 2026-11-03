'use client';
import { supabaseBrowser } from './supabase-browser';

// Administration du référentiel BTP (#547). Toutes les écritures passent par des RPC
// qui revérifient le rôle Admin en base ; une version publiée n'est jamais modifiée.
export type Relevance = 'usual' | 'conditional' | 'optional' | 'verify';
export type ProjectType = 'construction' | 'renovation' | 'extension' | 'repair' | 'other';
export type VersionStatus = 'draft' | 'published' | 'retired';
export type BtpVersion = { id: string; code: string; countryCode: string; regionCode: string | null; status: VersionStatus; effectiveFrom: string; effectiveTo: string | null;
  provenance: Record<string, unknown>; publishedAt: string | null; retiredAt: string | null; createdAt: string; basedOnVersionId: string | null; basedOnCode: string | null;
  createdBy: string | null; publishedBy: string | null;
  counts: { lots: number; subLots: number; works: number; rules: number; dependencies: number; measurementTemplates: number } };
export type BtpTrade = { id: string; code: string; name: string; active: boolean };
export type BtpUnit = { code: string; symbol: string; label: string; dimension: string; decimalScale: number; active: boolean; workCount: number; templateCount: number };
type Common = { id: string; code: string; label: string; description: string; relevance: Relevance; projectTypes: ProjectType[]; position: number; sourceRef: string; active: boolean };
export type BtpLot = Common & { tradeId: string };
export type BtpSubLot = Common & { lotId: string };
export type BtpWork = Common & { subLotId: string; unitCode: string; aliases: string[]; requiredInputs: string[]; measurementNote: string };
export type BtpRule = { id: string; code: string; type: string; severity: 'info' | 'warning' | 'blocking'; subjects: string[]; condition: Record<string, unknown>; effect: Record<string, unknown>;
  explanation: string; sourceRef: string; active: boolean };
export type BtpDependency = { id: string; predecessorWorkId: string; successorWorkId: string; relationType: 'finish_to_start' | 'information' | 'interface'; mandatory: boolean;
  applicability: Record<string, unknown>; explanation: string; sourceRef: string };
export type BtpMeasurement = { id: string; workId: string; outputUnitCode: string; inputSchema: { required?: string[] } & Record<string, unknown>; formulaAst: Record<string, unknown>;
  roundingScale: number; assumptions: string[]; sourceRef: string; active: boolean };
export type ValidationIssue = { severity: 'error' | 'warning'; code: string; message: string; ref: string | null };
export type Validation = { ok: boolean; errors: number; warnings: number; issues: ValidationIssue[] };
export type BtpEvent = { id: string; createdAt: string; action: string; entityKind: string | null; entityId: string | null; entityCode: string | null;
  before: Record<string, unknown> | null; after: Record<string, unknown> | null; reason: string; actor: string | null };
export type AdminCatalog = { countryCode: string; versions: BtpVersion[]; version: BtpVersion | null; trades: BtpTrade[]; units: BtpUnit[]; lots: BtpLot[]; subLots: BtpSubLot[];
  works: BtpWork[]; rules: BtpRule[]; dependencies: BtpDependency[]; measurementTemplates: BtpMeasurement[]; priceBooks: number; validation: Validation | null; events: BtpEvent[] };
export type ItemKind = 'lot' | 'sub_lot' | 'work' | 'rule' | 'measurement' | 'dependency';

export class ReferentialError extends Error { constructor(message: string, public code = '') { super(message); } }
async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabaseBrowser().rpc(name, args);
  if (error) throw new ReferentialError(error.code === '42501' && /Administrateur/.test(error.message) ? 'Réservé à l’Admin D.A.O.' : error.message || 'Action impossible', error.code);
  return data as T;
}

export const fetchAdminCatalog = (versionId: string | null, countryCode = 'TN') => call<AdminCatalog>('btp_admin_catalog', { p_version_id: versionId, p_country_code: countryCode });
export const createDraft = (countryCode: string, code: string, reason: string) =>
  call<{ versionId: string; code: string; basedOn: string }>('btp_admin_create_draft', { p_country_code: countryCode, p_code: code, p_reason: reason });
export const saveItem = (versionId: string, kind: ItemKind, item: Record<string, unknown>, reason: string) =>
  call<{ id: string; code?: string; changed: boolean }>('btp_admin_save_item', { p_version_id: versionId, p_kind: kind, p_item: item, p_reason: reason });
export const removeDependency = (versionId: string, dependencyId: string, reason: string) =>
  call<{ removed: boolean }>('btp_admin_remove_dependency', { p_version_id: versionId, p_dependency_id: dependencyId, p_reason: reason });
export const validateDraft = (versionId: string) => call<Validation>('btp_admin_validate_draft', { p_version_id: versionId });
export const publishDraft = (versionId: string, reason: string) =>
  call<{ code: string; retired: string | null; warnings: number }>('btp_admin_publish_draft', { p_version_id: versionId, p_reason: reason });
export const abandonDraft = (versionId: string, reason: string) => call<{ abandoned: boolean }>('btp_admin_abandon_draft', { p_version_id: versionId, p_reason: reason });

export const relevanceLabels: Record<Relevance, string> = { usual: 'Habituel', verify: 'À vérifier', conditional: 'Selon le projet', optional: 'Facultatif' };
export const projectTypeLabels: Record<ProjectType, string> = { construction: 'Construction', renovation: 'Rénovation', extension: 'Extension', repair: 'Réparation', other: 'Autre' };
export const statusLabels: Record<VersionStatus, string> = { draft: 'Brouillon', published: 'Publiée', retired: 'Archivée' };
export const relationLabels: Record<BtpDependency['relationType'], string> = { finish_to_start: 'Fin → début', information: 'Information préalable', interface: 'Interface' };
export const severityLabels: Record<BtpRule['severity'], string> = { info: 'Information', warning: 'Avertissement', blocking: 'Bloquante' };
export const ruleTypeLabels: Record<string, string> = { applicability: 'Applicabilité', prerequisite: 'Prérequis', exclusion: 'Exclusion', warning: 'Alerte', validation: 'Validation' };
export const dimensionLabels: Record<string, string> = { length: 'Longueur', area: 'Surface', volume: 'Volume', count: 'Nombre', mass: 'Masse', time: 'Temps', package: 'Forfait' };
export const actionLabels: Record<string, string> = { draft_create: 'Brouillon préparé', item_create: 'Élément ajouté', item_update: 'Élément modifié', dependency_remove: 'Dépendance retirée',
  draft_publish: 'Version publiée', draft_abandon: 'Brouillon abandonné', version_retire: 'Version archivée' };
export const kindLabels: Record<ItemKind, string> = { lot: 'Lot', sub_lot: 'Sous-lot', work: 'Ouvrage', rule: 'Règle', measurement: 'Modèle de métré', dependency: 'Dépendance' };

/** Lisible par un humain : la formule de métré déterministe (AST) sans évaluation. */
export function formulaText(ast: Record<string, unknown> | null | undefined): string {
  if (!ast) return '—';
  const op = String(ast.op ?? '');
  if (op === 'identity') return String(ast.arg ?? '—'); const args = Array.isArray(ast.args) ? ast.args.map(a => typeof a === 'object' && a ? `(${formulaText(a as Record<string, unknown>)})` : String(a)) : [];
  const symbol: Record<string, string> = { multiply: ' × ', add: ' + ', subtract: ' − ', divide: ' ÷ ', sum: ' + ' };
  return symbol[op] ? args.join(symbol[op]) : `${op}(${args.join(', ')})`;
}
export const normalize = (text: string) => text.toLocaleLowerCase('fr').normalize('NFD').replace(/[̀-ͯ]/g, '');
