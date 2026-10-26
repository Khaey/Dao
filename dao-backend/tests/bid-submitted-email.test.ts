import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewMessage, type Notice } from '../src/services/ReviewNotificationWorker.js';

const config = { apiKey: 'not-used-in-unit-test', from: 'D.A.O <tests@example.invalid>', publicUrl: 'https://dao.example.invalid' };
test('BUG-07 : nouveau devis soumis produit un email Client avec accès à la comparaison', () => {
  const notice: Notice = {
    id: '10000000-0000-4000-8000-000000000001',
    project_id: '20000000-0000-4000-8000-000000000002',
    kind: 'bid_submitted',
    payload: { title: 'Rénovation <test>', publication_id: '30000000-0000-4000-8000-000000000003' },
    delivery_email: 'client@example.invalid',
    lease_token: '40000000-0000-4000-8000-000000000004',
  };
  const msg = reviewMessage(notice, config);
  assert.equal(msg.subject, 'D.A.O — Nouvelle offre reçue');
  assert.deepEqual(msg.to, ['client@example.invalid']);
  assert.match(msg.text, /Une nouvelle offre a été soumise/);
  assert.match(msg.text, /\/app\/publications\/30000000-0000-4000-8000-000000000003#offres/);
  assert.match(msg.html, /Rénovation &lt;test&gt;/);
  assert.doesNotMatch(msg.html, /Rénovation <test>/);
  assert.doesNotMatch(msg.text, /montant|coordonnées personnelles|adresse artisan/i);
});

test('BUG-12 : notification email de résultat distinguant les décisions par lot', () => {
  for (const [decision, fragment, subject] of [
    ['selected','retenue pour ce lot','D.A.O — Votre offre est retenue pour un lot'], ['not_selected','attribué à un autre professionnel','D.A.O — Résultat de votre offre'],
    ['available','a été annulée','D.A.O — Attribution annulée pour un lot']
  ] as const) {
    const notice: Notice = { id: '10000000-0000-4000-8000-000000000001',
      project_id: '20000000-0000-4000-8000-000000000002',
      kind: 'bid_result', payload: { lot: 'Jardin <test>', decision },
      delivery_email: 'artisan@example.invalid', lease_token: '40000000-0000-4000-8000-000000000004' };
    const message = reviewMessage(notice, config);
    assert.equal(message.subject, subject);
    assert.ok(message.text.includes(fragment));
    assert.ok(message.text.includes('/app/artisan/offers'));
    assert.ok(message.html.includes('Jardin &lt;test&gt;'));
    assert.doesNotMatch(message.text, /\d+\s*(TND|DT)/);
  }
});
