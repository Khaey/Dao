// #482 — Catalogue of every e-mail the repository renders, with fictitious data only (no token, no real address).
// Used by email-templates.test.ts (one assertion set per variant) and to write the static preview catalogue:
//   npm run build && node dist/tests/email-catalog.js <output-dir>
import { projectInvitationMessage } from '../src/services/ResendEmailTransport.js';
import { reviewMessage, type Notice } from '../src/services/ReviewNotificationWorker.js';

export const previewConfig = { apiKey: 'preview-only', from: 'D.A.O <ne-pas-repondre@example.invalid>', publicUrl: 'https://dao.example.invalid' };
const project = '20000000-0000-4000-8000-000000000002';
const publication = '30000000-0000-4000-8000-000000000003';
const notice = (kind: string, payload: Record<string, unknown>, recipient = 'client@example.invalid'): Notice =>
  ({ id: `10000000-0000-4000-8000-${kind.length.toString().padStart(12, '0')}`, project_id: project, kind, payload, delivery_email: recipient, lease_token: '40000000-0000-4000-8000-000000000004' });

export type CatalogEntry = { id: string; label: string; audience: 'Client' | 'Artisan' | 'Invité'; ctaPath: string; message: { subject: string; text: string; html: string; to: string[] } };

export function catalog(): CatalogEntry[] {
  const title = 'Rénovation maison — Sahloul';
  const review = (kind: string, label: string, payload: Record<string, unknown> = { title, version: 1 }): CatalogEntry =>
    ({ id: kind, label, audience: 'Client', ctaPath: `/app/projects/${project}`, message: reviewMessage(notice(kind, payload), previewConfig) });
  const result = (decision: string, label: string): CatalogEntry =>
    ({ id: `bid_result_${decision}`, label, audience: 'Artisan', ctaPath: '/app/artisan/offers', message: reviewMessage(notice('bid_result', { lot: 'Peinture des pièces de vie', decision }, 'artisan@example.invalid'), previewConfig) });
  return [
    { id: 'project_invitation', label: 'Invitation au chantier', audience: 'Invité', ctaPath: '/invite/',
      message: projectInvitationMessage({ to: 'invite@example.invalid', recipientName: 'Sami Ben Ali', inviterName: 'Hamma Client', title, location: 'Sousse · Sahloul', principalLot: 'Peinture des pièces de vie', expectedRole: 'contractor', url: 'https://dao.example.invalid/invite/exemple-fictif', expiresAt: '2026-11-02T10:00:00.000Z', invitationId: '50000000-0000-4000-8000-000000000005' }, previewConfig.from) },
    review('review_submitted', 'Dossier transmis pour revue'),
    review('review_resubmitted', 'Nouvelle version transmise', { title, version: 2 }),
    review('review_claimed', 'Dossier pris en charge'),
    review('review_reassigned', 'Changement de gestionnaire', { title, reason: 'Répartition de la charge entre gestionnaires' }),
    review('staff_project_updated', 'Nouvelle version préparée par le gestionnaire', { title }),
    review('review_approved', 'Dossier approuvé', { title, version: 2 }),
    review('review_rejected', 'Corrections demandées', { title, reason: 'Précisez la surface à peindre et le nombre de pièces.' }),
    { id: 'bid_submitted', label: 'Nouvelle offre reçue', audience: 'Client', ctaPath: `/app/publications/${publication}#offres`,
      message: reviewMessage(notice('bid_submitted', { title, publication_id: publication }), previewConfig) },
    result('selected', 'Résultat : offre retenue'),
    result('not_selected', 'Résultat : lot attribué à un autre professionnel'),
    result('available', 'Résultat : attribution annulée'),
    { id: 'lot_withdrawn', label: 'Lot retiré (Client)', audience: 'Client', ctaPath: `/app/projects/${project}`,
      message: reviewMessage(notice('lot_withdrawn', { lot: 'Peinture des pièces de vie', reason: 'scope_change', comment: 'Le périmètre va être précisé avec vous.' }), previewConfig) },
    { id: 'lot_withdrawn_professional', label: 'Lot retiré (Artisan)', audience: 'Artisan', ctaPath: '/app/artisan',
      message: reviewMessage(notice('lot_withdrawn_professional', { lot: 'Peinture des pièces de vie' }, 'artisan@example.invalid'), previewConfig) },
  ];
}

/** One static page per variant plus an index comparing desktop (600 px) and phone (375 px) widths. */
async function writePreviews(directory: string) {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  await mkdir(directory, { recursive: true });
  const entries = catalog();
  for (const entry of entries) {
    await writeFile(join(directory, `${entry.id}.html`), entry.message.html);
    await writeFile(join(directory, `${entry.id}.txt`), `Objet : ${entry.message.subject}\n\n${entry.message.text}`);
  }
  const esc = (value: string) => value.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const sections = entries.map(entry => `<section><h2>${esc(entry.label)} <small>${entry.audience} · <code>${entry.id}</code></small></h2><p class="subject">Objet : <strong>${esc(entry.message.subject)}</strong></p><div class="frames"><iframe title="${esc(entry.label)} — ordinateur" src="${entry.id}.html" width="640" height="900"></iframe><iframe title="${esc(entry.label)} — téléphone" src="${entry.id}.html" width="375" height="900"></iframe></div><details><summary>Version texte</summary><pre>${esc(entry.message.text)}</pre></details></section>`).join('\n');
  await writeFile(join(directory, 'index.html'), `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Catalogue des e-mails D.A.O</title><style>body{margin:0;padding:24px;background:#ece9e1;font-family:Arial,sans-serif;color:#17202a}section{margin:0 0 40px}h2 small{font-weight:400;color:#5c6670;font-size:13px}.frames{display:flex;flex-wrap:wrap;gap:16px}iframe{border:1px solid #d6d1c4;border-radius:12px;background:#fff}pre{white-space:pre-wrap;background:#fff;padding:12px;border-radius:8px}</style></head><body><h1>Catalogue des e-mails D.A.O</h1><p>Données fictives. Ordinateur (640 px) et téléphone (375 px).</p>${sections}</body></html>`);
  console.log(`${entries.length} e-mails écrits dans ${directory}`);
}

if (process.argv[1] && /email-catalog\.js$/.test(process.argv[1]) && process.argv[2]) await writePreviews(process.argv[2]);
