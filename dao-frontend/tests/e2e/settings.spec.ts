import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { test, expect, type E2EUser } from './support/fixtures';
import { login } from './support/flow';
import { signOut } from './support/collaboration';

async function openSettings(page: Page) {
  const menu = page.getByRole('button', { name: 'Ouvrir le menu', exact: true });
  await expect(menu.or(page.getByRole('link', { name: 'Paramètres', exact: true })).filter({ visible: true })).toBeVisible();
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('link', { name: 'Paramètres', exact: true }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/app\/settings$/);
  await expect(page.locator('#mobile-workspace-menu')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Paramètres', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
}

async function checkSettings(page: Page, user: E2EUser | null, professional: boolean, staff: boolean) {
  expect(user).toBeTruthy();
  await login(page, user!);
  await openSettings(page);
  const main = page.getByRole('main');
  await expect(main.getByRole('link', { name: /Mon dossier professionnel/ })).toHaveCount(professional ? 1 : 0);
  await expect(main.getByRole('link', { name: /Mon espace D.A.O/ })).toHaveCount(staff ? 1 : 0);
  await expect(main.getByRole('link', { name: /Paramètres de la plateforme|Utilisateurs & rôles/ })).toHaveCount(0);
  await expect(main.getByRole('switch')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await main.getByRole('link', { name: /Mon compte et coordonnées/ }).click();
  await expect(page.locator('#identity')).toBeFocused();
  await expect(page.locator('#identity')).toContainText(user!.email);
  await openSettings(page);
  await main.getByRole('link', { name: /Sécurité du compte/ }).click();
  await expect(page.locator('#security')).toBeFocused();
  await expect(page.getByLabel('Nouveau mot de passe', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('#security')).toBeFocused();
  await signOut(page);
  await expect(page).toHaveURL(/\/auth\/login/);
}

test('Paramètres Client : compte et sécurité personnels', async ({ page, e2eClient }) => {
  await checkSettings(page, e2eClient, false, false);
});
test('Paramètres Artisan : dossier professionnel conditionnel', async ({ page, e2eArtisan }) => {
  await checkSettings(page, e2eArtisan, true, false);
});
test('Paramètres Gestionnaire : aucun réglage global', async ({ page, e2eReviewer }) => {
  await checkSettings(page, e2eReviewer, false, true);
});
test('Paramètres Admin : mêmes réglages personnels', async ({ page, e2eAdmin }) => {
  await checkSettings(page, e2eAdmin, false, true);
});
test('Paramètres double rôle : compte commun après bascule', async ({ page, e2eDualRole }) => {
  await checkSettings(page, e2eDualRole, true, false);
  await login(page, e2eDualRole!);
  const menu = page.getByRole('button', { name: 'Ouvrir le menu', exact: true });
  await expect(menu.or(page.getByRole('link', { name: 'Paramètres', exact: true })).filter({ visible: true })).toBeVisible();
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: 'Artisan', exact: true }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/app$/);
  await openSettings(page);
  await page.getByRole('main').getByRole('link', { name: /Mon compte et coordonnées/ }).click();
  await expect(page.locator('#identity')).toContainText(e2eDualRole!.email);
});
test('Paramètres : accès anonyme redirigé', async ({ page }) => {
  await page.goto('/app/settings');
  await expect(page).toHaveURL(/\/auth\/login/);
});
test('Paramètres : changement de mot de passe existant et reconnexion', async ({ page, e2eSecondArtisan }) => {
  expect(e2eSecondArtisan).toBeTruthy();
  const user = e2eSecondArtisan!;
  await login(page, user);
  await page.goto('/app/settings');
  await page.getByRole('link', { name: /Sécurité du compte/ }).click();
  const nextPassword = `Settings-${randomUUID()}-A9!`;
  await page.getByLabel('Nouveau mot de passe', { exact: true }).fill(nextPassword);
  await page.getByLabel('Confirmer le mot de passe', { exact: true }).fill(nextPassword);
  await page.getByRole('button', { name: 'Changer le mot de passe', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Mot de passe mis à jour.');
  await signOut(page);
  await login(page, { ...user, password: nextPassword });
  await openSettings(page);
  await page.getByRole('main').getByRole('link', { name: /Sécurité du compte/ }).click();
  await page.getByLabel('Nouveau mot de passe', { exact: true }).fill(user.password);
  await page.getByLabel('Confirmer le mot de passe', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Changer le mot de passe', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Mot de passe mis à jour.');
});
