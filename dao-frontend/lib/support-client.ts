import { supabaseBrowser } from './supabase-browser';

// Typed client for the D.A.O. support API — contract v1 owned by DEV20 (#271, docs/messages-assistance.md).
// Until the routes are deployed (404/501 or code `unavailable`), callers receive SupportUnavailable and the UI
// shows an honest "not open yet" state: nothing is ever presented as sent when the server did not accept it.

export const supportStatuses = ['open', 'waiting_staff', 'waiting_user', 'resolved', 'closed'] as const;
export const supportCategories = ['account', 'project', 'offer', 'professional_profile', 'technical', 'other'] as const;
export type TicketStatus = typeof supportStatuses[number];
export type TicketCategory = typeof supportCategories[number];
export type SupportOrigin = { route: string; faq_id: string | null };
export type SupportTicket = {
  id: string; reference: string; subject: string; category: TicketCategory; status: TicketStatus; project_id: string | null;
  created_at: string; updated_at: string; last_message_at: string; unread_count: number; assignee_label: string | null; requester_label?: string;
};
export type SupportMessage = { id: string; ticket_id: string; author_role: 'requester' | 'staff' | 'system'; author_label: string; body: string; created_at: string };
export type SupportPage<T> = { items: T[]; next_cursor: string | null; total: number };
export type SupportSummary = { unread: number; open: number };
export type SupportAvailability = { state: 'available'; summary: SupportSummary } | { state: 'unavailable' } | { state: 'error'; message: string };

export const ticketStatusLabels: Record<TicketStatus, string> = {
  open: 'Ouverte', waiting_staff: 'En attente de D.A.O.', waiting_user: 'Réponse attendue de votre part', resolved: 'Résolue', closed: 'Fermée',
};
export const staffStatusLabels: Record<TicketStatus, string> = {
  open: 'Nouvelle', waiting_staff: 'À traiter', waiting_user: 'En attente du demandeur', resolved: 'Résolue', closed: 'Fermée',
};
export const ticketCategoryLabels: Record<TicketCategory, string> = {
  account: 'Mon compte', project: 'Un chantier', offer: 'Une offre', professional_profile: 'Profil professionnel', technical: 'Problème technique', other: 'Autre',
};
export const LIMITS = { subject: 120, body: 4000, reason: 500 } as const;

const errorMessages: Record<string, string> = {
  unauthenticated: 'Session expirée. Reconnectez-vous.',
  forbidden: 'Action non autorisée.',
  not_found: 'Demande introuvable.',
  ticket_closed: 'Cette demande est fermée : elle ne peut plus recevoir de message.',
  invalid: 'Vérifiez les informations saisies.',
  rate_limited: 'Trop de demandes en peu de temps. Réessayez dans un instant.',
  unavailable: 'L’assistance est momentanément indisponible.',
};

export class SupportUnavailable extends Error { constructor() { super('unavailable'); } }
export class SupportError extends Error { constructor(message: string, public readonly code?: string) { super(message); } }

async function call<T>(path: string, init: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
  const { data } = await supabaseBrowser().auth.getSession();
  if (!data.session) throw new SupportError(errorMessages.unauthenticated, 'unauthenticated');
  let response: Response;
  try {
    response = await fetch(`/api/support/${path}`, {
      method: init.method ?? 'GET', cache: 'no-store',
      headers: { Authorization: `Bearer ${data.session.access_token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  } catch { throw new SupportError(errorMessages.unavailable, 'unavailable'); }
  if (response.status === 404 && path === 'summary' || response.status === 501) throw new SupportUnavailable();
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const code = typeof body?.code === 'string' ? body.code : undefined;
    if (code === 'unavailable' || (response.status === 404 && !code)) throw new SupportUnavailable();
    throw new SupportError(code && errorMessages[code] ? errorMessages[code] : typeof body?.error === 'string' ? body.error : errorMessages.unavailable, code);
  }
  return (body && typeof body === 'object' && 'data' in body ? body.data : body) as T;
}

const key = () => `ui-${crypto.randomUUID()}`;
const query = (params: Record<string, string | null | undefined>) => {
  const search = new URLSearchParams(Object.entries(params).filter(([, value]) => value) as [string, string][]).toString();
  return search ? `?${search}` : '';
};

/** Probes the support summary. A missing route means "not open yet", never an error. */
export async function supportAvailability(): Promise<SupportAvailability> {
  try {
    const summary = await call<SupportSummary>('summary');
    return { state: 'available', summary: { unread: Number(summary?.unread ?? 0), open: Number(summary?.open ?? 0) } };
  } catch (error) {
    if (error instanceof SupportUnavailable) return { state: 'unavailable' };
    return { state: 'error', message: (error as Error).message };
  }
}

export const listTickets = (cursor?: string | null) => call<SupportPage<SupportTicket>>(`tickets${query({ cursor })}`);
export const getTicket = (id: string) => call<{ ticket: SupportTicket; messages: SupportMessage[] }>(`tickets/${encodeURIComponent(id)}`);
export const createTicket = (input: { subject: string; category: TicketCategory; body: string; project_id?: string | null; origin?: SupportOrigin | null }) =>
  call<SupportTicket>('tickets', { method: 'POST', body: { ...input, idempotency_key: key() } });
export const replyToTicket = (id: string, body: string) =>
  call<SupportMessage>(`tickets/${encodeURIComponent(id)}/messages`, { method: 'POST', body: { body, idempotency_key: key() } });
export const markTicketRead = (id: string) => call<unknown>(`tickets/${encodeURIComponent(id)}/read`, { method: 'POST', body: {} });

export type QueueFilter = { status?: TicketStatus | null; assignee?: 'me' | 'unassigned' | 'all'; cursor?: string | null };
export const listQueue = (filter: QueueFilter) =>
  call<SupportPage<SupportTicket>>(`queue${query({ status: filter.status ?? null, assignee: filter.assignee ?? 'all', cursor: filter.cursor ?? null })}`);
export const assignToMe = (id: string) => call<SupportTicket>(`tickets/${encodeURIComponent(id)}/assign`, { method: 'POST', body: { assignee: 'me' } });
export const setTicketStatus = (id: string, status: TicketStatus, reason: string | null) =>
  call<SupportTicket>(`tickets/${encodeURIComponent(id)}/status`, { method: 'POST', body: { status, reason } });

/** Route sent with a request created from the assistant: path only, invitation tokens never leave the browser. */
export function originRoute(pathname: string) {
  const path = pathname.split(/[?#]/)[0] || '/';
  return path.startsWith('/invite/') ? '/invite' : path.slice(0, 160);
}

/** Opens the floating help assistant from anywhere in the app. */
export function openAssistant() {
  window.dispatchEvent(new CustomEvent('dao:open-assistant'));
}

export const formatSupportDate = (value: string) => new Date(value).toLocaleString('fr-TN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
