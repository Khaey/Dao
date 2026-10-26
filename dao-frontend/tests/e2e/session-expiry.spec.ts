import { test, expect } from './support/fixtures';

// #387 phase 1: an expired or missing session is never shown as « Accès réservé »; the person reconnects and
// lands back on the page they were reading. A deliberate « Déconnexion » shows no « session expirée » notice.
test('Session expirée : retour à la connexion avec la raison, puis à la page consultée', async ({ page, e2eReviewer }) => {
  test.skip(!e2eReviewer, 'E2E Supabase credentials are not available');
  await page.goto('/app/dao/review?vue=mine');
  await expect(page).toHaveURL(/\/auth\/login\?raison=session&retour=%2Fapp%2Fdao%2Freview%3Fvue%3Dmine$/);
  await expect(page.getByRole('status').filter({ hasText: 'Votre session a expiré' })).toBeVisible();
  await expect(page.getByText('Accès réservé')).toHaveCount(0);
  await page.getByPlaceholder('Votre email').fill(e2eReviewer!.email);
  await page.getByPlaceholder('Mot de passe').fill(e2eReviewer!.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/app\/dao\/review\?vue=mine$/);

  await page.getByRole('button', { name: 'Déconnexion' }).first().click();
  await expect(page).toHaveURL(/\/auth\/login$/);
  await expect(page.getByText('Votre session a expiré')).toHaveCount(0);
});

test('Le retour après connexion refuse les adresses hors de l’application', async ({ page, e2eClient }) => {
  test.skip(!e2eClient, 'E2E Supabase credentials are not available');
  await page.goto('/auth/login?raison=session&retour=%2F%2Fexample.com%2Fapp');
  await page.getByPlaceholder('Votre email').fill(e2eClient!.email);
  await page.getByPlaceholder('Mot de passe').fill(e2eClient!.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/app(?:[/?#]|$)/);
  expect(new URL(page.url()).host).not.toBe('example.com');
});
