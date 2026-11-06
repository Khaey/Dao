import type { BtpCatalogSnapshot, BtpLot, BtpProjectType, BtpSubLot, BtpUnit, BtpWork } from './contract.js';
import { expectedInputUnit } from '../btp-takeoff/engine.js';
import { GuidedCatalogError, validateGuidedSnapshot } from './guided-validation.js';

export type GuidedUsage = 'house' | 'apartment' | 'commercial' | 'office' | 'other' | 'free';
export type GuidedNature = BtpProjectType | 'small_work';
export type GuidedLifecycle = 'active' | 'retired' | 'unknown';
type Version = NonNullable<BtpCatalogSnapshot['catalogVersion']>;
type Template = BtpCatalogSnapshot['measurementTemplates'][number];
type Rule = BtpCatalogSnapshot['rules'][number];
type NodeRef = Pick<BtpWork, 'id' | 'code' | 'label' | 'sourceRef' | 'projectTypes' | 'relevance'>;
export type GuidedDimension = { name: string; unitCode: string | null; required: boolean };
export type GuidedModel = {
  template: Template;
  status: 'dimensions_required' | 'metadata_incomplete' | 'unsupported_formula';
  dimensions: GuidedDimension[];
  reason: string;
};
export type GuidedWorkReference = {
  workId: string; code: string; label: string; catalogVersion: Version;
  path: { lot: NodeRef & { tradeId: string }; subLot: NodeRef };
  unit: BtpUnit; lifecycle: GuidedLifecycle;
  applicability: { projectTypes: BtpProjectType[]; relevance: BtpWork['relevance'] };
  aliases: string[]; requiredInputs: string[]; sourceRef: string; measurementNote: string;
  models: GuidedModel[];
  rules: Rule[];
  dependencies: BtpCatalogSnapshot['dependencies'];
};
export type GuidedCatalog = {
  contractVersion: 1; catalogVersion: Version | null;
  state: 'available' | 'empty' | 'no_catalog';
  groups: Array<{ lot: GuidedWorkReference['path']['lot']; subLots: Array<{ subLot: NodeRef; works: GuidedWorkReference[] }> }>;
};
/** Publication/lifecycle evidence belongs to the trusted provider, not a browser form. */
export type GuidedSnapshotEvidence = {
  kind: 'published_active' | 'historical';
  /** Explicitly attested retired IDs in THIS version; absence in a newer snapshot proves nothing. */
  retiredWorkIds?: string[];
};
export type GuidedQuery = { usage: GuidedUsage; nature?: GuidedNature; text?: string; includeWithoutEvidence?: boolean };
export type GuidedSuggestion = GuidedWorkReference & {
  relevance: { status: 'to_confirm' | 'no_evidence'; nature: 'covered' | 'no_evidence'; usage: 'not_documented'; reason: string };
  measurement: { status: 'no_model' | 'dimensions_required' | 'not_calculable'; reason: string };
  professional: { status: 'study_required' | 'confirmation_required' | 'not_documented'; ruleIds: string[]; templateIds: string[] };
};
/** Type contract only: #577 creates/persists/authorizes these occurrences, not this module. */
export type GuidedProjectSelection = {
  projectWorkItemId: string; projectLotId: string; projectSubLotId: string | null;
  selection: { kind: 'catalog'; reference: GuidedWorkReference } | { kind: 'custom'; label: string; unitCode: string | null };
};

const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const sorted = <T extends { code: string }>(items: T[]) => [...items].sort((a, b) => cmp(a.code, b.code));
const node = ({ id, code, label, sourceRef, projectTypes, relevance }: BtpLot | BtpSubLot): NodeRef =>
  ({ id, code, label, sourceRef, projectTypes: [...projectTypes], relevance });
export function normalizeGuidedText(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/[^a-z0-9]+/g, ' ').trim();
}
function inputUnit(name: string): string | null { try { return expectedInputUnit(name); } catch { return null; } }

/** Static compatibility check only; no quantity evaluation and no fallback model. */
function formulaUnit(ast: unknown, required: Set<string>, depth = 0): string | null {
  if (depth > 16) return null;
  if (typeof ast === 'string') return required.has(ast) ? inputUnit(ast) : null;
  if (!ast || typeof ast !== 'object' || Array.isArray(ast)) return null;
  const n = ast as Record<string, unknown>;
  if (n.op === 'identity') return typeof n.arg === 'string' ? formulaUnit(n.arg, required, depth + 1) : null;
  if (!Array.isArray(n.args)) return null;
  const units = n.args.map(a => formulaUnit(a, required, depth + 1));
  if (units.some(u => !u)) return null;
  if (n.op === 'subtract') return units.length === 2 && units[0] === units[1] ? units[0] : null;
  if (n.op === 'multiply' && units.length >= 2 && units.length <= 3) {
    return units.slice(1).reduce((a, b) => a === 'm' && b === 'm' ? 'm2' : a === 'm2' && b === 'm' ? 'm3' : null, units[0]);
  }
  return null;
}
function model(template: Template): GuidedModel {
  const required = (template.inputSchema.required ?? []) as string[];
  const names = [...new Set([...required, ...Object.keys(template.inputSchema.properties ?? {})])];
  const dimensions = names.map(name => ({ name, unitCode: inputUnit(name), required: required.includes(name) }));
  if (!required.length || dimensions.some(d => !d.unitCode)) return { template, dimensions, status: 'metadata_incomplete', reason: 'Champs requis ou unités de dimensions non documentés ; aucun calcul proposé.' };
  if (formulaUnit(template.formulaAst, new Set(required)) !== template.outputUnitCode) return { template, dimensions, status: 'unsupported_formula', reason: 'Formule non compatible avec le moteur publié ; aucun calcul proposé.' };
  return { template, dimensions, status: 'dimensions_required', reason: 'Modèle disponible ; dimensions et provenance à fournir au moteur de métrés.' };
}

export function buildGuidedCatalog(raw: unknown, evidence: GuidedSnapshotEvidence): GuidedCatalog {
  validateGuidedSnapshot(raw);
  if (!evidence || !['published_active', 'historical'].includes(evidence.kind)) throw new GuidedCatalogError('evidence.kind', 'preuve de provenance requise');
  const retired = evidence.retiredWorkIds ?? [];
  if (!Array.isArray(retired) || retired.some(x => typeof x !== 'string') || new Set(retired).size !== retired.length) throw new GuidedCatalogError('evidence.retiredWorkIds', 'liste invalide');
  if (evidence.kind === 'published_active' && retired.length) throw new GuidedCatalogError('evidence', 'statuts contradictoires');
  const snapshot = structuredClone(raw); // Never alias/mutate provider data or historic snapshots.
  const version = snapshot.catalogVersion;
  const workIds = new Set(snapshot.lots.flatMap(l => l.subLots.flatMap(s => s.works.map(w => w.id))));
  if (retired.some(id => !workIds.has(id))) throw new GuidedCatalogError('evidence.retiredWorkIds', 'ouvrage inconnu');
  if (!version) return { contractVersion: 1, catalogVersion: null, state: 'no_catalog', groups: [] };
  const groups = sorted(snapshot.lots).map(lot => ({ lot: { ...node(lot), tradeId: lot.tradeId }, subLots: sorted(lot.subLots).map(sub => ({
    subLot: node(sub), works: sorted(sub.works).map((work): GuidedWorkReference => ({
      workId: work.id, code: work.code, label: work.label, catalogVersion: structuredClone(version),
      path: { lot: { ...node(lot), tradeId: lot.tradeId }, subLot: node(sub) }, unit: { ...snapshot.units.find(u => u.code === work.unitCode)! },
      lifecycle: retired.includes(work.id) ? 'retired' : evidence.kind === 'published_active' ? 'active' : 'unknown',
      applicability: { projectTypes: work.projectTypes, relevance: work.relevance }, aliases: work.aliases,
      requiredInputs: work.requiredInputs, sourceRef: work.sourceRef, measurementNote: work.measurementNote,
      models: snapshot.measurementTemplates.filter(t => t.workId === work.id).sort((a, b) => cmp(a.id, b.id)).map(model),
      rules: sorted(snapshot.rules.filter(r => r.subjects.some(c => [lot.code, sub.code, work.code].includes(c)))),
      dependencies: snapshot.dependencies.filter(d => [d.predecessorWorkId, d.successorWorkId].includes(work.id)).sort((a, b) => cmp(a.id, b.id)),
    })),
  })) }));
  return { contractVersion: 1, catalogVersion: version, state: workIds.size ? 'available' : 'empty', groups };
}

export function suggestGuidedWorks(catalog: GuidedCatalog, query: GuidedQuery) {
  if (!query || !['house', 'apartment', 'commercial', 'office', 'other', 'free'].includes(query.usage)
    || (query.nature !== undefined && !['construction', 'renovation', 'extension', 'repair', 'other', 'small_work'].includes(query.nature))
    || (query.includeWithoutEvidence !== undefined && typeof query.includeWithoutEvidence !== 'boolean')
    || (query.text !== undefined && typeof query.text !== 'string')) throw new GuidedCatalogError('query', 'filtre invalide');
  const tokens = normalizeGuidedText(query.text ?? '').split(' ').filter(Boolean);
  const groups = catalog.groups.map(g => ({ lot: g.lot, subLots: g.subLots.map(s => ({ subLot: s.subLot, works: s.works.flatMap((work): GuidedSuggestion[] => {
    if (work.lifecycle !== 'active') return [];
    const nature = query.nature;
    const covered = !!nature && nature !== 'small_work' && [g.lot.projectTypes, s.subLot.projectTypes, work.applicability.projectTypes].every(types => types.includes(nature));
    if (!covered && nature && nature !== 'small_work' && !query.includeWithoutEvidence) return [];
    const haystack = normalizeGuidedText([g.lot.label, g.lot.code, s.subLot.label, s.subLot.code, work.label, work.code, ...work.aliases].join(' '));
    if (!tokens.every(t => haystack.includes(t))) return [];
    const applicableRules = work.rules.filter(r => !r.condition.project_type || r.condition.project_type === nature);
    const requires = (r: Rule, name: string) => r.effect.requires === name || (Array.isArray(r.effect.requires) && r.effect.requires.includes(name));
    const studyRules = applicableRules.filter(r => requires(r, 'technical_study'));
    const confirmationRules = applicableRules.filter(r => requires(r, 'professional_confirmation'));
    const confirmationModels = work.models.filter(m => (m.template.inputSchema['x-dao'] as Record<string, unknown> | undefined)?.professionalConfirmation === true);
    const measurement: GuidedSuggestion['measurement'] = !work.models.length
      ? { status: 'no_model', reason: 'Aucun modèle publié lié à cet ouvrage ; sélection descriptive possible.' }
      : work.models.some(m => m.status === 'dimensions_required')
        ? { status: 'dimensions_required', reason: 'Données insuffisantes avant saisie des dimensions et de leur provenance.' }
        : { status: 'not_calculable', reason: 'Métadonnées de calcul absentes ou non compatibles ; consulter les limites des modèles.' };
    return [{ ...work, relevance: { status: covered ? 'to_confirm' : 'no_evidence', nature: covered ? 'covered' : 'no_evidence', usage: 'not_documented',
      reason: covered ? 'Nature présente aux trois niveaux ; usage du bâtiment non documenté, choix à confirmer. Les conditions des règles restent à vérifier.' : 'Aucune preuve pour cette nature ; aucun classement automatique de la description libre ou du petit travail.' },
      measurement, professional: { status: studyRules.length ? 'study_required' : confirmationRules.length || confirmationModels.length ? 'confirmation_required' : 'not_documented',
        ruleIds: [...studyRules, ...confirmationRules].map(r => r.id), templateIds: confirmationModels.map(m => m.template.id) } }];
  }) })).filter(s => s.works.length) })).filter(g => g.subLots.length);
  return structuredClone({ contractVersion: 1 as const, catalogVersion: catalog.catalogVersion, query, groups });
}

/** Keep reference untouched. Never replace by label/code or by a newer version. */
export function compareGuidedReference(reference: GuidedWorkReference, current: GuidedCatalog) {
  const candidate = current.groups.flatMap(l => l.subLots.flatMap(s => s.works)).find(w => w.workId === reference.workId);
  const status = !candidate ? 'not_in_snapshot' : candidate.lifecycle === 'retired' ? 'retired'
    : candidate.catalogVersion.id !== reference.catalogVersion.id || candidate.catalogVersion.code !== reference.catalogVersion.code ? 'version_changed'
    : JSON.stringify(candidate) !== JSON.stringify(reference) ? 'reference_changed' : 'current';
  return { status, reference: structuredClone(reference), candidate: candidate ? structuredClone(candidate) : null } as const;
}
