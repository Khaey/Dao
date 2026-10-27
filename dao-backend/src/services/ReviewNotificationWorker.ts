import { emailConfiguration, type EmailConfiguration } from './ResendEmailTransport.js';
import { createClient } from '@supabase/supabase-js';
import { cleanText, renderEmailHtml, renderEmailText, subjectLine, type EmailContent } from './emailLayout.js';

export type Notice = { id: string; project_id: string; kind: string; payload: Record<string, any>; delivery_email: string; delivery_message?: any; lease_token: string };
const labels: Record<string, string> = {
  review_submitted: 'Votre dossier est transmis à D.A.O.', review_resubmitted: 'Votre nouvelle version est transmise à D.A.O.',
  review_claimed: 'Un gestionnaire a pris en charge votre dossier.', review_reassigned: 'Votre dossier a été confié à un autre gestionnaire.',
  staff_project_updated: 'Le gestionnaire a préparé une nouvelle version de votre chantier et de ses lots. Consultez les modifications et leur historique.',
  review_approved: 'Votre dossier a été approuvé. Les lots peuvent être publiés.', review_rejected: 'Votre dossier nécessite des corrections. Modifiez-le puis soumettez une nouvelle version.',
  bid_submitted: 'Une nouvelle offre a été soumise pour votre chantier. Vous pouvez la consulter et la comparer avec les autres offres.',
  bid_result: 'Une décision est disponible pour un lot de votre offre. Votre devis initial reste conservé dans votre historique.',
  lot_withdrawn: 'Un lot de votre chantier a été retiré de la publication. Les offres soumises sont conservées. Une correction sera examinée avant une nouvelle publication.',
  lot_withdrawn_professional: 'Un lot auquel vous avez répondu a été retiré de la publication. Votre offre soumise est conservée. Aucune nouvelle offre ne peut être déposée sur cette publication.',
};
const reasons: Record<string,string> = { correction:'Correction du périmètre', publication_error:'Erreur de publication',client_request:'Demande du client',postponed:'Report',scope_change:'Changement de périmètre',premature:'Publication prématurée',other:'Autre' };
const clientReason = 'Vous recevez cet e-mail car vous suivez ce chantier sur D.A.O. Pour toute question, utilisez Messages & Assistance dans votre espace.';
const proReason = 'Vous recevez cet e-mail car vous avez répondu à un DAO sur D.A.O. Pour toute question, utilisez Messages & Assistance dans votre espace.';
const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? cleanText(String(value)) : '';

// #482: one layout for every outbox e-mail. Same facts, URLs and recipients as before; a precise subject per event
// (never user data in a subject); « retenue » never means a contract, and an approval never means a publication.
function compose(notice: Notice, url: string): { subject: string; content: EmailContent } {
  const p = notice.payload;
  const title = text(p.title), lot = text(p.lot), version = Number.isInteger(p.version) ? `Version ${p.version}` : '';
  const projectCard = title ? { label: 'Chantier', title, rows: version ? [{ label: 'Version', value: version }] : [] } : undefined;
  const lotCard = lot ? { label: 'Lot', title: lot, rows: title ? [{ label: 'Chantier', value: title }] : [] } : undefined;
  const base = { title: 'D.A.O', greeting: 'Bonjour,', reason: clientReason };
  switch (notice.kind) {
    case 'review_submitted': case 'review_resubmitted': {
      const again = notice.kind === 'review_resubmitted';
      return { subject: again ? 'D.A.O — Nouvelle version transmise pour revue' : 'D.A.O — Votre dossier est transmis pour revue', content: { ...base,
        preheader: again ? 'Votre version corrigée est transmise : elle sera vérifiée avant toute publication.' : 'Votre dossier est transmis : il sera vérifié avant toute publication.',
        eyebrow: 'Revue du dossier', heading: labels[notice.kind],
        paragraphs: [[again ? 'Votre version corrigée a bien été transmise. Un gestionnaire D.A.O. la vérifiera avant toute publication.' : 'Votre dossier a bien été transmis. Un gestionnaire D.A.O. le vérifiera avant toute publication.']],
        card: projectCard, nextStep: 'Aucune action de votre part pour le moment. Vous serez informé de sa prise en charge, puis de la décision.',
        cta: { label: 'Suivre mon dossier', url } } };
    }
    case 'review_claimed':
      return { subject: 'D.A.O — Votre dossier est pris en charge', content: { ...base,
        preheader: 'Un gestionnaire D.A.O. vérifie votre dossier.', eyebrow: 'Revue du dossier', heading: 'Votre dossier est pris en charge',
        paragraphs: [[labels.review_claimed, ' La vérification est en cours.']], card: projectCard,
        nextStep: 'Vous serez informé de la décision : approbation ou demande de corrections.', cta: { label: 'Suivre mon dossier', url } } };
    case 'review_reassigned':
      return { subject: 'D.A.O — Votre dossier change de gestionnaire', content: { ...base,
        preheader: 'La vérification de votre dossier se poursuit avec un autre gestionnaire.', eyebrow: 'Revue du dossier', heading: 'Votre dossier change de gestionnaire',
        paragraphs: [[labels.review_reassigned, ' La vérification se poursuit et l’historique de votre dossier est conservé.']],
        notice: p.reason ? { tone: 'neutral', label: 'Motif', text: reasons[p.reason] || text(p.reason) } : undefined, card: projectCard,
        cta: { label: 'Suivre mon dossier', url } } };
    case 'staff_project_updated':
      return { subject: 'D.A.O — Nouvelle version préparée pour votre chantier', content: { ...base,
        preheader: 'Votre gestionnaire a préparé une nouvelle version de votre chantier et de ses lots.', eyebrow: 'Revue du dossier', heading: 'Une nouvelle version de votre chantier est prête',
        paragraphs: [[labels.staff_project_updated]], card: projectCard,
        nextStep: 'Vérifiez les modifications depuis votre espace : chaque version reste consultable dans l’historique.', cta: { label: 'Voir les modifications', url } } };
    case 'review_approved':
      return { subject: 'D.A.O — Votre dossier est approuvé', content: { ...base,
        preheader: 'Votre dossier est approuvé : ses lots peuvent être publiés.', eyebrow: 'Décision D.A.O.', heading: 'Votre dossier est approuvé',
        paragraphs: [[labels.review_approved]], notice: { tone: 'success', label: 'Décision', text: 'Dossier approuvé', detail: 'Une approbation n’est pas encore une publication : les Artisans ne voient votre DAO qu’une fois publié.' },
        card: projectCard, nextStep: 'Les lots peuvent maintenant être publiés. Vous serez informé dès qu’une offre sera reçue.', cta: { label: 'Voir mon chantier', url } } };
    case 'review_rejected':
      return { subject: 'D.A.O — Corrections demandées sur votre dossier', content: { ...base,
        preheader: 'Votre dossier nécessite des corrections avant sa publication.', eyebrow: 'Décision D.A.O.', heading: 'Des corrections sont demandées',
        paragraphs: [['Votre dossier nécessite des corrections avant de pouvoir être publié.']], notice: p.reason ? { tone: 'warning', label: 'Commentaire du gestionnaire', text: reasons[p.reason] || text(p.reason) } : undefined,
        card: projectCard, nextStep: 'Modifiez votre dossier selon ces indications, puis soumettez une nouvelle version.', cta: { label: 'Corriger mon dossier', url } } };
    case 'bid_submitted':
      return { subject: 'D.A.O — Nouvelle offre reçue', content: { ...base,
        preheader: 'Une nouvelle offre est disponible : comparez-la avec les autres.', eyebrow: 'Offres', heading: 'Vous avez reçu une nouvelle offre',
        paragraphs: [[labels.bid_submitted]], card: projectCard,
        nextStep: 'Comparez les offres reçues lot par lot. Choisir une offre ne signe aucun contrat : les conditions se conviennent ensuite avec l’Artisan.',
        cta: { label: 'Comparer les offres', url } } };
    case 'bid_result': {
      const decision = p.decision === 'selected' ? { subject: 'D.A.O — Votre offre est retenue pour un lot', heading: 'Votre offre est retenue', notice: { tone: 'success' as const, label: 'Résultat pour ce lot', text: 'Votre proposition est retenue pour ce lot.', detail: 'Retenue ne veut pas dire signée : aucun contrat n’est conclu à ce stade.' }, next: 'Convenez avec le Client des conditions et du calendrier depuis votre espace.' }
        : p.decision === 'not_selected' ? { subject: 'D.A.O — Résultat de votre offre', heading: 'Résultat de votre offre', notice: { tone: 'neutral' as const, label: 'Résultat pour ce lot', text: 'Ce lot a été attribué à un autre professionnel.', detail: 'Vos autres lots conservent leur propre résultat.' }, next: undefined }
        : p.decision === 'available' ? { subject: 'D.A.O — Attribution annulée pour un lot', heading: 'L’attribution d’un lot a été annulée', notice: { tone: 'warning' as const, label: 'Résultat pour ce lot', text: 'L’attribution de ce lot a été annulée.', detail: 'Consultez son état actuel dans votre espace.' }, next: undefined }
        : { subject: 'D.A.O — Résultat de votre offre', heading: 'Résultat de votre offre', notice: undefined, next: undefined };
      return { subject: decision.subject, content: { ...base, reason: proReason,
        preheader: decision.notice ? decision.notice.text : labels.bid_result, eyebrow: 'Résultat de votre offre', heading: decision.heading,
        paragraphs: [[labels.bid_result]], notice: decision.notice, card: lotCard, nextStep: decision.next, cta: { label: 'Voir mes offres', url } } };
    }
    case 'lot_withdrawn':
      return { subject: 'D.A.O — Un lot a été retiré de la publication', content: { ...base,
        preheader: 'Un lot de votre chantier a été retiré de la publication. Les offres sont conservées.', eyebrow: 'Publication', heading: 'Un lot a été retiré de la publication',
        paragraphs: [['Un lot de votre chantier a été retiré de la publication. Les offres soumises sont conservées.']],
        notice: p.reason || p.comment ? { tone: 'neutral', label: 'Motif', text: p.reason ? reasons[p.reason] || text(p.reason) : 'Non précisé', detail: text(p.comment) || undefined } : undefined,
        card: lotCard, nextStep: 'Une correction sera examinée avant une nouvelle publication.', cta: { label: 'Voir mon chantier', url } } };
    case 'lot_withdrawn_professional':
      return { subject: 'D.A.O — Un lot a été retiré de la publication', content: { ...base, reason: proReason,
        preheader: 'Un lot auquel vous avez répondu a été retiré. Votre offre est conservée.', eyebrow: 'Publication', heading: 'Un lot a été retiré de la publication',
        paragraphs: [['Un lot auquel vous avez répondu a été retiré de la publication. Votre offre soumise est conservée.']],
        card: lotCard, footnotes: ['Aucune nouvelle offre ne peut être déposée sur cette publication.'], cta: { label: 'Voir les DAO disponibles', url } } };
  }
  throw new Error('UNKNOWN_NOTIFICATION');
}

export function reviewMessage(notice: Notice, config: EmailConfiguration) {
  if (!labels[notice.kind]) throw new Error('UNKNOWN_NOTIFICATION');
  const p = notice.payload;
  const url = config.publicUrl + (notice.kind === 'bid_result' ? '/app/artisan/offers' : notice.kind === 'lot_withdrawn_professional' ? '/app/artisan' : notice.kind === 'bid_submitted' && typeof p.publication_id === 'string' ? '/app/publications/' + encodeURIComponent(p.publication_id) + '#offres' : '/app/projects/' + encodeURIComponent(notice.project_id));
  const { subject, content } = compose(notice, url);
  return { from: config.from, to: [notice.delivery_email], subject: subjectLine(subject), text: renderEmailText(content), html: renderEmailHtml(content) };
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
