import { DomainError } from '../lib/errors.js';

export type SiteProgressStatus = 'not_started' | 'in_progress' | 'completed';
export type SiteMilestoneStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled';
export type SiteObservationOutcome = 'acknowledged' | 'disputed' | 'technical_validated';

export type RecordProgressInput = {
  award_item_id: string;
  bid_sub_lot_id?: string | null;
  status: SiteProgressStatus;
  percent: number;
  reason: string;
  document_ids?: string[];
  idempotency_key: string;
};

export type RecordInterventionInput = {
  award_item_id: string;
  bid_sub_lot_id?: string | null;
  work_date: string;
  note: string;
  percent?: number | null;
  quote_line_id?: string | null;
  executed_quantity_milli?: number | null;
  quantity_unit?: string | null;
  document_ids?: string[];
  idempotency_key: string;
};

export type CreateMilestoneInput = {
  award_item_id: string;
  title: string;
  target_date?: string | null;
  status: SiteMilestoneStatus;
  note?: string | null;
  idempotency_key: string;
};

export type UpdateMilestoneInput = {
  milestone_key: string;
  target_date?: string | null;
  status: SiteMilestoneStatus;
  note?: string | null;
  idempotency_key: string;
};

export type RecordObservationInput = {
  event_id: string;
  outcome: SiteObservationOutcome;
  reason?: string | null;
  idempotency_key: string;
};

function requiredText(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) throw new DomainError(`${field} is required`, 'BAD_REQUEST');
  return value.trim();
}

function optionalText(value: unknown) {
  return value == null || value === '' ? null : String(value).trim();
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function uuid(value: unknown, field: string) {
  const result = requiredText(value, field);
  if (!uuidPattern.test(result)) throw new DomainError(`${field} must be a UUID`, 'BAD_REQUEST');
  return result;
}

function optionalUuid(value: unknown, field: string) {
  return value == null || value === '' ? null : uuid(value, field);
}

function quantityMilli(value: unknown) {
  if (value == null || value === '') return null;
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1 || result > 1_000_000_000_000) {
    throw new DomainError('executed_quantity_milli must be a positive bounded integer', 'BAD_REQUEST');
  }
  return result;
}

function date(value: unknown, field: string, optional = false) {
  if (optional && (value == null || value === '')) return null;
  const result = requiredText(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00Z`))) throw new DomainError(`${field} must be a date`, 'BAD_REQUEST');
  return result;
}

function percent(value: unknown, optional = false) {
  if (optional && (value == null || value === '')) return null;
  const result = Number(value);
  if (!Number.isInteger(result) || result < 0 || result > 100) throw new DomainError('percent must be an integer from 0 to 100', 'BAD_REQUEST');
  return result;
}

function documents(value: unknown) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string')) {
    throw new DomainError('document_ids must be an array', 'BAD_REQUEST');
  }
  return value.map(id => uuid(id, 'document_id'));
}

async function recordNativeActivityEvent(db: any, input: Record<string, unknown>, eventKind: string, values: Record<string, unknown>) {
  const { data, error } = await db.rpc('record_native_activity_event_v1', {
    p_award_item_id: uuid(input.award_item_id, 'award_item_id'),
    p_native_activity_id: uuid(input.native_activity_id, 'native_activity_id'),
    p_event_kind: eventKind,
    p_status: values.status ?? null,
    p_percent: values.percent ?? null,
    p_work_date: values.workDate ?? null,
    p_title: values.title ?? null,
    p_target_date: values.targetDate ?? null,
    p_note: values.note ?? null,
    p_quote_line_id: values.quoteLineId ?? null,
    p_executed_quantity_milli: values.executedQuantityMilli ?? null,
    p_quantity_unit: values.quantityUnit ?? null,
    p_document_ids: values.documentIds ?? [],
    p_idempotency_key: requiredText(input.idempotency_key, 'idempotency_key'),
  });
  if (error) throw error;
  return data;
}

export class SiteExecutionService {
  constructor(private readonly db: any) {}

  async snapshot(projectId: string, before: string | null, limit: number) {
    projectId = uuid(projectId, 'project_id');
    let cursor: { created_at: string; id: string } | null = null;
    if (before) {
      try {
        const decoded = JSON.parse(Buffer.from(before, 'base64url').toString('utf8'));
        if (typeof decoded?.created_at !== 'string' || Number.isNaN(Date.parse(decoded.created_at))) throw new Error();
        cursor = { created_at: decoded.created_at, id: uuid(decoded?.id, 'cursor id') };
      } catch {
        throw new DomainError('Invalid cursor', 'BAD_REQUEST');
      }
    }
    const pageSize = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 50) : 30;
    const { data, error } = await this.db.rpc('site_execution_snapshot_v2', {
      p_project_id: projectId,
      p_before_created_at: cursor?.created_at ?? null,
      p_before_id: cursor?.id ?? null,
      p_limit: pageSize,
    });
    if (error) throw error;
    const events = Array.isArray(data?.events) ? data.events : [];
    const last = events.length === pageSize ? events.at(-1) : null;
    return {
      ...data,
      next_cursor: last ? Buffer.from(JSON.stringify({ created_at: last.created_at, id: last.id })).toString('base64url') : null,
    };
  }

  async progress(input: Record<string, unknown>) {
    if (optionalUuid(input.native_activity_id, 'native_activity_id')) {
      return recordNativeActivityEvent(this.db, input, 'progress', {
        status: requiredText(input.status, 'status'), percent: percent(input.percent),
        note: requiredText(input.reason, 'reason'), documentIds: documents(input.document_ids),
      });
    }
    const { data, error } = await this.db.rpc('record_site_progress_v2', {
      p_award_item_id: uuid(input.award_item_id, 'award_item_id'),
      p_bid_sub_lot_id: optionalUuid(input.bid_sub_lot_id, 'bid_sub_lot_id'),
      p_status: requiredText(input.status, 'status'),
      p_percent: percent(input.percent),
      p_reason: requiredText(input.reason, 'reason'),
      p_document_ids: documents(input.document_ids),
      p_idempotency_key: requiredText(input.idempotency_key, 'idempotency_key'),
    });
    if (error) throw error;
    return data;
  }

  async intervention(input: Record<string, unknown>) {
    if (optionalUuid(input.native_activity_id, 'native_activity_id')) {
      return recordNativeActivityEvent(this.db, input, 'intervention', {
        workDate: date(input.work_date, 'work_date'), note: requiredText(input.note, 'note'),
        percent: percent(input.percent, true), quoteLineId: optionalUuid(input.quote_line_id, 'quote_line_id'),
        executedQuantityMilli: quantityMilli(input.executed_quantity_milli), quantityUnit: optionalText(input.quantity_unit),
        documentIds: documents(input.document_ids),
      });
    }
    const { data, error } = await this.db.rpc('record_site_intervention_v2', {
      p_award_item_id: uuid(input.award_item_id, 'award_item_id'),
      p_bid_sub_lot_id: optionalUuid(input.bid_sub_lot_id, 'bid_sub_lot_id'),
      p_work_date: date(input.work_date, 'work_date'),
      p_note: requiredText(input.note, 'note'),
      p_percent: percent(input.percent, true),
      p_quote_line_id: optionalUuid(input.quote_line_id, 'quote_line_id'),
      p_executed_quantity_milli: quantityMilli(input.executed_quantity_milli),
      p_quantity_unit: optionalText(input.quantity_unit),
      p_document_ids: documents(input.document_ids),
      p_idempotency_key: requiredText(input.idempotency_key, 'idempotency_key'),
    });
    if (error) throw error;
    return data;
  }

  async createMilestone(input: Record<string, unknown>) {
    if (optionalUuid(input.native_activity_id, 'native_activity_id')) {
      return recordNativeActivityEvent(this.db, input, 'milestone', {
        title: requiredText(input.title, 'title'), targetDate: date(input.target_date, 'target_date', true),
        status: requiredText(input.status, 'status'), note: optionalText(input.note),
      });
    }
    const { data, error } = await this.db.rpc('create_site_milestone', {
      p_award_item_id: uuid(input.award_item_id, 'award_item_id'),
      p_title: requiredText(input.title, 'title'),
      p_target_date: date(input.target_date, 'target_date', true),
      p_status: requiredText(input.status, 'status'),
      p_note: optionalText(input.note),
      p_idempotency_key: requiredText(input.idempotency_key, 'idempotency_key'),
    });
    if (error) throw error;
    return data;
  }

  async updateMilestone(input: Record<string, unknown>) {
    const { data, error } = await this.db.rpc('update_site_milestone', {
      p_milestone_key: uuid(input.milestone_key, 'milestone_key'),
      p_target_date: date(input.target_date, 'target_date', true),
      p_status: requiredText(input.status, 'status'),
      p_note: optionalText(input.note),
      p_idempotency_key: requiredText(input.idempotency_key, 'idempotency_key'),
    });
    if (error) throw error;
    return data;
  }

  async observation(input: Record<string, unknown>) {
    const { data, error } = await this.db.rpc('record_site_observation', {
      p_event_id: uuid(input.event_id, 'event_id'),
      p_outcome: requiredText(input.outcome, 'outcome'),
      p_reason: optionalText(input.reason),
      p_idempotency_key: requiredText(input.idempotency_key, 'idempotency_key'),
    });
    if (error) throw error;
    return data;
  }
}
