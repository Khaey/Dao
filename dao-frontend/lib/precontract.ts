import { supabaseBrowser } from './supabase-browser';

// Pre-contract agreement (« Conditions et calendrier ») — UI client for #346.
// The backend, its rules and its DTO belong to DEV 2 (#345). This module is the ONLY place that knows the wire
// format: when DEV 2 publishes the final DTO, adapt it here. Until the route is deployed (404 without code, 501),
// callers get PrecontractUnavailable and the UI shows an explained, inactive state — never a fake action.

export type PartyRole = 'client' | 'contractor';
export type PaymentFrequency = 'unspecified' | 'daily' | 'weekly' | 'monthly' | 'milestone' | 'completion';
export type Terms = {
  mode: 'simple' | 'advanced';
  start_date: string | null; end_date: string | null; duration_days: number | null;
  conditions: string | null;
  payment: { frequency: PaymentFrequency; note: string | null };
  sub_lots: { sub_lot_id: string; start_date: string | null; end_date: string | null }[];
};
export type VersionStatus = 'draft' | 'sent' | 'agreed' | 'rejected' | 'superseded';
export type AgreementVersion = {
  id: string; version_no: number; content_hash: string; author_role: PartyRole; status: VersionStatus; created_at: string;
  terms: Terms; acceptances: { party_role: PartyRole; accepted_at: string }[];
  rejection: { reason: string; party_role: PartyRole; created_at: string } | null;
};
export type AgreementEvent = { id: string; type: string; actor_role: PartyRole | 'dao'; version_no: number | null; reason: string | null; created_at: string };
export type Agreement = {
  award_id: string; contract_id: string | null; viewer_role: PartyRole; total_millimes: number;
  lots: { request_id: string; title: string; agreed_millimes: number; sub_lots: { id: string; title: string }[] }[];
  draft: AgreementVersion | null; current: AgreementVersion | null; agreed_version_id: string | null;
  versions: AgreementVersion[]; events: AgreementEvent[];
  can: { save_draft: boolean; send: boolean; accept: boolean; reject: boolean };
};

export const partyLabel: Record<PartyRole, string> = { client: 'Client', contractor: 'Artisan' };
export const paymentLabels: Record<PaymentFrequency, string> = {
  unspecified: 'Non précisée', daily: 'À la journée', weekly: 'Chaque semaine', monthly: 'Chaque mois', milestone: 'Par étape (jalon)', completion: 'À la fin des travaux',
};
export const eventLabels: Record<string, string> = {
  draft_saved: 'Brouillon enregistré', sent: 'Proposition envoyée', accepted: 'Version acceptée', rejected: 'Proposition refusée',
  superseded: 'Version remplacée par une contre-proposition', agreed: 'Accord commun atteint',
};
export const emptyTerms = (): Terms => ({ mode: 'simple', start_date: null, end_date: null, duration_days: null, conditions: null, payment: { frequency: 'unspecified', note: null }, sub_lots: [] });

const errorMessages: Record<string, string> = {
  unauthenticated: 'Session expirée. Reconnectez-vous.',
  forbidden: 'Seuls le Client et l’Artisan attributaire de ce lot peuvent consulter ces conditions.',
  not_found: 'Aucune attribution active ne correspond à ce dossier.',
  version_conflict: 'Cette version n’est plus la dernière : l’autre partie a proposé une modification. Relisez la nouvelle version.',
  invalid: 'Vérifiez les informations saisies.',
  award_inactive: 'L’attribution de ce lot n’est plus active : les conditions ne peuvent plus être modifiées.',
  unavailable: 'Le service est momentanément indisponible. Réessayez dans un instant.',
};

export class PrecontractUnavailable extends Error { constructor() { super('unavailable'); } }
export class PrecontractError extends Error { constructor(message: string, public readonly code?: string) { super(message); } }

async function call<T>(init: { method: 'GET'; query: string } | { method: 'POST'; body: unknown }): Promise<T> {
  const { data } = await supabaseBrowser().auth.getSession();
  if (!data.session) throw new PrecontractError(errorMessages.unauthenticated, 'unauthenticated');
  let response: Response;
  try {
    response = await fetch(`/api/precontract${init.method === 'GET' ? init.query : ''}`, {
      method: init.method, cache: 'no-store',
      headers: { Authorization: `Bearer ${data.session.access_token}`, ...(init.method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
      body: init.method === 'POST' ? JSON.stringify(init.body) : undefined,
    });
  } catch { throw new PrecontractError(errorMessages.unavailable, 'unavailable'); }
  if (response.status === 501) throw new PrecontractUnavailable();
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const code = typeof body?.code === 'string' ? body.code : undefined;
    if (response.status === 404 && !code) throw new PrecontractUnavailable();
    throw new PrecontractError(code && errorMessages[code] ? errorMessages[code] : typeof body?.error === 'string' ? body.error : errorMessages.unavailable, code);
  }
  return (body && typeof body === 'object' && 'data' in body ? body.data : body) as T;
}

const key = () => `ui-${crypto.randomUUID()}`;
export const readAgreement = (awardId: string) => call<Agreement>({ method: 'GET', query: `?award_id=${encodeURIComponent(awardId)}` });
const command = (action: string, input: Record<string, unknown>) => call<Agreement>({ method: 'POST', body: { action, input, idempotency_key: key() } });
export const saveDraft = (awardId: string, baseVersionId: string | null, terms: Terms) => command('save_draft', { award_id: awardId, base_version_id: baseVersionId, terms });
export const sendVersion = (awardId: string, versionId: string) => command('send', { award_id: awardId, version_id: versionId });
export const acceptVersion = (awardId: string, version: AgreementVersion) => command('accept', { award_id: awardId, version_id: version.id, content_hash: version.content_hash });
export const rejectVersion = (awardId: string, versionId: string, reason: string) => command('reject', { award_id: awardId, version_id: versionId, reason });

/** Field-level differences between two term sets, as human labels — what changed in a counter-proposal. */
export function termsDiff(before: Terms | null, after: Terms) {
  const fmtDate = (value: string | null) => value ? new Intl.DateTimeFormat('fr-TN', { dateStyle: 'medium' }).format(new Date(`${value}T00:00:00`)) : 'Non précisée';
  const rows: { label: string; before: string; after: string; sensitive: boolean }[] = [];
  const add = (label: string, a: string, b: string, sensitive = false) => { if (a !== b) rows.push({ label, before: a, after: b, sensitive }); };
  const base = before ?? emptyTerms();
  add('Date de début', fmtDate(base.start_date), fmtDate(after.start_date), true);
  add('Date de fin', fmtDate(base.end_date), fmtDate(after.end_date), true);
  add('Durée', base.duration_days ? `${base.duration_days} jours` : 'Non précisée', after.duration_days ? `${after.duration_days} jours` : 'Non précisée', true);
  add('Modalité de paiement', paymentLabels[base.payment.frequency], paymentLabels[after.payment.frequency], true);
  add('Précision sur le paiement', base.payment.note || '—', after.payment.note || '—', true);
  add('Conditions essentielles', base.conditions || '—', after.conditions || '—');
  const subKey = (terms: Terms) => JSON.stringify([...terms.sub_lots].sort((x, y) => x.sub_lot_id.localeCompare(y.sub_lot_id)));
  if (subKey(base) !== subKey(after)) rows.push({ label: 'Calendrier des sous-lots', before: base.sub_lots.length ? 'Dates précédentes' : 'Aucune date', after: after.sub_lots.length ? 'Dates modifiées (voir le détail)' : 'Aucune date', sensitive: true });
  return rows;
}
