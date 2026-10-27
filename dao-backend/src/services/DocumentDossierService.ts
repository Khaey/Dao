import { DomainError } from '../lib/errors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9._:-]{8,100}$/;
const FAMILY_ACTIONS = new Set(['create_family', 'add_revision', 'update_family']);
const REVIEW_ACTIONS = new Set(['start_review', 'observations', 'correction_requested', 'reviewed', 'comment']);
const CATEGORIES = new Set(['plan', 'technical', 'photo', 'certificate', 'other']);
const VISIBILITIES = new Set(['private', 'project', 'lots']);
const FIELDS = new Set(['action', 'project_id', 'family_id', 'document_id', 'revision_id', 'title', 'category', 'visibility',
  'request_ids', 'note', 'expected_version', 'expected_revision_id', 'decision', 'idempotency_key']);

function uuid(value: unknown, field: string, optional = false): string | null {
  if (optional && (value == null || value === '')) return null;
  if (typeof value !== 'string' || !UUID.test(value)) throw new DomainError(`${field} must be a UUID`, 'BAD_REQUEST');
  return value.toLowerCase();
}
function text(value: unknown, field: string, max: number, optional = false): string | null {
  if (optional && (value == null || (typeof value === 'string' && !value.trim()))) return null;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new DomainError(`${field} is invalid`, 'BAD_REQUEST');
  return value.trim();
}
function choice(value: unknown, field: string, allowed: Set<string>, optional = false): string | null {
  if (optional && (value == null || value === '')) return null;
  if (typeof value !== 'string' || !allowed.has(value)) throw new DomainError(`${field} is invalid`, 'BAD_REQUEST');
  return value;
}
function ids(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 50) throw new DomainError('request_ids is invalid', 'BAD_REQUEST');
  const result = value.map(v => uuid(v, 'request_ids')!);
  if (new Set(result).size !== result.length) throw new DomainError('request_ids contains duplicates', 'BAD_REQUEST');
  return result;
}
function key(value: unknown) {
  if (typeof value !== 'string' || !KEY.test(value)) throw new DomainError('idempotency_key is invalid', 'BAD_REQUEST');
  return value;
}

/** Document dossier V2 (#456): versioned families, lot sharing and non-legal technical reviews. */
export class DocumentDossierService {
  constructor(private readonly db: any) {}
  private async call(name: string, args: Record<string, unknown>) {
    const { data, error } = await this.db.rpc(name, args);
    if (error) throw error;
    return data;
  }

  async snapshot(projectId: unknown, requestId: unknown) {
    return this.call('document_dossier_v1', { p_project_id: uuid(projectId, 'project_id'), p_request_id: uuid(requestId, 'request_id', true) });
  }

  async command(input: Record<string, unknown>) {
    const unsupported = Object.keys(input).filter(k => !FIELDS.has(k));
    if (unsupported.length) throw new DomainError('Unsupported document dossier fields', 'BAD_REQUEST');
    const action = input.action;
    if (action === 'control_file') {
      const decision = choice(input.decision, 'decision', new Set(['approved', 'rejected']))!;
      return this.call('document_file_control_v1', {
        p_document_id: uuid(input.document_id, 'document_id'),
        p_decision: decision,
        p_reason: text(input.note, 'note', 2000, decision === 'approved'),
        p_idempotency_key: key(input.idempotency_key),
      });
    }
    if (typeof action !== 'string' || (!FAMILY_ACTIONS.has(action) && !REVIEW_ACTIONS.has(action))) {
      throw new DomainError('Unsupported document dossier action', 'BAD_REQUEST');
    }
    const args: Record<string, unknown> = {
      p_action: action, p_project_id: null, p_family_id: null, p_document_id: null, p_revision_id: null,
      p_title: null, p_category: null, p_visibility: null, p_request_ids: null, p_note: null,
      p_expected_version: null, p_expected_revision_id: null, p_idempotency_key: key(input.idempotency_key),
    };
    if (action === 'create_family') {
      Object.assign(args, {
        p_project_id: uuid(input.project_id, 'project_id'), p_document_id: uuid(input.document_id, 'document_id'),
        p_title: text(input.title, 'title', 160), p_category: choice(input.category, 'category', CATEGORIES, true),
        p_visibility: choice(input.visibility ?? 'private', 'visibility', VISIBILITIES), p_request_ids: ids(input.request_ids),
        p_note: text(input.note, 'note', 1000, true),
      });
    } else if (action === 'add_revision') {
      Object.assign(args, {
        p_family_id: uuid(input.family_id, 'family_id'), p_document_id: uuid(input.document_id, 'document_id'),
        p_expected_revision_id: uuid(input.expected_revision_id, 'expected_revision_id'), p_note: text(input.note, 'note', 1000, true),
      });
    } else if (action === 'update_family') {
      if (!Number.isInteger(input.expected_version) || Number(input.expected_version) < 1) throw new DomainError('expected_version is invalid', 'BAD_REQUEST');
      Object.assign(args, {
        p_family_id: uuid(input.family_id, 'family_id'), p_title: text(input.title, 'title', 160),
        p_category: choice(input.category, 'category', CATEGORIES, true), p_visibility: choice(input.visibility, 'visibility', VISIBILITIES),
        p_request_ids: ids(input.request_ids), p_expected_version: input.expected_version,
      });
    } else {
      const noteRequired = action === 'observations' || action === 'correction_requested' || action === 'comment';
      Object.assign(args, { p_revision_id: uuid(input.revision_id, 'revision_id'), p_note: text(input.note, 'note', 2000, !noteRequired) });
    }
    return this.call('document_dossier_command_v1', args);
  }
}
