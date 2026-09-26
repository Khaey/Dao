import { test, expect } from './support/fixtures';
import { login } from './support/flow';

test('Mon espace affiche le profil et permet de se déconnecter', async ({ page, e2eClient }, testInfo) => {
  test.skip(!e2eClient, 'E2E Supabase credentials are not available');

  await login(page, e2eClient!);
  await page.goto('/app/profile');

  await expect(page.getByRole('heading', { name: 'Votre espace D.A.O' })).toBeVisible();
  await expect(page.getByRole('main').getByText(e2eClient!.email, { exact: true })).toBeVisible();
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
  await expect(page.getByText(displayName, { exact: true })).toBeVisible();
  await expect(page.getByText(phone, { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page).toHaveURL(/\/auth\/login/);
  await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
});
