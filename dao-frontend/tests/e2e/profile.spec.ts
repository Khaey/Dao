import { test, expect } from './support/fixtures';
import { login } from './support/flow';

test('Mon espace affiche le profil, permet de se déconnecter et de récupérer son mot de passe', async ({ page, request, e2eClient }, testInfo) => {
  test.skip(!e2eClient, 'E2E Supabase credentials are not available');

  await login(page, e2eClient!);
  await page.goto('/app/profile');

  await expect(page.getByRole('heading', { name: 'Votre espace D.A.O' })).toBeVisible();
  const identityCard = page.getByRole('heading', { name: 'Votre identité', exact: true }).locator('xpath=../../..');
  const identityEmail = identityCard.getByText(e2eClient!.email, { exact: true });
  await expect(identityEmail).toHaveCount(1);
  await expect(identityEmail).toBeVisible();
  await expect(page.getByText('Espace client', { exact: true })).toBeVisible();
  await expect(page.getByRole('main').getByText('Mes chantiers', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible();
  // #466 : le formulaire mot de passe est replié par défaut, ouvert au clic, refermé par Échap.
  const securityToggle = page.getByRole('button', { name: 'Modifier le mot de passe' });
  await expect(securityToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByLabel('Nouveau mot de passe', { exact: true })).toHaveCount(0);
  await securityToggle.click();
  await expect(page.getByLabel('Nouveau mot de passe', { exact: true })).toBeVisible();
  await page.getByLabel('Nouveau mot de passe', { exact: true }).press('Escape');
  await expect(page.getByLabel('Nouveau mot de passe', { exact: true })).toHaveCount(0);
  await expect(securityToggle).toBeFocused();

  const contractId = '11111111-1111-4111-8111-111111111111';
  const tnd = (millimes: number) => new Intl.NumberFormat('fr-TN', { style: 'currency', currency: 'TND', maximumFractionDigits: 3 }).format(millimes / 1000);
  const contract = { id: contractId, project_id: 'project', status: 'ready', total_millimes: 1250000, created_at: '2026-10-13T00:00:00Z', validated_at: '2026-10-14T00:00:00Z', legal_effect_enabled: false, non_engaging: true, parties: [{ role: 'client', legal_name: 'Client E2E' }, { role: 'contractor', legal_name: 'Atelier E2E' }, { role: 'dao', legal_name: 'LogicLab Tunisie' }], item_count: 1, amendment_count: 1 };
  await page.route(/\/api\/contracts$/, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [contract] }) }));
  await page.route(new RegExp(`/api/contracts/${contractId}$`), route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { contract: { ...contract, award_id: 'award', current_version_id: 'version', signature_mode: 'trusted_simple', cancellation_reason: null }, version: { id: 'version', version_no: 1, content_hash: 'a'.repeat(64), created_at: contract.created_at }, items: [{ id: 'item', agreed_millimes: 1250000, title: 'Lot électricité', scope: 'Pose et raccordement', duration_days: 5, inclusions: 'Main-d’œuvre', exclusions: null }], parties: contract.parties, acceptances: [{ party_role: 'client', method: 'trusted_simple', accepted_at: '2026-10-13T12:00:00Z' }], events: [{ id: 'event', event_type: 'status_changed', from_status: 'review', to_status: 'ready', reason: 'Contrôle D.A.O', created_at: '2026-10-14T00:00:00Z' }], archives: [], amendments: [{ id: 'amendment', status: 'accepted', created_at: '2026-10-14T00:00:00Z', validated_at: '2026-10-14T02:00:00Z', validation_reason: 'Contrôle D.A.O', rejected_at: null, rejection_reason: null, cancelled_at: null, cancellation_reason: null, non_engaging: true, proposal: { version_no: 1, content_hash: 'b'.repeat(64), reason: 'Évolution', scope_clarification: 'Clarification sans nouveau lot', amount_delta_millimes: 50000, base_total_millimes: 1250000, proposed_total_millimes: 1300000, planned_start_date: '2027-01-15', duration_days: 7, non_engaging: true }, acceptances: [{ party_role: 'client', method: 'trusted_simple', accepted_at: '2026-10-14T01:00:00Z' }], events: [] }] } }) }));
  await page.goto('/app/contracts');
  await expect(page.getByRole('heading', { name: 'Mes contrats' })).toBeVisible();
  await expect(page.getByText('Non signé — aucun effet juridique', { exact: true })).toBeVisible();
  await expect(page.getByText(tnd(1250000), { exact: true })).toBeVisible();
  await page.getByRole('link', { name: /Dossier contractuel — en préparation/ }).click();
  await expect(page.getByRole('heading', { name: 'Dossier contractuel — en préparation' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Proposition d’avenant — non engageante' })).toBeVisible();
  await expect(page.getByText(tnd(1300000), { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /signer|accepter|modifier/i })).toHaveCount(0);
  await expect(page.locator('main')).toHaveCSS('overflow-x', /^(visible|clip|hidden)$/);

  await page.goto('/app/profile');

  const displayName = `Client E2E ${testInfo.project.name}-${testInfo.workerIndex}`;
  const phone = testInfo.project.name === 'desktop' ? '+21620000001' : '+21620000002';
  await page.getByRole('button', { name: 'Modifier le profil' }).click({ force: true });
  await page.getByLabel('Nom affiché').fill(displayName);
  await page.getByLabel('Téléphone tunisien').fill(phone);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('status')).toContainText('Profil mis à jour.');
  await page.reload();
  await expect(identityCard.getByText(displayName, { exact: true })).toBeVisible();
  await expect(identityCard.getByText(phone, { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page).toHaveURL(/\/auth\/login/);
  await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();

  await page.goto('/auth/reset-password');
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Ce lien est invalide ou a expiré');
  await expect(page.getByRole('button', { name: 'Enregistrer le nouveau mot de passe' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Retour à la connexion' }).click();
  await page.getByRole('link', { name: 'Mot de passe oublié ?' }).click();
  await page.getByLabel('Adresse email', { exact: true }).fill(e2eClient!.email);
  await page.getByRole('button', { name: 'Envoyer le lien de réinitialisation' }).click();
  await expect(page.getByRole('status')).toContainText('Si un compte correspond à cette adresse');

  // Real local SMTP capture, using this worker's unique recipient. No DEV mail.
  let messageId = '';
  await expect.poll(async () => {
    const response = await request.get('http://127.0.0.1:54324/api/v1/search', {
      params: { query: `to:${e2eClient!.email}` },
    });
    expect(response.ok()).toBeTruthy();
    const inbox = await response.json() as { messages: Array<{ ID: string; Subject: string }> };
    const messages = inbox.messages.filter(message => /reset|password/i.test(message.Subject));
    if (messages.length === 1) messageId = messages[0].ID;
    return messages.length;
  }).toBe(1);
  const response = await request.get(`http://127.0.0.1:54324/api/v1/message/${messageId}`);
  expect(response.ok()).toBeTruthy();
  const message = await response.json() as { HTML: string };
  const links = Array.from(message.HTML.matchAll(/href="([^"]+)"/g), match => match[1].replaceAll('&amp;', '&'));
  const recoveryLinks = links.filter(link => {
    const url = new URL(link);
    return url.origin === 'http://127.0.0.1:54321' && url.pathname === '/auth/v1/verify' && url.searchParams.get('type') === 'recovery';
  });
  expect(recoveryLinks).toHaveLength(1);
  await page.goto(recoveryLinks[0]);
  await expect(page).toHaveURL(/\/auth\/reset-password/);
  await expect(page.getByLabel('Nouveau mot de passe', { exact: true })).toBeVisible();
  const nextPassword = `${e2eClient!.password}-recovered`;
  await page.getByLabel('Nouveau mot de passe', { exact: true }).fill(nextPassword);
  await page.getByLabel('Confirmer le mot de passe').fill(`${nextPassword}-different`);
  await page.getByRole('button', { name: 'Enregistrer le nouveau mot de passe' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Les deux mots de passe ne correspondent pas.');
  await page.getByLabel('Confirmer le mot de passe').fill(nextPassword);
  await page.getByRole('button', { name: 'Enregistrer le nouveau mot de passe' }).click();
  await expect(page.getByRole('status')).toContainText('Votre mot de passe a été mis à jour');
  e2eClient!.password = nextPassword;
  await login(page, e2eClient!);
  await expect(page).toHaveURL(/\/app$/);
});
