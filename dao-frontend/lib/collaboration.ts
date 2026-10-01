import { supabaseBrowser } from './supabase-browser';

export const stageLabels: Record<string, string> = {
  not_started: 'Pas encore commencé', started: 'Juste commencé',
  in_progress: 'Travaux en cours', completed: 'Travaux terminés',
};
export const paymentLabels: Record<string, string> = {
  not_set: 'Non renseignée', unpaid: 'Non payé', partial: 'Partiellement payé', paid: 'Payé',
};
export type Member = { id: string; user_id: string; participation_role: 'client' | 'contractor'; status: string; can_view_private_details: boolean; name: string };
export type Invitation = { id: string; expected_role: 'client' | 'contractor'; recipient_email: string | null; status: string; expires_at: string };
export type Team = { members: Member[]; invitations: Invitation[]; events: { id: string; action: string; created_at: string }[]; is_client: boolean; can_prepare: boolean; can_view_private_details: boolean };
export const emptyTeam: Team = { members: [], invitations: [], events: [], is_client: false, can_prepare: false, can_view_private_details: false };

export async function projectApi<T = any>(path: string, body?: Record<string, unknown>, publicAccess = false): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!publicAccess) {
    const { data } = await supabaseBrowser().auth.getSession();
    if (!data.session) throw new Error('Session expirée. Reconnectez-vous.');
    headers.Authorization = 'Bearer ' + data.session.access_token;
  }
  const response = await fetch(path, { method: body ? 'POST' : 'GET', headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Opération refusée.');
  return payload.data;
}

// Only an invitation path may survive an authentication round trip.
// Never accept an arbitrary URL from a browser parameter.
export function invitationReturn(search: string): string | null {
  const value = new URLSearchParams(search).get('returnTo');
  return value && /^\/invite\/[a-f0-9]{64}$/.test(value) ? value : null;
}
