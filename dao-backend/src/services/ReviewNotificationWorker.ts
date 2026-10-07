import { emailConfiguration, type EmailConfiguration } from './ResendEmailTransport.js';
import { createClient } from '@supabase/supabase-js';

export type Notice = { id: string; project_id: string; kind: string; payload: Record<string, any>; delivery_email: string; delivery_message?: any; lease_token: string };
const labels: Record<string, string> = {
  review_submitted: 'Votre dossier est transmis à D.A.O.', review_resubmitted: 'Votre nouvelle version est transmise à D.A.O.',
  review_claimed: 'Un gestionnaire a pris en charge votre dossier.', review_reassigned: 'Votre dossier a été confié à un autre gestionnaire.',
  staff_project_updated: 'Le gestionnaire a préparé une nouvelle version de votre chantier et de ses lots. Consultez les modifications et leur historique.',
  review_approved: 'Votre dossier a été approuvé. Les lots peuvent être publiés.', review_rejected: 'Votre dossier nécessite des corrections. Modifiez-le puis soumettez une nouvelle version.',
  lot_withdrawn: 'Un lot de votre chantier a été retiré de la publication. Les offres soumises sont conservées. Une correction sera examinée avant une nouvelle publication.',
  lot_withdrawn_professional: 'Un lot auquel vous avez répondu a été retiré de la publication. Votre offre soumise est conservée. Aucune nouvelle offre ne peut être déposée sur cette publication.',
};
const reasons: Record<string,string> = { correction:'Correction du périmètre', publication_error:'Erreur de publication',client_request:'Demande du client',postponed:'Report',scope_change:'Changement de périmètre',premature:'Publication prématurée',other:'Autre' };
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function reviewMessage(notice: Notice, config: EmailConfiguration) {
  if (!labels[notice.kind]) throw new Error('UNKNOWN_NOTIFICATION');
  const p = notice.payload;
  const subject = `D.A.O — ${notice.kind.startsWith('lot_withdrawn') ? 'Retrait d’un lot' : 'Suivi de votre dossier'}`;
  const url = config.publicUrl + (notice.kind === 'lot_withdrawn_professional' ? '/app/artisan' : '/app/projects/' + encodeURIComponent(notice.project_id));
  const lines = ['Bonjour,', labels[notice.kind], ...(p.title ? [`Chantier : ${p.title}`] : []), ...(p.lot ? [`Lot : ${p.lot}`] : []), ...(p.reason ? [`Motif : ${reasons[p.reason] || p.reason}`] : []), ...(p.comment ? [String(p.comment)] : []), `Consulter votre espace : ${url}`, 'L’équipe D.A.O'];
  return { from: config.from, to: [notice.delivery_email], subject, text: lines.join('\n\n'), html: `<html lang="fr"><body style="font-family:Arial,sans-serif;line-height:1.6;color:#172b29;max-width:600px;margin:auto;padding:24px"><h1 style="font-size:24px">Suivi D.A.O</h1>${lines.slice(0,-2).map(line => `<p>${escape(line)}</p>`).join('')}<p><a href="${escape(url)}">Consulter votre espace D.A.O</a></p><p>L’équipe D.A.O</p></body></html>` };
}
export class ReviewNotificationWorker {
  constructor(private db: any, private configuration: () => EmailConfiguration = () => emailConfiguration(), private send: typeof fetch = fetch) {}
  async drain() {
    const config = this.configuration(); // Do not consume retries while unconfigured.
    const { data: rows, error } = await this.db.rpc('claim_notification_outbox', { p_limit: 10 });
    if (error) throw new Error('OUTBOX_CLAIM_FAILED');
    for (const notice of rows as Notice[]) {
      let ok = false, code: string | null = null;
      try {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notice.delivery_email || '')) throw new Error('RECIPIENT_UNAVAILABLE');
        const prepared = await this.db.rpc('prepare_notification_delivery', { p_id: notice.id, p_lease: notice.lease_token, p_message: reviewMessage(notice, config) });
        if (prepared.error || !prepared.data) throw new Error('OUTBOX_PREPARE_FAILED');
        const response = await this.send('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `dao-review/${notice.id}` }, body: JSON.stringify(prepared.data), signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error(`RESEND_HTTP_${response.status}`);
        ok = true;
      } catch (error: any) { code = /^(RECIPIENT_UNAVAILABLE|UNKNOWN_NOTIFICATION|OUTBOX_PREPARE_FAILED|RESEND_HTTP_\d+)$/.test(error?.message || '') ? error.message : 'DELIVERY_UNAVAILABLE'; }
      const completed = await this.db.rpc('complete_notification_outbox', { p_id: notice.id, p_lease: notice.lease_token, p_success: ok, p_code: code });
      if (completed.error) throw new Error('OUTBOX_COMPLETION_FAILED'); // Lease recovery retries safely.
    }
  }
}
let started = false;
export function startReviewNotificationWorker() {
  if (started || !process.env.RESEND_API_KEY || !process.env.DAO_SUPABASE_SECRET_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) return;
  started = true;
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.DAO_SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const worker = new ReviewNotificationWorker(db);
  let running = false;
  const tick = async () => { if (running) return; running = true; try { await worker.drain(); } catch { console.error('DAO notification worker: delivery unavailable'); } finally { running = false; } };
  const timer = setInterval(() => { void tick(); }, 60000); timer.unref();
  void tick();
}
