// D.A.O -> OCE gateway contract (#58). Mirrors the validation of the private gateway (ops/oce-v1-gateway.py):
// the gateway stays the authority, this module only fails early and never sends what it would refuse.
// No OCE credential exists on this side: the gateway owns it and is reached through a Unix socket only.

export type OceErrorKind =
  | 'disabled'        // integration switched off: commercial paths must keep working
  | 'circuit_open'    // fail-fast while the gateway is known to be down
  | 'unavailable'     // socket missing/refused, 5xx, ambiguous write (retryable)
  | 'timeout'         // no answer in time (retryable: every gateway write is idempotent)
  | 'invalid_request' // rejected locally or 400/411/413 by the gateway
  | 'not_authorized'  // 403: the (project, lot) pair has no admission record
  | 'conflict'        // 409: identity/ownership mismatch, never retried
  | 'rejected'        // any other 4xx
  | 'protocol';       // malformed answer (not JSON, wrong shape, too large)

export class OceGatewayError extends Error {
  constructor(readonly kind: OceErrorKind, readonly code: string, readonly status?: number) {
    super(`oce_gateway:${kind}:${code}`);
    this.name = 'OceGatewayError';
  }
  get retryable() { return this.kind === 'unavailable' || this.kind === 'timeout'; }
  /** Failures that say something about gateway health (vs. a caller mistake). */
  get countsAsOutage() { return this.kind === 'unavailable' || this.kind === 'timeout' || this.kind === 'protocol'; }
}

const invalid = (code: string) => new OceGatewayError('invalid_request', code);

export type MappingRef = { dao_project_id: string; dao_lot_id: string };
export type ActivityStatus = 'not_started' | 'in_progress' | 'completed' | 'delayed';
export type ActivityType = 'task' | 'milestone' | 'summary';
export type RelationshipType = 'FS' | 'FF' | 'SS' | 'SF';

export type EnsureProjectInput = MappingRef & { name: string; description?: string; region: string; currency: string };
export type EnsureWbsInput = MappingRef & { code: string; name: string };
export type EnsureScheduleInput = MappingRef & { start_date: string; end_date: string };
export type UpsertActivityInput = MappingRef & {
  activity_code: string; name: string; description?: string; wbs_code?: string; start_date: string; end_date: string;
  progress_pct?: number; status?: ActivityStatus; activity_type?: ActivityType;
};
export type EnsureDependencyInput = MappingRef & {
  predecessor_activity_code: string; successor_activity_code: string; relationship_type?: RelationshipType; lag_days?: number;
};

export type RemoveActivityInput = MappingRef & { activity_code: string };
export type RemoveDependencyInput = MappingRef & { predecessor_activity_code: string; successor_activity_code: string };
export type RemoveResult = { ok: true; removed: boolean };
export type EnsureResult = { ok: true; created: boolean };
export type EnsureDependencyResult = { ok: true; created: boolean; updated: boolean };
export type PlanningResult = { ok: true; project_duration_days: number; critical_activity_codes: string[] };
export type PlanningSummary = {
  ok: true; total_activities: number; critical_count: number; on_track: number; delayed: number; completed: number;
  not_started: number; in_progress: number; progress_pct: number; total_duration_days: number;
  next_milestone: { name: string; date: string } | null;
};

/** The only operations D.A.O may ask of OCE. There is deliberately no generic request method. */
export interface OceGateway {
  health(): Promise<{ ok: true }>;
  ready(): Promise<{ ok: true }>;
  ensureProject(input: EnsureProjectInput): Promise<EnsureResult>;
  ensureWbs(input: EnsureWbsInput): Promise<EnsureResult>;
  ensureSchedule(input: EnsureScheduleInput): Promise<EnsureResult>;
  upsertActivity(input: UpsertActivityInput): Promise<EnsureResult>;
  ensureDependency(input: EnsureDependencyInput): Promise<EnsureDependencyResult>;
  /** Retraits bornés (#325) : un seul objet de l'inventaire de la passerelle, idempotent. Une activité n'est retirable qu'après ses dépendances. */
  removeDependency(input: RemoveDependencyInput): Promise<RemoveResult>;
  removeActivity(input: RemoveActivityInput): Promise<RemoveResult>;
  calculatePlanning(input: MappingRef): Promise<PlanningResult>;
  planningSummary(input: MappingRef): Promise<PlanningSummary>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,49}$/;
const STATUSES = new Set(['not_started', 'in_progress', 'completed', 'delayed']);
const TYPES = new Set(['task', 'milestone', 'summary']);
const RELATIONS = new Set(['FS', 'FF', 'SS', 'SF']);

function exact(body: Record<string, unknown>, allowed: string[], required: string[]) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw invalid('invalid_body');
  const keys = Object.keys(body);
  if (keys.some(key => !allowed.includes(key))) throw invalid('unexpected_field');
  if (required.some(key => body[key] === undefined)) throw invalid('missing_field');
}
const uuid = (value: unknown, field: string) => {
  if (typeof value !== 'string' || !UUID.test(value)) throw invalid(`invalid_${field}`);
  return value.toLowerCase();
};
const text = (value: unknown, field: string, max: number, allowEmpty = false) => {
  if (typeof value !== 'string') throw invalid(`invalid_${field}`);
  const trimmed = value.trim();
  if ((!allowEmpty && trimmed.length === 0) || trimmed.length > max || /[\u0000-\u001f\u007f]/.test(trimmed)) throw invalid(`invalid_${field}`);
  return trimmed;
};
const code = (value: unknown, field: string) => {
  if (typeof value !== 'string' || !CODE.test(value)) throw invalid(`invalid_${field}`);
  return value;
};
export function isoDate(value: unknown, field: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalid(`invalid_${field}`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw invalid(`invalid_${field}`);
  return value;
}
const dateRange = (start: unknown, end: unknown) => {
  const from = isoDate(start, 'start_date'); const to = isoDate(end, 'end_date');
  if (to < from) throw invalid('invalid_date_range');
  return { start_date: from, end_date: to };
};
const ref = (input: Record<string, unknown>): MappingRef => ({ dao_project_id: uuid(input.dao_project_id, 'dao_project_id'), dao_lot_id: uuid(input.dao_lot_id, 'dao_lot_id') });

/** Request builders return the exact JSON the gateway accepts, or throw `invalid_request` before any I/O. */
export const requests = {
  ensureProject(input: EnsureProjectInput) {
    exact(input, ['dao_project_id', 'dao_lot_id', 'name', 'description', 'region', 'currency'], ['dao_project_id', 'dao_lot_id', 'name', 'region', 'currency']);
    return { ...ref(input), name: text(input.name, 'name', 255), description: text(input.description ?? '', 'description', 2000, true),
      region: text(input.region, 'region', 100), currency: text(input.currency, 'currency', 10).toUpperCase() };
  },
  ensureWbs(input: EnsureWbsInput) {
    exact(input, ['dao_project_id', 'dao_lot_id', 'code', 'name'], ['dao_project_id', 'dao_lot_id', 'code', 'name']);
    return { ...ref(input), code: code(input.code, 'code'), name: text(input.name, 'name', 255) };
  },
  ensureSchedule(input: EnsureScheduleInput) {
    exact(input, ['dao_project_id', 'dao_lot_id', 'start_date', 'end_date'], ['dao_project_id', 'dao_lot_id', 'start_date', 'end_date']);
    return { ...ref(input), ...dateRange(input.start_date, input.end_date) };
  },
  upsertActivity(input: UpsertActivityInput) {
    exact(input, ['dao_project_id', 'dao_lot_id', 'activity_code', 'name', 'description', 'wbs_code', 'start_date', 'end_date', 'progress_pct', 'status', 'activity_type'],
      ['dao_project_id', 'dao_lot_id', 'activity_code', 'name', 'start_date', 'end_date']);
    const status = input.status ?? 'not_started'; const type = input.activity_type ?? 'task'; const progress = input.progress_pct ?? 0;
    if (!STATUSES.has(status)) throw invalid('invalid_status');
    if (!TYPES.has(type)) throw invalid('invalid_activity_type');
    if (typeof progress !== 'number' || !Number.isFinite(progress) || progress < 0 || progress > 100) throw invalid('invalid_progress_pct');
    return { ...ref(input), activity_code: code(input.activity_code, 'activity_code'), name: text(input.name, 'name', 255),
      description: text(input.description ?? '', 'description', 2000, true), wbs_code: input.wbs_code ? code(input.wbs_code, 'wbs_code') : '',
      ...dateRange(input.start_date, input.end_date), progress_pct: progress, status, activity_type: type };
  },
  ensureDependency(input: EnsureDependencyInput) {
    exact(input, ['dao_project_id', 'dao_lot_id', 'predecessor_activity_code', 'successor_activity_code', 'relationship_type', 'lag_days'],
      ['dao_project_id', 'dao_lot_id', 'predecessor_activity_code', 'successor_activity_code']);
    const pred = code(input.predecessor_activity_code, 'predecessor_activity_code'); const succ = code(input.successor_activity_code, 'successor_activity_code');
    if (pred === succ) throw invalid('dependency_self_reference');
    const relation = input.relationship_type ?? 'FS'; const lag = input.lag_days ?? 0;
    if (!RELATIONS.has(relation)) throw invalid('invalid_relationship_type');
    if (!Number.isInteger(lag) || Math.abs(lag) > 2 ** 31 - 1) throw invalid('invalid_lag_days');
    return { ...ref(input), predecessor_activity_code: pred, successor_activity_code: succ, relationship_type: relation, lag_days: lag };
  },
  removeDependency(input: RemoveDependencyInput) {
    exact(input, ['dao_project_id', 'dao_lot_id', 'predecessor_activity_code', 'successor_activity_code'], ['dao_project_id', 'dao_lot_id', 'predecessor_activity_code', 'successor_activity_code']);
    const pred = code(input.predecessor_activity_code, 'predecessor_activity_code'); const succ = code(input.successor_activity_code, 'successor_activity_code');
    if (pred === succ) throw invalid('dependency_self_reference');
    return { ...ref(input), predecessor_activity_code: pred, successor_activity_code: succ };
  },
  removeActivity(input: RemoveActivityInput) {
    exact(input, ['dao_project_id', 'dao_lot_id', 'activity_code'], ['dao_project_id', 'dao_lot_id', 'activity_code']);
    return { ...ref(input), activity_code: code(input.activity_code, 'activity_code') };
  },
  mapping(input: MappingRef) {
    exact(input, ['dao_project_id', 'dao_lot_id'], ['dao_project_id', 'dao_lot_id']);
    return ref(input);
  },
};

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && !Array.isArray(value);
const shape = (ok: boolean) => { if (!ok) throw new OceGatewayError('protocol', 'response_shape'); };

/** Response parsers: anything unexpected is a protocol error, never trusted. */
export const responses = {
  ok(data: any): { ok: true } { shape(data?.ok === true); return { ok: true }; },
  ensure(data: any): EnsureResult { shape(data?.ok === true && typeof data.created === 'boolean'); return { ok: true, created: data.created }; },
  removal(data: any): RemoveResult { shape(data?.ok === true && typeof data.removed === 'boolean'); return { ok: true, removed: data.removed }; },
  dependency(data: any): EnsureDependencyResult {
    shape(data?.ok === true && typeof data.created === 'boolean' && typeof data.updated === 'boolean');
    return { ok: true, created: data.created, updated: data.updated };
  },
  planning(data: any): PlanningResult {
    shape(data?.ok === true && Number.isInteger(data.project_duration_days) && Array.isArray(data.critical_activity_codes)
      && data.critical_activity_codes.length <= 2000 && data.critical_activity_codes.every((c: unknown) => typeof c === 'string' && CODE.test(c)));
    return { ok: true, project_duration_days: data.project_duration_days, critical_activity_codes: data.critical_activity_codes.slice() };
  },
  summary(data: any): PlanningSummary {
    const keys = ['total_activities', 'critical_count', 'on_track', 'delayed', 'completed', 'not_started', 'in_progress', 'progress_pct', 'total_duration_days'] as const;
    shape(data?.ok === true && keys.every(key => isCount(data[key])));
    const next = data.next_milestone;
    shape(next === null || next === undefined || (typeof next === 'object' && typeof next.name === 'string' && typeof next.date === 'string'));
    const out: any = { ok: true };
    for (const key of keys) out[key] = data[key];
    out.next_milestone = next ? { name: String(next.name).slice(0, 255), date: String(next.date).slice(0, 20) } : null;
    return out;
  },
};
