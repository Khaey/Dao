import { test, expect } from './support/fixtures';
import { login } from './support/flow';

test('Gestionnaire : navigation mobile accessible en portrait et écran court', async ({ page, e2eReviewer }) => {
  expect(e2eReviewer).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, e2eReviewer!);
  await page.goto('/app/dao');
  await expect(page.getByRole('heading', { name: 'Pilotage D.A.O' })).toBeVisible();

  const menu = page.getByRole('button', { name: 'Ouvrir le menu', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Menu de navigation' });
  const assertNoHorizontalOverflow = async () => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  };
  await assertNoHorizontalOverflow();
  await expect(page.getByRole('link', { name: 'Mon compte', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Déconnexion', exact: true })).toHaveCount(0);
  await menu.click();
  await expect(dialog).toBeVisible();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expect(dialog.getByRole('button', { name: 'Fermer le menu' })).toBeFocused();
  await expect(dialog.getByRole('link', { name: 'Utilisateurs & rôles', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('link', { name: 'Historique', exact: true })).toBeVisible();
  await assertNoHorizontalOverflow();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  await dialog.getByRole('button', { name: 'Déconnexion', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('link', { name: 'D.A.O.', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(menu).toBeFocused();

  await page.setViewportSize({ width: 320, height: 568 });
  await menu.click();
  await assertNoHorizontalOverflow();
  await dialog.getByRole('link', { name: 'Revues', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/dao\/review$/);
  await expect(dialog).toHaveCount(0);

  await page.setViewportSize({ width: 568, height: 320 });
  await menu.click();
  const navigation = dialog.getByRole('navigation', { name: 'Espace Gestionnaire DAO' });
  expect(await navigation.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(321);
  await expect(dialog.getByRole('button', { name: 'Déconnexion', exact: true })).toBeInViewport();
  await navigation.getByRole('link', { name: 'Historique', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/dao\/history$/);
  await expect(dialog).toHaveCount(0);
  await assertNoHorizontalOverflow();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('banner').getByRole('link', { name: /D\.A\.O/ }).click();
  await expect(page).toHaveURL(/\/app\/dao$/);
  await menu.click();
  await expect(dialog).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(dialog).toHaveCount(0);
  await expect(menu).toBeHidden();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  await expect(page.getByRole('navigation', { name: 'Espace Gestionnaire DAO' }).getByRole('link', { name: 'Historique', exact: true })).toBeVisible();
});
