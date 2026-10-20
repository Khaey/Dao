import type { MappingRef } from './gatewayContract.js';
import type { OcePlan, OcePlanActivity, OcePlanDependency, SyncReport } from './orchestrator.js';

/**
 * Planning GLOBAL d'un projet (#325) : un seul graphe OCE pour tous les lots, calculé en une fois (jamais la somme de
 * résumés par lot). Tout vient de données D.A.O explicites : plans de lot prêts, sous-lots datés des offres retenues et liens
 * FS CONFIRMÉS par le Client ou la gestion. Aucune date ni dépendance n'est inventée ; les liens non effectifs sont ignorés.
 */
export type ProjectPlanSource = {
  revision: number; context_id: string; project_title: string; region: string;
  lots: { id: string; title: string; planned_start: string | null; planned_end: string | null; ready: boolean }[];
  nodes: { id: string; request_id: string; title: string; start_date: string | null; end_date: string | null }[];
  links: { id: string; pred_target: string | null; succ_target: string | null; state: string }[];
};

// Identifiant complet (32 hex) : deux identifiants distincts ne peuvent jamais produire le même code (≤ 50 caractères).
const hex = (id: string) => id.replace(/-/g, '').toLowerCase();
export const lotWbsCode = (lotId: string) => `L-${hex(lotId)}`;
export const lotActivityCode = (lotId: string) => `LA-${hex(lotId)}`;
export const nodeActivityCode = (nodeId: string) => `SL-${hex(nodeId)}`;
const name = (title: string) => (title.trim() || 'Sans titre').slice(0, 255);

/** Null when nothing is schedulable yet (no ready lot plan and no dated awarded sub-lot). */
export function buildProjectPlan(source: ProjectPlanSource): OcePlan | null {
  const activities: OcePlanActivity[] = [];
  const wbs = new Map<string, { code: string; name: string }>();
  const lotTitle = new Map(source.lots.map(l => [l.id, l.title]));
  const ensureWbs = (lotId: string) => {
    if (!wbs.has(lotId)) wbs.set(lotId, { code: lotWbsCode(lotId), name: name(lotTitle.get(lotId) ?? 'Lot') });
    return lotWbsCode(lotId);
  };
  const known = new Set<string>();
  for (const lot of source.lots) {
    if (!lot.ready || !lot.planned_start || !lot.planned_end) continue;
    activities.push({ activity_code: lotActivityCode(lot.id), name: name(lot.title), wbs_code: ensureWbs(lot.id), start_date: lot.planned_start, end_date: lot.planned_end, activity_type: 'summary' });
    known.add(`lot:${lot.id}`);
  }
  for (const node of source.nodes) {
    if (!node.start_date || !node.end_date || !lotTitle.has(node.request_id)) continue;
    activities.push({ activity_code: nodeActivityCode(node.id), name: name(node.title), wbs_code: ensureWbs(node.request_id), start_date: node.start_date, end_date: node.end_date, activity_type: 'task' });
    known.add(`node:${node.id}`);
  }
  if (activities.length === 0) return null;
  const code = (target: string) => (target.startsWith('lot:') ? lotActivityCode(target.slice(4)) : nodeActivityCode(target.slice(5)));
  const dependencies: OcePlanDependency[] = [];
  for (const link of source.links) {
    if (link.state !== 'effective' || !link.pred_target || !link.succ_target) continue;
    if (!known.has(link.pred_target) || !known.has(link.succ_target)) continue;
    dependencies.push({ predecessor_activity_code: code(link.pred_target), successor_activity_code: code(link.succ_target), relationship_type: 'FS', lag_days: 0 });
  }
  const start = activities.map(a => a.start_date).sort()[0];
  const end = activities.map(a => a.end_date).sort().at(-1)!;
  return {
    project: { name: name(source.project_title), region: source.region, currency: 'TND' },
    wbs: [...wbs.values()],
    schedule: { start_date: start, end_date: end },
    activities,
    dependencies,
  };
}

export type ProjectSyncOutcome = { state: 'skipped' | 'synced' | 'failed'; report?: SyncReport };

/** Same discipline as LotPlanSynchronizer: serialised per project, repeated when the plan changed during the run, never throws. */
export class ProjectPlanSynchronizer {
  private readonly running = new Map<string, { dirty: boolean }>();
  constructor(
    private readonly readSource: (projectId: string) => Promise<ProjectPlanSource | null>,
    private readonly orchestrator: { sync(ref: MappingRef, plan: OcePlan, opts?: { generation?: number }): Promise<SyncReport> },
    private readonly recordResult: (projectId: string, revision: number, planning: { duration: number; critical: string[] } | null, errorCode: string | null) => Promise<void>,
  ) {}

  async run(projectId: string): Promise<ProjectSyncOutcome> {
    const active = this.running.get(projectId);
    if (active) { active.dirty = true; return { state: 'skipped' }; }
    const slot = { dirty: false };
    this.running.set(projectId, slot);
    try {
      let outcome: ProjectSyncOutcome = { state: 'skipped' };
      for (let pass = 0; pass < 5; pass++) {
        slot.dirty = false;
        outcome = await this.once(projectId);
        if (!slot.dirty) break;
      }
      return outcome;
    } finally { this.running.delete(projectId); }
  }

  private async once(projectId: string): Promise<ProjectSyncOutcome> {
    try {
      const source = await this.readSource(projectId);
      if (!source) return { state: 'skipped' };
      const plan = buildProjectPlan(source);
      if (!plan) return { state: 'skipped' };
      const report = await this.orchestrator.sync({ dao_project_id: projectId, dao_lot_id: source.context_id }, plan, { generation: source.revision });
      if (report.ok && report.planning) await this.recordResult(projectId, source.revision, { duration: report.planning.project_duration_days, critical: report.planning.critical_activity_codes }, null);
      else if (!report.ok) {
        const failed = report.steps.find(s => s.outcome === 'failed');
        const raw = (failed?.errorKind ?? failed?.errorCode ?? 'sync_incomplete').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 64);
        await this.recordResult(projectId, source.revision, null, raw || 'sync_incomplete');
      }
      return { state: report.ok ? 'synced' : 'failed', report };
    } catch (error: any) {
      // Un plan invalide (ex. boucle) est un résultat métier lisible, pas une panne.
      const code = typeof error?.code === 'string' && /^[a-z0-9_]{1,64}$/.test(error.code) ? error.code : 'internal_error';
      try { await this.recordResult(projectId, (await this.readSource(projectId))?.revision ?? 1, null, code); } catch { /* best effort */ }
      return { state: 'failed' };
    }
  }
}
