import {
  OceGateway, OceGatewayError, requests,
  type EnsureDependencyInput, type EnsureProjectInput, type RemoveActivityInput, type RemoveDependencyInput, type EnsureScheduleInput, type EnsureWbsInput, type MappingRef, type UpsertActivityInput,
} from './gatewayContract.js';

type Row = { project: boolean; wbs: Set<string>; schedule: boolean; activities: Map<string, any>; dependencies: Map<string, any> };

/**
 * Contract double for D.A.O tests (no network, no secret). It reproduces the gateway's observable rules:
 * admission per (project, lot), idempotent ensure/upsert, ordering preconditions, bounded planning summary.
 * It is NOT a CPM engine: planning numbers are a simple deterministic projection for orchestration tests.
 */
export class InMemoryOceGateway implements OceGateway {
  private rows = new Map<string, Row>();
  private admitted = new Set<string>();
  calls: string[] = [];
  failNext: OceGatewayError | null = null;

  private key(ref: MappingRef) { return `${ref.dao_project_id.toLowerCase()}:${ref.dao_lot_id.toLowerCase()}`; }
  authorize(ref: MappingRef) { this.admitted.add(this.key(requests.mapping(ref))); }
  revoke(ref: MappingRef) { this.admitted.delete(this.key(requests.mapping(ref))); }

  private row(ref: MappingRef, operation: string): Row {
    this.calls.push(operation);
    if (this.failNext) { const error = this.failNext; this.failNext = null; throw error; }
    const key = this.key(ref);
    if (!this.admitted.has(key)) throw new OceGatewayError('not_authorized', 'mapping_not_authorized', 403);
    let row = this.rows.get(key);
    if (!row) { row = { project: false, wbs: new Set(), schedule: false, activities: new Map(), dependencies: new Map() }; this.rows.set(key, row); }
    return row;
  }
  private need(ok: boolean, code: string) { if (!ok) throw new OceGatewayError('conflict', code, 409); }

  async health() { this.calls.push('health'); return { ok: true as const }; }
  async ready() { this.calls.push('ready'); return { ok: true as const }; }
  async ensureProject(input: EnsureProjectInput) { const body = requests.ensureProject(input); const row = this.row(body, 'ensureProject'); const created = !row.project; row.project = true; return { ok: true as const, created }; }
  async ensureWbs(input: EnsureWbsInput) { const body = requests.ensureWbs(input); const row = this.row(body, 'ensureWbs'); this.need(row.project, 'project_not_ensured'); const created = !row.wbs.has(body.code); row.wbs.add(body.code); return { ok: true as const, created }; }
  async ensureSchedule(input: EnsureScheduleInput) { const body = requests.ensureSchedule(input); const row = this.row(body, 'ensureSchedule'); this.need(row.project, 'project_not_ensured'); const created = !row.schedule; row.schedule = true; return { ok: true as const, created }; }
  async upsertActivity(input: UpsertActivityInput) {
    const body = requests.upsertActivity(input); const row = this.row(body, 'upsertActivity'); this.need(row.schedule, 'schedule_not_ensured');
    if (body.wbs_code && !row.wbs.has(body.wbs_code)) throw new OceGatewayError('invalid_request', 'wbs_not_authorized', 400);
    const created = !row.activities.has(body.activity_code); row.activities.set(body.activity_code, body); return { ok: true as const, created };
  }
  async ensureDependency(input: EnsureDependencyInput) {
    const body = requests.ensureDependency(input); const row = this.row(body, 'ensureDependency');
    this.need(row.activities.has(body.predecessor_activity_code) && row.activities.has(body.successor_activity_code), 'dependency_activity_not_found');
    const id = `${body.predecessor_activity_code}->${body.successor_activity_code}`; const previous = row.dependencies.get(id);
    const updated = Boolean(previous) && JSON.stringify(previous) !== JSON.stringify(body); row.dependencies.set(id, body);
    return { ok: true as const, created: !previous, updated };
  }
  async removeDependency(input: RemoveDependencyInput) {
    const body = requests.removeDependency(input); const row = this.row(body, 'removeDependency');
    return { ok: true as const, removed: row.dependencies.delete(`${body.predecessor_activity_code}->${body.successor_activity_code}`) };
  }
  async removeActivity(input: RemoveActivityInput) {
    const body = requests.removeActivity(input); const row = this.row(body, 'removeActivity');
    for (const key of row.dependencies.keys()) { const [pred, succ] = key.split('->'); if (pred === body.activity_code || succ === body.activity_code) throw new OceGatewayError('conflict', 'activity_has_dependencies', 409); }
    return { ok: true as const, removed: row.activities.delete(body.activity_code) };
  }
  async calculatePlanning(input: MappingRef) {
    const row = this.row(requests.mapping(input), 'calculatePlanning'); this.need(row.schedule, 'schedule_not_ensured');
    const items = [...row.activities.values()]; const starts = items.map(a => a.start_date).sort(); const ends = items.map(a => a.end_date).sort();
    const days = items.length ? Math.round((Date.parse(ends[ends.length - 1]) - Date.parse(starts[0])) / 86400000) + 1 : 0;
    return { ok: true as const, project_duration_days: days, critical_activity_codes: items.filter(a => a.end_date === ends[ends.length - 1]).map(a => a.activity_code) };
  }
  async planningSummary(input: MappingRef) {
    const row = this.row(requests.mapping(input), 'planningSummary'); this.need(row.schedule, 'schedule_not_ensured');
    const items = [...row.activities.values()]; const count = (status: string) => items.filter(a => a.status === status).length;
    const progress = items.length ? items.reduce((sum, a) => sum + a.progress_pct, 0) / items.length : 0;
    return { ok: true as const, total_activities: items.length, critical_count: 0, on_track: items.length - count('delayed') - count('completed'), delayed: count('delayed'),
      completed: count('completed'), not_started: count('not_started'), in_progress: count('in_progress'), progress_pct: progress, total_duration_days: 0, next_milestone: null };
  }
}
