/** Shared, pure S1 contract. Authorization belongs to JWT-scoped SQL RPCs. */
export type NotificationKind = 'review_approved' | 'review_rejected' | 'invitation_received' | 'invitation_accepted' | 'project_message' | 'invitation_expiring';
export type NotificationWorkspace = 'client' | 'contractor' | 'staff';
export type NotificationCursor = { created_at: string; id: string };
export type NotificationItem = NotificationCursor & { kind: NotificationKind; read_at: string | null; title: string; href: string; action_required: boolean; expires_at: string | null };
export type NotificationPage = { rows: NotificationItem[]; unread_count: number; workspace: NotificationWorkspace; next_cursor: string | null };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Preserve database microseconds: rounding to JS milliseconds can skip rows.
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/;
const titles: Record<NotificationKind, string> = {
  review_approved: 'Dossier approuvé', review_rejected: 'Dossier à corriger',
  invitation_received: 'Invitation reçue', invitation_accepted: 'Invitation acceptée',
  project_message: 'Nouveau message', invitation_expiring: 'Invitation bientôt expirée',
};
export class NotificationContractError extends Error {
  constructor(public readonly code: 'BAD_REQUEST' | 'INVALID_NOTIFICATION_DATA') {
    super(code === 'BAD_REQUEST' ? 'Paramètres de notifications invalides.' : 'Notifications temporairement indisponibles.');
  }
}
export function notificationId(value: unknown): string {
  if (typeof value !== 'string' || !uuid.test(value)) throw new NotificationContractError('BAD_REQUEST');
  return value;
}
function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !timestamp.test(value) || value.startsWith('0000-')) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,19) === value.slice(0,19);
}
export function parseNotificationQuery(query: URLSearchParams) {
  for (const key of query.keys()) if (!['limit', 'cursor', 'unread', 'action'].includes(key) || query.getAll(key).length !== 1)
    throw new NotificationContractError('BAD_REQUEST');
  const raw = query.get('limit') ?? '20';
  if (!/^[1-9]\d?$/.test(raw) || Number(raw) > 50) throw new NotificationContractError('BAD_REQUEST');
  const unread = query.get('unread') ?? 'false';
  if (!['true', 'false'].includes(unread)) throw new NotificationContractError('BAD_REQUEST');
  const action = query.get('action') ?? 'false';
  if (!['true', 'false'].includes(action)) throw new NotificationContractError('BAD_REQUEST');
  let before: NotificationCursor | null = null;
  const cursor = query.get('cursor');
  if (cursor !== null) {
    const parts = cursor.split('~');
    if (parts.length !== 2 || !validTimestamp(parts[0]) || !uuid.test(parts[1])) throw new NotificationContractError('BAD_REQUEST');
    before = { created_at: parts[0], id: parts[1] };
  }
  return { limit: Number(raw), unread: unread === 'true', action: action === 'true', before };
}
export function notificationHref(kind: NotificationKind, targetId: unknown): string {
  // Never trust an href, returnTo, title or body from stored JSON.
  if (typeof targetId !== 'string' || !uuid.test(targetId) || !Object.hasOwn(titles, kind))
    throw new NotificationContractError('INVALID_NOTIFICATION_DATA');
  if (kind === 'invitation_received' || kind === 'invitation_expiring') return '/app/invitations';
  if (kind === 'project_message') return `/app/messages/${targetId}`;
  if (kind === 'invitation_accepted') return `/app/projects/${targetId}`;
  return `/app/projects/${targetId}/review`;
}
export function notificationPage(value: unknown, limit: number): NotificationPage {
  const fail = (): never => { throw new NotificationContractError('INVALID_NOTIFICATION_DATA'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const data = value as Record<string, any>;
  if (!['client', 'contractor', 'staff'].includes(data.workspace) || !Array.isArray(data.rows) || data.rows.length > limit
      || !Number.isSafeInteger(data.unread_count) || data.unread_count < 0 || typeof data.has_more !== 'boolean') fail();
  const ids = new Set<string>();
  const rows = data.rows.map((row: any): NotificationItem => {
    if (!row || typeof row !== 'object' || !uuid.test(row.id) || ids.has(row.id) || !validTimestamp(row.created_at)
        || (row.read_at !== null && !validTimestamp(row.read_at)) || !Object.hasOwn(titles, row.kind)
        || typeof row.action_required !== 'boolean' || (row.expires_at !== null && !validTimestamp(row.expires_at))) fail();
    if ((row.kind === 'invitation_expiring') !== row.action_required || (row.kind === 'invitation_expiring') !== (row.expires_at !== null)) fail();
    ids.add(row.id);
    return { id: row.id, kind: row.kind, title: titles[row.kind as NotificationKind], created_at: row.created_at,
      read_at: row.read_at, href: notificationHref(row.kind, row.target_id), action_required: row.action_required, expires_at: row.expires_at };
  });
  if (data.has_more && rows.length !== limit) fail();
  const last = rows.at(-1);
  return { rows, unread_count: data.unread_count, workspace: data.workspace,
    next_cursor: data.has_more && last ? `${last.created_at}~${last.id}` : null };
}
