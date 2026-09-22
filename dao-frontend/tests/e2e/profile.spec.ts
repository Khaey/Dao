import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, email: string, password: string) {
  await page.goto('/auth/login');
  await page.getByPlaceholder('Votre email').fill(email);
  await page.getByPlaceholder('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/app\/projects/);
}

test('Mon espace affiche le profil et permet de se déconnecter', async ({ page }, testInfo) => {
  const email = process.env.PLAYWRIGHT_CLIENT_EMAIL;
  const password = process.env.PLAYWRIGHT_CLIENT_PASSWORD;
  test.skip(!email || !password, 'E2E client user was not provisioned');

  await login(page, email!, password!);
  await page.goto('/app/profile');

  await expect(page.getByRole('heading', { name: 'Votre espace D.A.O' })).toBeVisible();
  await expect(page.getByRole('main').getByText(email!, { exact: true })).toBeVisible();
  await expect(page.getByText('Espace client', { exact: true })).toBeVisible();
  await expect(page.getByText('Mes projets', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible();

  await page.screenshot({ path: `test-results/${testInfo.project.name}-profile.png`, fullPage: true });
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page).toHaveURL(/\/auth\/login/);
  await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
});
