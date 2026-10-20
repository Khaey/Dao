import { DomainError } from '../lib/errors.js';

export type PrecontractPaymentMode =
  | 'none' | 'daily' | 'weekly' | 'monthly'
  | 'milestone' | 'sub_lot' | 'lot_end' | 'project_end';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredUuid(value: unknown, field: string) {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new DomainError(field + ' must be a UUID', 'BAD_REQUEST');
  }
  return value;
}

function optionalUuid(value: unknown, field: string) {
  return value == null || value === '' ? null : requiredUuid(value, field);
}

function requiredText(value: unknown, field: string, max: number) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new DomainError(field + ' is required', 'BAD_REQUEST');
  }
  return value.trim();
}

function terms(value: unknown) {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new DomainError('terms must be an object', 'BAD_REQUEST');
  }
  const input = value as Record<string, unknown>;
  const allowed = new Set([
    'planned_start_date', 'duration_days', 'execution_terms',
    'payment_mode', 'installments', 'sub_lot_schedule',
  ]);
  if (Object.keys(input).some(key => !allowed.has(key))) {
    throw new DomainError('terms contains an unsupported field', 'BAD_REQUEST');
  }
  if (input.installments != null && !Array.isArray(input.installments)) {
    throw new DomainError('installments must be an array', 'BAD_REQUEST');
  }
  if (input.sub_lot_schedule != null && !Array.isArray(input.sub_lot_schedule)) {
    throw new DomainError('sub_lot_schedule must be an array', 'BAD_REQUEST');
  }
  return input;
}

export class PrecontractAgreementService {
  constructor(private readonly db: any) {}

  async snapshot(awardId: string) {
    const { data, error } = await this.db.rpc('precontract_agreement_snapshot', {
      p_award_id: requiredUuid(awardId, 'award_id'),
    });
    if (error) throw error;
    return data;
  }

  async propose(input: Record<string, unknown>) {
    const { data, error } = await this.db.rpc('propose_precontract_agreement', {
      p_award_id: requiredUuid(input.award_id, 'award_id'),
      p_base_version_id: optionalUuid(input.base_version_id, 'base_version_id'),
      p_terms: terms(input.terms),
      p_idempotency_key: requiredUuid(input.idempotency_key, 'idempotency_key'),
    });
    if (error) throw error;
    return data;
  }

  async accept(input: Record<string, unknown>) {
    const { data, error } = await this.db.rpc('accept_precontract_agreement', {
      p_agreement_id: requiredUuid(input.agreement_id, 'agreement_id'),
      p_version_id: requiredUuid(input.version_id, 'version_id'),
      p_idempotency_key: requiredUuid(input.idempotency_key, 'idempotency_key'),
    });
    if (error) throw error;
    return data;
  }

  async reject(input: Record<string, unknown>) {
    const { data, error } = await this.db.rpc('reject_precontract_agreement', {
      p_agreement_id: requiredUuid(input.agreement_id, 'agreement_id'),
      p_version_id: requiredUuid(input.version_id, 'version_id'),
      p_reason: requiredText(input.reason, 'reason', 2000),
      p_idempotency_key: requiredUuid(input.idempotency_key, 'idempotency_key'),
    });
    if (error) throw error;
    return data;
  }
}
