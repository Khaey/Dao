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
  await expect(page.getByRole('main').getByText('Mes projets', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible();

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
  await expect(page.getByRole('alert')).toHaveText('Les deux mots de passe ne correspondent pas.');
  await page.getByLabel('Confirmer le mot de passe').fill(nextPassword);
  await page.getByRole('button', { name: 'Enregistrer le nouveau mot de passe' }).click();
  await expect(page.getByRole('status')).toContainText('Votre mot de passe a été mis à jour');
  e2eClient!.password = nextPassword;
  await login(page, e2eClient!);
  await expect(page).toHaveURL(/\/app\/projects/);
});
