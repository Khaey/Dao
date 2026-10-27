import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog, previewConfig } from './email-catalog.js';
import { reviewMessage, type Notice } from '../src/services/ReviewNotificationWorker.js';
import { renderEmailHtml } from '../src/services/emailLayout.js';

// #482 — every e-mail the repository sends shares one accessible, client-safe layout.
const entries = catalog();

test('Catalogue : les 11 types d’outbox, les 3 décisions par lot et l’invitation sont tous couverts', () => {
  const ids = new Set(entries.map(entry => entry.id));
  for (const id of ['project_invitation', 'review_submitted', 'review_resubmitted', 'review_claimed', 'review_reassigned', 'staff_project_updated', 'review_approved', 'review_rejected', 'bid_submitted', 'bid_result_selected', 'bid_result_not_selected', 'bid_result_available', 'lot_withdrawn', 'lot_withdrawn_professional']) assert.ok(ids.has(id), id);
  assert.equal(new Set(entries.map(entry => entry.message.subject)).size >= 11, true, 'subjects are specific, not one generic line');
});

for (const entry of entries) {
  test(`Gabarit commun — ${entry.label}`, () => {
    const { subject, text, html } = entry.message;
    assert.match(subject, /^(D\.A\.O — |Invitation )/);
    assert.doesNotMatch(subject, /[\r\n]/);
    // Layout: French, 600 px max with an Outlook frame, hidden preheader, text wordmark, signature.
    assert.match(html, /^<!doctype html>\n<html lang="fr"/);
    assert.ok(html.includes('max-width:600px') && html.includes('<!--[if mso]>'));
    assert.match(html, /<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">\s*\S/);
    assert.ok(html.includes('Transparence · Précision · Confiance') && text.includes('Transparence · Précision · Confiance'));
    // Exactly one call-to-action, pointing to the existing screen, with the full URL kept in the text version.
    const links = [...html.matchAll(/href="([^"]+)"/g)].map(match => match[1].replaceAll('&amp;', '&'));
    assert.equal(links.length, 1);
    assert.ok(links[0].includes(entry.ctaPath), links[0]);
    assert.ok(text.includes(links[0]));
    // Client-safe: no image, script, tracking, web font or remote resource; no price.
    for (const forbidden of [/<img/i, /<script/i, /<link/i, /@import/i, /url\(/i, /<iframe/i, /\d+\s*(TND|DT)\b/]) assert.doesNotMatch(html, forbidden);
    assert.doesNotMatch(text, /\d+\s*(TND|DT)\b/);
  });
}

test('Règles métier : retenue ≠ contrat, approbation ≠ publication, offre reçue ≠ choix', () => {
  const byId = Object.fromEntries(entries.map(entry => [entry.id, entry.message]));
  assert.match(byId.bid_result_selected.text, /aucun contrat n’est conclu/);
  assert.match(byId.review_approved.text, /pas encore une publication/);
  assert.match(byId.bid_submitted.text, /ne signe aucun contrat/);
  assert.doesNotMatch(byId.bid_submitted.text, /retenue|gagnante|attribuée/i);
  assert.doesNotMatch(byId.bid_result_not_selected.text, /retenue pour ce lot/);
  assert.match(byId.review_rejected.text, /Précisez la surface/);
  assert.match(byId.lot_withdrawn.text, /Changement de périmètre/);
});

test('Échappement : <>&"\' et retours à la ligne des données ne cassent ni le HTML ni l’objet', () => {
  const hostile = 'A <b>&"\'\r\nBcc: x@example.invalid';
  for (const kind of ['review_rejected', 'review_reassigned', 'lot_withdrawn', 'bid_result', 'bid_submitted']) {
    const notice: Notice = { id: 'n', project_id: 'p"><script>', kind, payload: { title: hostile, lot: hostile, reason: hostile, comment: hostile, decision: 'selected', publication_id: 'x"y' }, delivery_email: 'client@example.invalid', lease_token: 'l' };
    const message = reviewMessage(notice, previewConfig);
    assert.doesNotMatch(message.html, /<b>|<script>|"y"/);
    assert.ok(message.html.includes('&lt;b&gt;&amp;&quot;&#39;'));
    assert.doesNotMatch(message.subject, /[\r\n]|Bcc/);
    assert.doesNotMatch(message.text, /\r/);
  }
  assert.throws(() => reviewMessage({ id: 'n', project_id: 'p', kind: 'unknown_kind', payload: {}, delivery_email: 'a@example.invalid', lease_token: 'l' }, previewConfig), /UNKNOWN_NOTIFICATION/);
});

test('Gabarit : contenu facultatif absent sans bloc vide', () => {
  const html = renderEmailHtml({ title: 't', preheader: 'p', eyebrow: 'e', heading: 'h', paragraphs: [['x']], cta: { label: 'Ouvrir', url: 'https://dao.example.invalid/app' } });
  assert.doesNotMatch(html, /Prochaine étape|undefined|null/);
});
