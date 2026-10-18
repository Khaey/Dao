import { test, expect } from './support/fixtures';
import { login } from './support/flow';

test('Assistant : FAQ publique, recherche et clavier, puis aide contextuelle connectée', async ({ page, e2eClient }) => {
  test.skip(!e2eClient, 'E2E Supabase credentials are not available');
  const fab = page.getByRole('button', { name: 'Aide D.A.O.', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Aide D.A.O.' });

  // Public page: closed by default, public questions only, honest contact path.
  await page.goto('/auth/login');
  await expect(fab).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await fab.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Rechercher dans l’aide')).toBeFocused();
  await expect(dialog.getByText('Comment créer un compte ?', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Comment répondre à un DAO ?', { exact: true })).toHaveCount(0);
  await dialog.getByLabel('Rechercher dans l’aide').fill('mot de passe');
  await expect(dialog.getByText('J’ai oublié mon mot de passe', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Comment créer un compte ?', { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('link', { name: 'Se connecter', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(fab).toBeFocused();

  // Signed-in area: questions for the section first, no fake "ticket created".
  await login(page, e2eClient!);
  await page.goto('/app/projects');
  await fab.click();
  await dialog.getByText('Comment créer un chantier ?', { exact: true }).click();
  await expect(dialog.getByText(/« Nouveau chantier »/)).toBeVisible();
  await expect(dialog.getByText(/arrive prochainement/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Fermer l’aide', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(fab).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});
