import { DomainError } from '../lib/errors.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const inspectionActions = new Set(['start', 'complete', 'withdraw', 'comment', 'manager_comment']);
const reserveActions = new Set(['declare_correction', 'request_recheck', 'confirm_resolved', 'reopen', 'withdraw', 'comment', 'manager_comment']);
const categories = new Set(['workmanship', 'materials', 'completeness', 'safety', 'other']);
const severities = new Set(['minor', 'moderate', 'major']);

function requiredUuid(value: unknown, field: string) {
  if (typeof value !== 'string' || !uuidPattern.test(value)) throw new DomainError(`${field} must be a UUID`, 'BAD_REQUEST');
  return value;
}

function optionalUuid(value: unknown, field: string) {
  return value == null || value === '' ? null : requiredUuid(value, field);
}

function requiredText(value: unknown, field: string, maxLength: number) {
  if (typeof value !== 'string') throw new DomainError(`${field} is required`, 'BAD_REQUEST');
  const result = value.trim();
  if (!result || result.length > maxLength) throw new DomainError(`${field} is invalid`, 'BAD_REQUEST');
  return result;
}

function optionalText(value: unknown, field: string, maxLength: number) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new DomainError(`${field} must be text`, 'BAD_REQUEST');
  const result = value.trim();
  if (!result) return null;
  if (result.length > maxLength) throw new DomainError(`${field} is too long`, 'BAD_REQUEST');
  return result;
}

function documentIds(value: unknown) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 10) throw new DomainError('document_ids must be an array of at most 10 IDs', 'BAD_REQUEST');
  return value.map(id => requiredUuid(id, 'document_id'));
}

function idempotencyKey(value: unknown) {
  const result = requiredText(value, 'idempotency_key', 100);
  if (result.length < 8) throw new DomainError('idempotency_key must be at least 8 characters', 'BAD_REQUEST');
  return result;
}

function revision(value: unknown) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new DomainError('expected_revision must be a positive integer', 'BAD_REQUEST');
  return result;
}

function optionalDate(value: unknown) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new DomainError('due_date must be YYYY-MM-DD', 'BAD_REQUEST');
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.valueOf()) || d.toISOString().slice(0, 10) !== value) throw new DomainError('due_date must be a valid date', 'BAD_REQUEST');
  return value;
}

function decodeCursor(before: string | null) {
  if (!before) return { createdAt: null, id: null };
  try {
    const decoded = JSON.parse(Buffer.from(before, 'base64url').toString('utf8'));
    if (typeof decoded?.createdAt !== 'string' || Number.isNaN(Date.parse(decoded.createdAt))) throw new Error();
    return { createdAt: decoded.createdAt, id: requiredUuid(decoded.id, 'cursor id') };
  } catch {
    throw new DomainError('Invalid cursor', 'BAD_REQUEST');
  }
}

function finishPage(data: any) {
  const items = Array.isArray(data?.items) ? data.items : [];
  const last = data?.hasMore && items.length ? items.at(-1) : null;
  return {
    ...data,
    nextCursor: last ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last.id })).toString('base64url') : null,
  };
}

export class SiteTechnicalQualityService {
  constructor(private readonly db: any) {}

  private async call(name: string, args: Record<string, unknown>) {
    const { data, error } = await this.db.rpc(name, args);
    if (error) throw error;
    return data;
  }

  async inspections(projectId: unknown, awardItemId: unknown, before: string | null, limit: number) {
    const cursor = decodeCursor(before);
    return finishPage(await this.call('native_technical_inspections_v1', {
      p_project_id: requiredUuid(projectId, 'project_id'),
      p_award_item_id: optionalUuid(awardItemId, 'award_item_id'),
      p_before_created_at: cursor.createdAt,
      p_before_id: cursor.id,
      p_limit: Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 50) : 30,
    }));
  }

  async reserves(projectId: unknown, awardItemId: unknown, inspectionId: unknown, before: string | null, limit: number) {
    const cursor = decodeCursor(before);
    return finishPage(await this.call('native_technical_reserves_v1', {
      p_project_id: requiredUuid(projectId, 'project_id'),
      p_award_item_id: optionalUuid(awardItemId, 'award_item_id'),
      p_inspection_id: optionalUuid(inspectionId, 'inspection_id'),
      p_before_created_at: cursor.createdAt,
      p_before_id: cursor.id,
      p_limit: Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 50) : 30,
    }));
  }

  async inspectionEvents(inspectionId: unknown, before: string | null, limit: number) {
    const cursor = decodeCursor(before);
    return finishPage(await this.call('native_technical_inspection_events_v1', {
      p_inspection_id: requiredUuid(inspectionId, 'inspection_id'),
      p_before_created_at: cursor.createdAt,
      p_before_id: cursor.id,
      p_limit: Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 50) : 30,
    }));
  }

  async reserveEvents(reserveId: unknown, before: string | null, limit: number) {
    const cursor = decodeCursor(before);
    return finishPage(await this.call('native_technical_reserve_events_v1', {
      p_reserve_id: requiredUuid(reserveId, 'reserve_id'),
      p_before_created_at: cursor.createdAt,
      p_before_id: cursor.id,
      p_limit: Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 50) : 30,
    }));
  }

  requestInspection(input: Record<string, unknown>) {
    return this.call('request_native_technical_inspection_v1', {
      p_award_item_id: requiredUuid(input.award_item_id, 'award_item_id'),
      p_note: optionalText(input.note, 'note', 2000),
      p_document_ids: documentIds(input.document_ids),
      p_idempotency_key: idempotencyKey(input.idempotency_key),
    });
  }

  updateInspection(input: Record<string, unknown>) {
    const action = requiredText(input.action, 'action', 32);
    if (!inspectionActions.has(action)) throw new DomainError('Invalid inspection action', 'BAD_REQUEST');
    return this.call('record_native_technical_inspection_event_v1', {
      p_inspection_id: requiredUuid(input.inspection_id, 'inspection_id'),
      p_action: action,
      p_note: optionalText(input.note, 'note', 2000),
      p_document_ids: documentIds(input.document_ids),
      p_expected_revision: revision(input.expected_revision),
      p_idempotency_key: idempotencyKey(input.idempotency_key),
    });
  }

  createReserve(input: Record<string, unknown>) {
    const category = requiredText(input.category, 'category', 32);
    const severity = requiredText(input.severity, 'severity', 16);
    if (!categories.has(category) || !severities.has(severity)) throw new DomainError('Invalid reserve classification', 'BAD_REQUEST');
    return this.call('create_native_technical_reserve_v1', {
      p_award_item_id: requiredUuid(input.award_item_id, 'award_item_id'),
      p_inspection_id: optionalUuid(input.inspection_id, 'inspection_id'),
      p_title: requiredText(input.title, 'title', 180),
      p_description: requiredText(input.description, 'description', 4000),
      p_category: category,
      p_severity: severity,
      p_location: optionalText(input.location, 'location', 500),
      p_bid_sub_lot_id: optionalUuid(input.bid_sub_lot_id, 'bid_sub_lot_id'),
      p_native_activity_id: optionalUuid(input.native_activity_id, 'native_activity_id'),
      p_due_date: optionalDate(input.due_date),
      p_document_ids: documentIds(input.document_ids),
      p_idempotency_key: idempotencyKey(input.idempotency_key),
    });
  }

  updateReserve(input: Record<string, unknown>) {
    const action = requiredText(input.action, 'action', 32);
    if (!reserveActions.has(action)) throw new DomainError('Invalid reserve action', 'BAD_REQUEST');
    return this.call('record_native_technical_reserve_event_v1', {
      p_reserve_id: requiredUuid(input.reserve_id, 'reserve_id'),
      p_action: action,
      p_note: optionalText(input.note, 'note', 2000),
      p_document_ids: documentIds(input.document_ids),
      p_expected_revision: revision(input.expected_revision),
      p_idempotency_key: idempotencyKey(input.idempotency_key),
    });
  }
}
