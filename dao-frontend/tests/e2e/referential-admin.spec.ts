import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures';
import { login } from './support/flow';

// #547 — une seule entrée « Référentiel » (Admin), six onglets, données réelles du catalogue
// publié (#541), ancien onglet de Paramètres redirigé, refus des autres rôles.
// Lecture seule : la publication d'une version est couverte par les tests SQL (tests/btp-admin-cases.mjs)
// pour ne pas modifier le catalogue partagé par les autres scénarios.
async function navLinks(page: Page, name: string) {
  if (test.info().project.name === 'mobile') await page.getByRole('button', { name: 'Ouvrir le menu', exact: true }).click();
  // The navigation renders once roles are loaded: wait for a link every role has.
  await expect(page.getByRole('link', { name: 'Tableau de bord', exact: true }).filter({ visible: true }).first()).toBeVisible();
  return page.getByRole('link', { name, exact: true }).filter({ visible: true });
}

test('Référentiel Admin : entrée unique, six onglets et catalogue réel', async ({ page, e2eAdmin }) => {
  expect(e2eAdmin).toBeTruthy();
  await login(page, e2eAdmin!);
  const links = await navLinks(page, 'Référentiel');
  await expect(links).toHaveCount(1);
  await links.click();
  await expect(page).toHaveURL(/\/app\/dao\/referential/);
  await expect(page.getByRole('heading', { name: 'Référentiel BTP', exact: true })).toBeVisible();
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveText(['Métiers', 'Lots & sous-lots', 'Ouvrages', 'Unités & métrés', 'Règles & dépendances', 'Versions']);
  await expect(page.locator('strong').filter({ hasText: /^TN-\d{4}\.\d+$/ }).first()).toBeVisible();
  await expect(page.getByLabel('Rechercher un métier')).toBeVisible();

  await page.getByRole('tab', { name: 'Lots & sous-lots' }).click();
  await expect(page).toHaveURL(/tab=lots/);
  await page.getByRole('list', { name: 'Lots' }).getByRole('button', { name: /Terrassement et gros œuvre/ }).click();
  await expect(page.getByRole('heading', { name: 'Terrassement et gros œuvre', exact: true })).toBeVisible();
  await expect(page.getByText('btp_lot_earth_structure', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Ouvrages' }).click();
  await page.getByPlaceholder('Rechercher un ouvrage ou un synonyme…').fill('cloison');
  await page.getByRole('list', { name: 'Ouvrages' }).getByRole('button', { name: /Maçonnerie et cloisons/ }).click();
  const fiche = page.getByRole('heading', { name: 'Maçonnerie et cloisons', exact: true });
  await expect(fiche).toBeVisible();
  await expect(page.getByText(/aucune quantité ni prix/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enregistrer dans le brouillon' })).toHaveCount(0);

  await page.getByRole('tab', { name: 'Unités & métrés' }).click();
  await expect(page.getByRole('cell', { name: /Mètre carré/ })).toBeVisible();
  await page.getByRole('tab', { name: 'Règles & dépendances' }).click();
  await expect(page.getByRole('list', { name: 'Règles' }).getByRole('button')).not.toHaveCount(0);
  await page.getByRole('tab', { name: 'Versions' }).click();
  await expect(page.getByRole('heading', { name: /^Versions \(\d+\)$/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('Référentiel : plus d’onglet dans Paramètres, ancien lien redirigé', async ({ page, e2eAdmin }) => {
  expect(e2eAdmin).toBeTruthy();
  await login(page, e2eAdmin!);
  await page.goto('/app/dao/settings');
  await expect(page.getByRole('heading', { name: 'Paramètres D.A.O.' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Rubriques des paramètres' }).getByRole('button', { name: /Référentiel/ })).toHaveCount(0);
  await page.goto('/app/dao/settings?tab=catalog');
  await expect(page).toHaveURL(/\/app\/dao\/referential\?tab=metiers/);
  await expect(page.getByLabel('Rechercher un métier')).toBeVisible();
});

for (const [role, fixture] of [['Gestionnaire', 'e2eReviewer'], ['Client', 'e2eClient']] as const) {
  test(`Référentiel : refusé au ${role}`, async ({ page, e2eReviewer, e2eClient }) => {
    const user = fixture === 'e2eReviewer' ? e2eReviewer : e2eClient;
    expect(user).toBeTruthy();
    await login(page, user!);
    await expect(await navLinks(page, 'Référentiel')).toHaveCount(0);
    await page.goto('/app/dao/referential');
    await expect(page.getByText('Réservé à l’Admin D.A.O.', { exact: false })).toBeVisible();
    await expect(page.getByRole('tab')).toHaveCount(0);
  });
}
