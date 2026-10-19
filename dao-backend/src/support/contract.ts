export const supportStatuses = ['open', 'waiting_staff', 'waiting_user', 'resolved', 'closed'] as const;
export const supportCategories = ['account', 'project', 'offer', 'professional_profile', 'technical', 'other'] as const;

export type SupportStatus = typeof supportStatuses[number];
export type SupportCategory = typeof supportCategories[number];
export type SupportOrigin = { route: string; faq_id: string | null };
export type SupportTicket = {
  id: string;
  reference: string;
  subject: string;
  category: SupportCategory;
  status: SupportStatus;
  project_id: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string;
  unread_count: number;
  assignee_label: string | null;
  requester_label?: string;
};
export type SupportMessage = {
  id: string;
  ticket_id: string;
  author_role: 'requester' | 'staff' | 'system';
  author_label: string;
  body: string;
  created_at: string;
};
export type SupportPage<T> = { items: T[]; next_cursor: string | null; total: number };
export type SupportSummary = { unread: number; open: number };
export type SupportErrorCode = 'unauthenticated' | 'forbidden' | 'not_found' | 'ticket_closed' | 'invalid' | 'rate_limited' | 'unavailable';

export class SupportContractError extends Error {
  constructor(public readonly code: SupportErrorCode = 'invalid') { super(code); }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const idempotency = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;
const publicRoute = /^\/(?:$|auth\/(?:login|register)$|invite$|app(?:\/[A-Za-z0-9/_-]*)?$)/;
const faqId = /^[a-z0-9][a-z0-9-]{0,63}$/;

function text(value: unknown, min: number, max: number): string {
  if (typeof value !== 'string') throw new SupportContractError();
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(normalized))
    throw new SupportContractError();
  return normalized;
}

export function supportId(value: unknown): string {
  if (typeof value !== 'string' || !uuid.test(value)) throw new SupportContractError();
  return value;
}

export function supportIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !idempotency.test(value)) throw new SupportContractError();
  return value;
}

export function supportOrigin(value: unknown): SupportOrigin | null {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SupportContractError();
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['route', 'faq_id'].includes(key))) throw new SupportContractError();
  const route = text(input.route, 1, 160);
  if (!publicRoute.test(route) || route.includes('..') || route.includes('?') || route.includes('#')) throw new SupportContractError();
  const candidate = input.faq_id;
  if (candidate !== undefined && candidate !== null && (typeof candidate !== 'string' || !faqId.test(candidate))) throw new SupportContractError();
  return { route, faq_id: candidate == null ? null : candidate as string };
}

export function createTicketInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SupportContractError();
  const input = value as Record<string, unknown>;
  const allowed = ['subject', 'category', 'body', 'project_id', 'origin', 'idempotency_key'];
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new SupportContractError();
  if (typeof input.category !== 'string' || !supportCategories.includes(input.category as SupportCategory)) throw new SupportContractError();
  return {
    subject: text(input.subject, 4, 120), category: input.category as SupportCategory, body: text(input.body, 1, 4000),
    project_id: input.project_id == null ? null : supportId(input.project_id), origin: supportOrigin(input.origin),
    idempotency_key: supportIdempotencyKey(input.idempotency_key),
  };
}

export function replyInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SupportContractError();
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['body', 'idempotency_key'].includes(key))) throw new SupportContractError();
  return { body: text(input.body, 1, 4000), idempotency_key: supportIdempotencyKey(input.idempotency_key) };
}

export function statusInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SupportContractError();
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['status', 'reason'].includes(key)) || typeof input.status !== 'string'
      || !supportStatuses.includes(input.status as SupportStatus)) throw new SupportContractError();
  const reason = input.reason == null ? null : text(input.reason, 4, 500);
  if (['resolved', 'closed'].includes(input.status) && !reason) throw new SupportContractError();
  return { status: input.status as SupportStatus, reason };
}

type SupportCursor = { before: string; id: string };

export function supportCursor(value: string | null): SupportCursor | null {
  if (value === null) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (Object.keys(decoded).length !== 2 || typeof decoded.before !== 'string' || !supportId(decoded.id)
        || !Number.isFinite(Date.parse(decoded.before))) throw new Error('invalid cursor');
    return { before: decoded.before, id: decoded.id as string };
  } catch { throw new SupportContractError(); }
}

export function nextSupportCursor(item: Pick<SupportTicket, 'last_message_at'|'id'>): string {
  return Buffer.from(JSON.stringify({ before: item.last_message_at, id: supportId(item.id) })).toString('base64url');
}

export function supportListQuery(query: URLSearchParams, staff = false) {
  const allowed = staff ? ['limit', 'cursor', 'status', 'assignee'] : ['limit', 'cursor'];
  if ([...query.keys()].some(key => !allowed.includes(key))) throw new SupportContractError();
  const rawLimit = query.get('limit');
  if (rawLimit !== null && !/^[1-9][0-9]?$/.test(rawLimit)) throw new SupportContractError();
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  if (limit > 50) throw new SupportContractError();
  const cursor = supportCursor(query.get('cursor'));
  const status = query.get('status');
  const assignee = query.get('assignee') ?? 'all';
  if (!staff && (status !== null || assignee !== 'all')) throw new SupportContractError();
  if (staff && status !== null && !supportStatuses.includes(status as SupportStatus)) throw new SupportContractError();
  if (staff && !['all', 'me', 'unassigned'].includes(assignee)) throw new SupportContractError();
  return { limit, cursor, status: status as SupportStatus | null, assignee };
}
