import { OceGatewayError, type ActivityStatus, type ActivityType, type MappingRef, type OceGateway, type PlanningSummary, type RelationshipType } from './gatewayContract.js';
import { sha256, type ObjectKind, type OceSyncStore, type SyncOperation } from './oceSyncStore.js';

/**
 * Server-side orchestration of one D.A.O lot planning towards the private OCE gateway.
 * D.A.O stays the authority: the plan is derived from D.A.O data, the gateway only mirrors it, and every write is
 * journaled with a deterministic idempotency key so replays and retries never duplicate or reorder anything.
 */
export type OcePlanActivity = {
  activity_code: string; name: string; description?: string; wbs_code?: string; start_date: string; end_date: string;
  progress_pct?: number; status?: ActivityStatus; activity_type?: ActivityType;
};
export type OcePlanDependency = { predecessor_activity_code: string; successor_activity_code: string; relationship_type?: RelationshipType; lag_days?: number };
export type OcePlan = {
  project: { name: string; description?: string; region: string; currency: string };
  wbs: { code: string; name: string }[];
  schedule: { start_date: string; end_date: string };
  activities: OcePlanActivity[];
  dependencies: OcePlanDependency[];
};
export type SyncStep = { operation: SyncOperation | 'remove-dependency' | 'remove-activity'; code?: string; outcome: 'done' | 'unchanged' | 'in_progress' | 'failed'; errorKind?: string; errorCode?: string };
export type SyncReport = { ok: boolean; steps: SyncStep[]; written: number; skipped: number; planning?: { project_duration_days: number; critical_activity_codes: string[] } };

export class OcePlanError extends Error { constructor(readonly code: string) { super(code); } }

const CODE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,49}$/;

/** Local, I/O-free validation of the plan's internal consistency. */
export function validatePlan(plan: OcePlan) {
  const bad = (code: string): never => { throw new OcePlanError(code); };
  if (!plan || typeof plan !== 'object') bad('plan_invalid');
  const wbs = new Set<string>();
  for (const w of plan.wbs ?? []) { if (!CODE.test(w.code)) bad('wbs_code_invalid'); if (wbs.has(w.code)) bad('wbs_code_duplicate'); wbs.add(w.code); }
  const acts = new Set<string>();
  for (const a of plan.activities ?? []) {
    if (!CODE.test(a.activity_code)) bad('activity_code_invalid'); if (acts.has(a.activity_code)) bad('activity_code_duplicate'); acts.add(a.activity_code);
    if (a.wbs_code !== undefined && !wbs.has(a.wbs_code)) bad('activity_wbs_unknown');
    if (a.end_date < a.start_date) bad('activity_dates_invalid');
  }
  if (plan.schedule.end_date < plan.schedule.start_date) bad('schedule_dates_invalid');
  const pairs = new Set<string>();
  for (const d of plan.dependencies ?? []) {
    if (!acts.has(d.predecessor_activity_code) || !acts.has(d.successor_activity_code)) bad('dependency_activity_unknown');
    if (d.predecessor_activity_code === d.successor_activity_code) bad('dependency_self');
    const k = `${d.predecessor_activity_code}>${d.successor_activity_code}`; if (pairs.has(k)) bad('dependency_duplicate'); pairs.add(k);
  }
  // Cycles would make the CPM meaningless: detect them before spending any write.
  const next = new Map<string, string[]>();
  for (const d of plan.dependencies ?? []) next.set(d.predecessor_activity_code, [...(next.get(d.predecessor_activity_code) ?? []), d.successor_activity_code]);
  const state = new Map<string, number>();
  const visit = (n: string): boolean => {
    if (state.get(n) === 1) return true; if (state.get(n) === 2) return false;
    state.set(n, 1); for (const m of next.get(n) ?? []) if (visit(m)) return true; state.set(n, 2); return false;
  };
  for (const a of acts) if (visit(a)) bad('dependency_cycle');
}

export type OrchestratorOptions = {
  /**
   * Réconciliation par retrait (#325) : les dépendances puis les activités déjà appliquées dans OCE et absentes du plan courant sont retirées
   * via la passerelle. Éteint par défaut tant que les opérations de retrait ne sont pas déployées (sinon comportement historique : rien n'est retiré).
   */
  removal?: boolean;
};

export class OceOrchestrator {
  constructor(private readonly gateway: OceGateway, private readonly store: OceSyncStore, private readonly options: OrchestratorOptions = {}) {}

  /**
   * `generation` identifies the plan revision being applied (monotonic, +1 per real change). It is part of every idempotency key:
   * retries of one revision resume where they stopped, while going back to a previously synchronised content is a new
   * generation and reaches the gateway again (otherwise the old journal would replay and the gateway would stay stale).
   */
  async sync(ref: MappingRef, plan: OcePlan, opts: { generation?: number } = {}): Promise<SyncReport> {
    const gen = Number.isInteger(opts.generation) ? `:g${opts.generation}` : '';
    validatePlan(plan);
    const mappingId = await this.store.requestMapping(ref.dao_project_id, ref.dao_lot_id);
    const report: SyncReport = { ok: true, steps: [], written: 0, skipped: 0 };

    // Retrait idempotent côté passerelle ; l'objet n'est oublié par D.A.O qu'après confirmation, et l'échec s'arrête à l'étape (reprise au prochain passage).
    const remove = async (operation: 'remove-dependency' | 'remove-activity', code: string, run: () => Promise<unknown>, forget: () => Promise<void>) => {
      try { await run(); } catch (error) {
        const kind = error instanceof OceGatewayError ? error.kind : 'unknown';
        const errCode = error instanceof OceGatewayError ? error.code : 'internal_error';
        report.ok = false; report.steps.push({ operation, code, outcome: 'failed', errorKind: kind, errorCode: errCode }); return false;
      }
      await forget(); report.written++; report.steps.push({ operation, code, outcome: 'done' }); return true;
    };

    const step = async (operation: SyncOperation, code: string | undefined, body: unknown, run: () => Promise<unknown>,
      object?: { kind: ObjectKind; a: string; b: string | null }) => {
      const hash = sha256(body);
      if (object && !(await this.store.objectChanged(mappingId, object.kind, object.a, object.b, hash))) {
        report.skipped++; report.steps.push({ operation, code, outcome: 'unchanged' }); return true;
      }
      const began = await this.store.begin(mappingId, operation, `${operation}:${hash.slice(0, 40)}${gen}`, hash);
      if (began.state === 'in_progress') { report.ok = false; report.steps.push({ operation, code, outcome: 'in_progress' }); return false; }
      if (began.state === 'run') {
        try { await run(); } catch (error) {
          const kind = error instanceof OceGatewayError ? error.kind : 'unknown';
          const errCode = error instanceof OceGatewayError ? error.code : 'internal_error';
          await this.store.finish(began.id, false, kind, errCode);
          report.ok = false; report.steps.push({ operation, code, outcome: 'failed', errorKind: kind, errorCode: errCode }); return false;
        }
        await this.store.finish(began.id, true);
        report.written++;
      } else report.skipped++;
      if (object) await this.store.recordObject(mappingId, object.kind, object.a, object.b, hash);
      report.steps.push({ operation, code, outcome: began.state === 'run' ? 'done' : 'unchanged' });
      return true;
    };

    // Retraits d'abord pour les dépendances (une activité ne se retire qu'une fois ses dépendances parties), puis les activités après les écritures.
    let staleActivities: string[] = [];
    if (this.options.removal) {
      const tracked = await this.store.listObjects(mappingId);
      const planDeps = new Set(plan.dependencies.map(d => `${d.predecessor_activity_code}>${d.successor_activity_code}`));
      const planActs = new Set(plan.activities.map(a => a.activity_code));
      staleActivities = tracked.activities.filter(code => !planActs.has(code));
      const staleDependencies = tracked.dependencies.filter(([pred, succ]) => !planDeps.has(`${pred}>${succ}`));
      for (const [pred, succ] of staleDependencies) {
        if (!(await remove('remove-dependency', `${pred}>${succ}`, () => this.gateway.removeDependency({ ...ref, predecessor_activity_code: pred, successor_activity_code: succ }),
          () => this.store.forgetObject(mappingId, 'dependency', pred, succ)))) return report;
      }
    }

    if (!(await step('ensure-project', undefined, plan.project, () => this.gateway.ensureProject({ ...ref, ...plan.project })))) return report;
    for (const w of plan.wbs) {
      if (!(await step('ensure-wbs', w.code, w, () => this.gateway.ensureWbs({ ...ref, ...w }), { kind: 'wbs', a: w.code, b: null }))) return report;
    }
    if (!(await step('ensure-schedule', undefined, plan.schedule, () => this.gateway.ensureSchedule({ ...ref, ...plan.schedule })))) return report;
    for (const a of plan.activities) {
      if (!(await step('upsert-activity', a.activity_code, a, () => this.gateway.upsertActivity({ ...ref, ...a }), { kind: 'activity', a: a.activity_code, b: null }))) return report;
    }
    for (const d of plan.dependencies) {
      if (!(await step('ensure-dependency', `${d.predecessor_activity_code}>${d.successor_activity_code}`, d,
        () => this.gateway.ensureDependency({ ...ref, ...d }), { kind: 'dependency', a: d.predecessor_activity_code, b: d.successor_activity_code }))) return report;
    }
    for (const code of staleActivities) {
      if (!(await remove('remove-activity', code, () => this.gateway.removeActivity({ ...ref, activity_code: code }), () => this.store.forgetObject(mappingId, 'activity', code, null)))) return report;
    }
    // CPM is recomputed only when the plan content changed (key derives from the whole plan hash).
    const planHash = sha256({ wbs: plan.wbs, schedule: plan.schedule, activities: plan.activities, dependencies: plan.dependencies });
    let result: { project_duration_days: number; critical_activity_codes: string[] } | undefined;
    const ok = await step('calculate-planning', undefined, { plan: planHash }, async () => { result = await this.gateway.calculatePlanning(ref); });
    if (ok && result) report.planning = { project_duration_days: result.project_duration_days, critical_activity_codes: result.critical_activity_codes };
    // The lot reads as synchronised only once the plan revision is recorded as applied (a complete replay writes no journal entry).
    if (report.ok && opts.generation !== undefined) await this.store.markSynced(mappingId, opts.generation);
    return report;
  }

  /** Informative read-only technical summary; never journaled and never changes D.A.O data. */
  summary(ref: MappingRef): Promise<PlanningSummary> { return this.gateway.planningSummary(ref); }
}
