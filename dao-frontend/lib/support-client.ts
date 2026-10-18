import { supabaseBrowser } from './supabase-browser';

// Typed client for the D.A.O. support API (#271, owned by DEV20). Shapes follow the UI contract proposed in #273;
// the backend publishes the final contract. Until the routes exist, callers get `unavailable` and show an honest state.

export type TicketStatus = 'open' | 'waiting_staff' | 'waiting_user' | 'resolved' | 'closed';
export type SupportSummary = { unread: number; open: number };
export type SupportAvailability = { state: 'available'; summary: SupportSummary } | { state: 'unavailable' } | { state: 'error'; message: string };

export const ticketStatusLabels: Record<TicketStatus, string> = {
  open: 'Ouverte', waiting_staff: 'En attente de D.A.O.', waiting_user: 'Réponse attendue de votre part', resolved: 'Résolue', closed: 'Fermée',
};

/** Probes the support summary. 404/501 (route not deployed yet) means "not available", never an error. */
export async function supportAvailability(): Promise<SupportAvailability> {
  try {
    const { data } = await supabaseBrowser().auth.getSession();
    if (!data.session) return { state: 'error', message: 'Session expirée. Reconnectez-vous.' };
    const response = await fetch('/api/support/summary', { headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: 'no-store' });
    if (response.status === 404 || response.status === 501) return { state: 'unavailable' };
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return { state: 'error', message: typeof body?.error === 'string' ? body.error : 'L’assistance est momentanément indisponible.' };
    const summary = body?.data ?? body;
    return { state: 'available', summary: { unread: Number(summary?.unread ?? 0), open: Number(summary?.open ?? 0) } };
  } catch {
    return { state: 'error', message: 'L’assistance est momentanément indisponible.' };
  }
}

/** Opens the floating help assistant from anywhere in the app. */
export function openAssistant() {
  window.dispatchEvent(new CustomEvent('dao:open-assistant'));
}
