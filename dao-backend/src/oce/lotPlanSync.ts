import type { MappingRef } from './gatewayContract.js';
import type { OcePlan, SyncReport } from './orchestrator.js';

/**
 * Minimal technical planning of one lot (#301): project, one WBS, one activity, OCE calculation.
 * Every value comes from D.A.O data entered explicitly; nothing is invented (no dependency, no intermediate date).
 * The shape is deliberately a plain OcePlan so detailed plannings, milestones and site-log data can later add
 * WBS/activities/dependencies without changing the trigger, the journal or the gateway contract.
 */
export type LotPlanSource = { lot_title: string; region: string; planned_start: string; planned_end: string; revision?: number };

export const LOT_WBS_CODE = 'LOT';
export const LOT_ACTIVITY_CODE = 'LOT-1';

export function buildLotPlan(source: LotPlanSource): OcePlan {
  return {
    project: { name: source.lot_title, region: source.region, currency: 'TND' },
    wbs: [{ code: LOT_WBS_CODE, name: source.lot_title }],
    schedule: { start_date: source.planned_start, end_date: source.planned_end },
    activities: [{ activity_code: LOT_ACTIVITY_CODE, name: source.lot_title, wbs_code: LOT_WBS_CODE, start_date: source.planned_start, end_date: source.planned_end }],
    dependencies: [],
  };
}

export type LotSyncOutcome = { state: 'skipped' | 'synced' | 'failed'; report?: SyncReport };

/**
 * Reads the ready plan (service-side) and replays it through the idempotent orchestrator. Never throws to callers.
 * A request that arrives while a run is in flight is not dropped: the run is repeated with a fresh read of the plan,
 * so the last saved revision is always the one applied.
 */
export class LotPlanSynchronizer {
  private readonly running = new Map<string, { dirty: boolean }>();
  constructor(
    private readonly readSource: (ref: MappingRef) => Promise<LotPlanSource | null>,
    private readonly orchestrator: { sync(ref: MappingRef, plan: OcePlan, opts?: { generation?: number }): Promise<SyncReport> },
  ) {}

  async run(ref: MappingRef): Promise<LotSyncOutcome> {
    const key = `${ref.dao_project_id}:${ref.dao_lot_id}`;
    const active = this.running.get(key);
    if (active) { active.dirty = true; return { state: 'skipped' }; }
    const slot = { dirty: false };
    this.running.set(key, slot);
    try {
      let outcome: LotSyncOutcome = { state: 'skipped' };
      for (let pass = 0; pass < 5; pass++) {
        slot.dirty = false;
        outcome = await this.once(ref);
        if (!slot.dirty) break;
      }
      return outcome;
    } finally { this.running.delete(key); }
  }

  private async once(ref: MappingRef): Promise<LotSyncOutcome> {
    try {
      const source = await this.readSource(ref);
      if (!source) return { state: 'skipped' };
      const report = await this.orchestrator.sync(ref, buildLotPlan(source), { generation: source.revision });
      return { state: report.ok ? 'synced' : 'failed', report };
    } catch {
      return { state: 'failed' };
    }
  }
}
