import { supabaseBrowser } from './supabase-browser';

// P9-B3 / #346: informational installment tracking, exact DTO from DEV 2 #345 (A3).
export type InstallmentEventType = 'declared' | 'verified' | 'contested' | 'authorized';
export type InstallmentState = 'pending' | InstallmentEventType;
export type InstallmentRow = {
  installment_no: number; label: string; due_date?: string | null; amount_millimes: number;
  status: InstallmentState; last_event?: { id: string; event_type: InstallmentEventType; actor_role: string; reason?: string; created_at: string } | null;
  can_declare: boolean; can_verify: boolean; can_contest: boolean; can_authorize: boolean;
};
export type InstallmentSnapshot = {
  agreement_id: string; agreement_version_id: string | null; version_no?: number; content_hash?: string;
  payment_mode: string; total_millimes?: number; currency?: string; installments: InstallmentRow[];
  events?: { id: string; installment_no: number; event_type: InstallmentEventType; actor_role: string; reason?: string; created_at: string }[];
  permissions: { party_role: 'client' | 'contractor' };
  informational_only: true; money_moved: false; payment_recorded: false; debt_created: false;
};

export class InstallmentUnavailable extends Error {}
export class InstallmentError extends Error {}

async function request<T>(method: 'GET' | 'POST', awardId: string, data?: Record<string, unknown>): Promise<T> {
  const { data: auth } = await supabaseBrowser().auth.getSession();
  if (!auth.session) throw new InstallmentError('Session expirée. Reconnectez-vous.');
  let response: Response;
  try {
    response = await fetch('/api/contracts/installments' + (method === 'GET' ? '?award_id=' + encodeURIComponent(awardId) : ''), {
      method, cache: 'no-store',
      headers: { Authorization: 'Bearer ' + auth.session.access_token, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
      body: method === 'POST' ? JSON.stringify(data) : undefined,
    });
  } catch { throw new InstallmentError('Le service des échéances est indisponible. Réessayez.'); }
  const body = await response.json().catch(() => null);
  const code = typeof body?.code === 'string' ? body.code : '';
  if (response.status === 501 || (response.status === 404 && (!code || code === 'PGRST202'))) throw new InstallmentUnavailable();
  if (!response.ok) {
    if (response.status === 401) throw new InstallmentError('Session expirée. Reconnectez-vous.');
    if (response.status === 403) throw new InstallmentError('Ce suivi est réservé au Client et à l’Artisan attributaire actif.');
    if (response.status === 409) throw new InstallmentError('Cette version n’est plus à jour. Actualisez les échéances.');
    if (response.status === 400) throw new InstallmentError(typeof body?.error === 'string' ? body.error : 'La commande a été refusée.');
    throw new InstallmentError('Le service des échéances est indisponible. Réessayez.');
  }
  return (body && typeof body === 'object' && 'data' in body ? body.data : body) as T;
}

export function readInstallments(awardId: string) {
  return request<InstallmentSnapshot>('GET', awardId);
}
export function recordInstallmentEvent(awardId: string, agreementId: string, versionId: string, installmentNo: number, eventType: InstallmentEventType, reason?: string) {
  return request<unknown>('POST', awardId, {
    agreement_id: agreementId, version_id: versionId, installment_no: installmentNo,
    event_type: eventType, reason: reason?.trim() || null, idempotency_key: crypto.randomUUID(),
  });
}
