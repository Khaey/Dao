import { supabaseBrowser } from './supabase-browser';

// Pre-contract agreement (« Conditions et calendrier ») — UI client for #346.
// Backend, rules and DTO: DEV 2, #345 / docs/product/precontract-agreement-v1.md (GET|POST /api/contracts/agreements).
// This module is the only place that knows the wire format. Until the route is deployed (404 without code, 501),
// callers get PrecontractUnavailable and the UI shows an explained, inactive state — never a fake action.

export type PartyRole = 'client' | 'contractor';
export type PaymentMode = 'none' | 'daily' | 'weekly' | 'monthly' | 'milestone' | 'sub_lot' | 'lot_end' | 'project_end';
export type Installment = { label: string; due_date?: string | null; amount_millimes: number };
export type SubLotSchedule = { node_key: string; start_date?: string | null; end_date?: string | null; duration_days?: number | null };
export type Terms = {
  planned_start_date?: string | null; duration_days?: number | null; execution_terms?: string | null;
  payment_mode?: PaymentMode; installments?: Installment[]; sub_lot_schedule?: SubLotSchedule[];
};
export type ReferenceSubLot = { node_key: string; position?: number; title: string; scope?: string; start_date?: string; end_date?: string; duration_days?: number; budget_millimes?: number };
export type ReferenceItem = { award_item_id: string; request_id: string; agreed_millimes: number; title: string; scope?: string; duration_days?: number | null; sub_lots: ReferenceSubLot[] };
export type Reference = { award_id: string; project_id: string; currency: string; total_millimes: number; items: ReferenceItem[] };
export type AgreementVersion = { id: string; version_no: number; content_hash: string; proposed_role: PartyRole; created_at: string; terms: Terms };
export type Acceptance = { version_id: string; party_role: PartyRole; accepted_at: string };
export type AgreementEvent = { id: string; version_id?: string; actor_role: PartyRole; event_type: 'proposed' | 'counter_proposed' | 'accepted' | 'agreed' | 'rejected'; reason?: string; created_at: string };
export type Snapshot = {
  agreement: { id: string; award_id: string; project_id: string; status: 'negotiating' | 'agreed' | 'rejected'; current_version_id: string; agreed_at: string | null } | null;
  reference: Reference | null;
  current_version: AgreementVersion | null;
  versions: AgreementVersion[]; acceptances: Acceptance[]; events: AgreementEvent[];
  permissions: { party_role: PartyRole; can_propose: boolean; can_accept: boolean; can_reject: boolean };
};

export const partyLabel: Record<PartyRole, string> = { client: 'Client', contractor: 'Artisan' };
export const partyWith: Record<PartyRole, string> = { client: 'le Client', contractor: 'l’Artisan' };
export const partyTo: Record<PartyRole, string> = { client: 'au Client', contractor: 'à l’Artisan' };
export const paymentLabels: Record<PaymentMode, string> = {
  none: 'Non précisée', daily: 'À la journée', weekly: 'Chaque semaine', monthly: 'Chaque mois', milestone: 'Par étape (jalon)',
  sub_lot: 'À la fin de chaque sous-lot', lot_end: 'À la fin du lot', project_end: 'À la fin du chantier',
};
export const eventLabels: Record<AgreementEvent['event_type'], string> = {
  proposed: 'Première proposition', counter_proposed: 'Contre-proposition', accepted: 'Version acceptée', agreed: 'Accord commun atteint', rejected: 'Proposition refusée',
};

const messages = {
  unauthenticated: 'Session expirée. Reconnectez-vous.',
  forbidden: 'Seuls le Client et l’Artisan attributaire de ce lot peuvent consulter ces conditions.',
  unavailable: 'Le service est momentanément indisponible. Réessayez dans un instant.',
};

export class PrecontractUnavailable extends Error { constructor() { super('unavailable'); } }
/** `conflict` (HTTP 409): the version moved or the action no longer applies — reload the snapshot. */
export class PrecontractError extends Error { constructor(message: string, public readonly kind: 'forbidden' | 'conflict' | 'invalid' | 'other') { super(message); } }

async function call<T>(init: { method: 'GET'; query: string } | { method: 'POST'; body: Record<string, unknown> }): Promise<T> {
  const { data } = await supabaseBrowser().auth.getSession();
  if (!data.session) throw new PrecontractError(messages.unauthenticated, 'other');
  let response: Response;
  try {
    response = await fetch(`/api/contracts/agreements${init.method === 'GET' ? init.query : ''}`, {
      method: init.method, cache: 'no-store',
      headers: { Authorization: `Bearer ${data.session.access_token}`, ...(init.method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
      body: init.method === 'POST' ? JSON.stringify(init.body) : undefined,
    });
  } catch { throw new PrecontractError(messages.unavailable, 'other'); }
  if (response.status === 501) throw new PrecontractUnavailable();
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const code = typeof body?.code === 'string' ? body.code : undefined;
    if (response.status === 404 && !code) throw new PrecontractUnavailable();
    const serverMessage = typeof body?.error === 'string' && body.error && body.error !== 'Request failed' ? body.error : '';
    if (response.status === 401) throw new PrecontractError(messages.unauthenticated, 'other');
    if (response.status === 403) throw new PrecontractError(messages.forbidden, 'forbidden');
    if (response.status === 409) throw new PrecontractError(serverMessage || 'Cette version n’est plus à jour. Les conditions ont été rechargées.', 'conflict');
    if (response.status === 400) throw new PrecontractError(serverMessage || 'Vérifiez les informations saisies.', 'invalid');
    throw new PrecontractError(messages.unavailable, 'other');
  }
  return (body && typeof body === 'object' && 'data' in body ? body.data : body) as T;
}

const key = () => crypto.randomUUID();
export const readAgreement = (awardId: string) => call<Snapshot>({ method: 'GET', query: `?award_id=${encodeURIComponent(awardId)}` });
export const propose = (awardId: string, baseVersionId: string | null, terms: Terms) => call<unknown>({ method: 'POST', body: { action: 'propose', award_id: awardId, base_version_id: baseVersionId, terms, idempotency_key: key() } });
export const accept = (agreementId: string, versionId: string) => call<unknown>({ method: 'POST', body: { action: 'accept', agreement_id: agreementId, version_id: versionId, idempotency_key: key() } });
export const reject = (agreementId: string, versionId: string, reason: string) => call<unknown>({ method: 'POST', body: { action: 'reject', agreement_id: agreementId, version_id: versionId, reason, idempotency_key: key() } });

/** Terms as sent to the server: only filled fields, nothing invented. */
export function cleanTerms(terms: Terms): Terms {
  const out: Terms = { payment_mode: terms.payment_mode ?? 'none' };
  if (terms.planned_start_date) out.planned_start_date = terms.planned_start_date;
  if (terms.duration_days) out.duration_days = terms.duration_days;
  if (terms.execution_terms?.trim()) out.execution_terms = terms.execution_terms.trim();
  const schedule = (terms.sub_lot_schedule ?? []).filter(row => row.start_date && row.end_date).map(row => ({ node_key: row.node_key, start_date: row.start_date, end_date: row.end_date }));
  if (schedule.length) out.sub_lot_schedule = schedule;
  if (terms.installments?.length) out.installments = terms.installments;
  return out;
}

const fmtDate = (value?: string | null) => value ? new Intl.DateTimeFormat('fr-TN', { dateStyle: 'medium' }).format(new Date(`${value}T00:00:00`)) : 'Non précisée';
const scheduleKey = (terms: Terms) => JSON.stringify([...(terms.sub_lot_schedule ?? [])].map(row => [row.node_key, row.start_date ?? null, row.end_date ?? null]).sort());
const installmentKey = (terms: Terms) => JSON.stringify(terms.installments ?? []);

/** Human differences between two term sets — what a counter-proposal changes. */
export function termsDiff(before: Terms | null, after: Terms) {
  const base = before ?? {};
  const rows: { label: string; before: string; after: string; sensitive: boolean }[] = [];
  const add = (label: string, a: string, b: string, sensitive = false) => { if (a !== b) rows.push({ label, before: a, after: b, sensitive }); };
  add('Date de début', fmtDate(base.planned_start_date), fmtDate(after.planned_start_date), true);
  add('Durée', base.duration_days ? `${base.duration_days} jours` : 'Non précisée', after.duration_days ? `${after.duration_days} jours` : 'Non précisée', true);
  add('Modalité de paiement', paymentLabels[base.payment_mode ?? 'none'], paymentLabels[after.payment_mode ?? 'none'], true);
  add('Modalités d’exécution', base.execution_terms || '—', after.execution_terms || '—');
  if (scheduleKey(base) !== scheduleKey(after)) rows.push({ label: 'Calendrier des sous-lots', before: (base.sub_lot_schedule ?? []).length ? 'Dates précédentes' : 'Aucune date', after: (after.sub_lot_schedule ?? []).length ? 'Nouvelles dates (voir le détail)' : 'Aucune date', sensitive: true });
  if (installmentKey(base) !== installmentKey(after)) rows.push({ label: 'Échéances indicatives', before: `${(base.installments ?? []).length} échéance(s)`, after: `${(after.installments ?? []).length} échéance(s)`, sensitive: true });
  return rows;
}
