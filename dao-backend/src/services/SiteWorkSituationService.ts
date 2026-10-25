import { DomainError } from '../lib/errors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9._:-]{8,100}$/;
const ACTIONS = new Set(['create','save_draft','submit','start_review','request_revision','validate_technical','contest','manager_suggestion','withdraw']);

function uuid(value: unknown, field: string, optional = false): string | null {
  if (optional && (value == null || value === '')) return null;
  if (typeof value !== 'string' || !UUID.test(value)) throw new DomainError(`${field} must be a UUID`, 'BAD_REQUEST');
  return value.toLowerCase();
}
function text(value: unknown, field: string, max: number, optional = false): string | null {
  if (optional && (value == null || value === '')) return null;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new DomainError(`${field} is invalid`, 'BAD_REQUEST');
  return value.trim();
}
function day(value: unknown, field: string) {
  const result = text(value, field, 10)!;
  const parsed = new Date(`${result}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== result) {
    throw new DomainError(`${field} must be a valid YYYY-MM-DD date`, 'BAD_REQUEST');
  }
  return result;
}
function quantity(value: unknown, field: string, allowZero = false) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,12})$/.test(value)) throw new DomainError(`${field} must be an exact integer string`, 'BAD_REQUEST');
  const parsed = BigInt(value);
  if (parsed > 1_000_000_000_000n || (!allowZero && parsed === 0n)) throw new DomainError(`${field} is out of range`, 'BAD_REQUEST');
  return value;
}
function ids(value: unknown, field: string, maximum: number): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > maximum) throw new DomainError(`${field} is invalid`, 'BAD_REQUEST');
  const result = value.map(v => uuid(v, field)!);
  if (new Set(result).size !== result.length) throw new DomainError(`${field} contains duplicates`, 'BAD_REQUEST');
  return result;
}
function lines(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new DomainError('lines must contain 1–100 entries', 'BAD_REQUEST');
  const result = value.map((raw: any) => {
    if (!raw || Array.isArray(raw) || typeof raw !== 'object' || Object.keys(raw).some(k =>
      !['line_id','award_item_id','quote_line_id','label','quantity_unit','quantity_reported_milli','source_event_ids','evidence_document_ids'].includes(k))) {
      throw new DomainError('line contains unsupported fields', 'BAD_REQUEST');
    }
    return {
      lineId: uuid(raw.line_id, 'line_id'),
      awardItemId: uuid(raw.award_item_id, 'award_item_id'),
      quoteLineId: uuid(raw.quote_line_id, 'quote_line_id', true),
      label: text(raw.label, 'label', 240),
      quantityUnit: text(raw.quantity_unit, 'quantity_unit', 40),
      quantityReportedMilli: quantity(raw.quantity_reported_milli, 'quantity_reported_milli'),
      sourceEventIds: ids(raw.source_event_ids, 'source_event_ids', 20),
      evidenceDocumentIds: ids(raw.evidence_document_ids, 'evidence_document_ids', 10),
    };
  });
  if (new Set(result.map(x => x.lineId)).size !== result.length) throw new DomainError('line_id values must be unique', 'BAD_REQUEST');
  return result;
}
function decisions(value: unknown, allowPartial: boolean) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new DomainError('quantity decisions are invalid', 'BAD_REQUEST');
  const result = value.map((raw: any) => {
    if (!raw || Array.isArray(raw) || typeof raw !== 'object' || Object.keys(raw).some(k => !['line_id','quantity_milli'].includes(k))) {
      throw new DomainError('quantity decision contains unsupported fields', 'BAD_REQUEST');
    }
    return { lineId: uuid(raw.line_id, 'line_id'), quantityValidatedMilli: quantity(raw.quantity_milli, 'quantity_milli', true) };
  });
  if (!allowPartial && new Set(result.map(x => x.lineId)).size !== result.length) throw new DomainError('line decisions must be unique', 'BAD_REQUEST');
  return result;
}
function cursor(before: string | null) {
  if (!before) return { createdAt: null, id: null };
  try {
    const parsed = JSON.parse(Buffer.from(before, 'base64url').toString('utf8'));
    if (typeof parsed.createdAt !== 'string' || Number.isNaN(Date.parse(parsed.createdAt))) throw new Error();
    return { createdAt: parsed.createdAt, id: uuid(parsed.id, 'cursor id') };
  } catch { throw new DomainError('Invalid cursor', 'BAD_REQUEST'); }
}
function page(data: any) {
  const items = Array.isArray(data?.items) ? data.items : [];
  const last = data?.hasMore && items.length ? items.at(-1) : null;
  return { ...data, nextCursor: last ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last.id })).toString('base64url') : null };
}

export class SiteWorkSituationService {
  constructor(private readonly db: any) {}
  private async call(name: string, args: Record<string, unknown>) {
    const { data, error } = await this.db.rpc(name, args);
    if (error) throw error;
    return data;
  }
  async snapshot(projectId: unknown, situationId: unknown, before: string | null, limit: number) {
    const c = cursor(before);
    const result = await this.call('native_work_situations_v1', {
      p_project_id: uuid(projectId, 'project_id', true),
      p_situation_id: uuid(situationId, 'situation_id', true),
      p_before_created_at: c.createdAt, p_before_id: c.id,
      p_limit: Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 50) : 30,
    });
    return situationId ? result : page(result);
  }
  async events(situationId: unknown, before: string | null, limit: number) {
    const c = cursor(before);
    return page(await this.call('native_work_situation_events_v1', {
      p_situation_id: uuid(situationId, 'situation_id'),
      p_before_created_at: c.createdAt, p_before_id: c.id,
      p_limit: Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 50) : 30,
    }));
  }
  async command(input: Record<string, unknown>) {
    const action = text(input.action, 'action', 32)!;
    if (!ACTIONS.has(action)) throw new DomainError('Invalid situation action', 'BAD_REQUEST');
    if (typeof input.idempotency_key !== 'string' || !KEY.test(input.idempotency_key)) throw new DomainError('Invalid idempotency_key', 'BAD_REQUEST');
    const allowed = ['action','situation_id','project_id','contractor_id','period_start','period_end','lines','validated_lines','note','expected_revision','idempotency_key'];
    if (Object.keys(input).some(k => !allowed.includes(k))) throw new DomainError('Unsupported situation command fields', 'BAD_REQUEST');
    const isCreate = action === 'create';
    const isDraft = action === 'save_draft';
    const decisionsInput = action === 'validate_technical' || action === 'manager_suggestion';
    const expected = input.expected_revision;
    if (!isCreate && (!Number.isSafeInteger(expected) || Number(expected) < 1)) throw new DomainError('expected_revision is required', 'BAD_REQUEST');
    const { data, error } = await this.db.rpc('native_work_situation_command_v1', {
      p_action: action,
      p_situation_id: uuid(input.situation_id, 'situation_id', isCreate),
      p_project_id: isCreate ? uuid(input.project_id, 'project_id') : null,
      p_contractor_id: isCreate ? uuid(input.contractor_id, 'contractor_id') : null,
      p_period_start: isCreate ? day(input.period_start, 'period_start') : null,
      p_period_end: isCreate ? day(input.period_end, 'period_end') : null,
      p_lines: isCreate || isDraft ? lines(input.lines) : null,
      p_validated_lines: decisionsInput ? decisions(input.validated_lines, action === 'manager_suggestion') : null,
      p_note: text(input.note, 'note', 2000, true),
      p_expected_revision: isCreate ? null : Number(expected),
      p_idempotency_key: input.idempotency_key,
    });
    if (error) throw error;
    return data;
  }
}
