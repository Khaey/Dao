import { test, expect } from '@playwright/test';

// Page publique : aucune donnée ni compte requis.

test('accueil : deux parcours visibles reliés à l’inscription existante', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const project = page.getByRole('link', { name: 'J’ai un projet', exact: true });
  const professional = page.getByRole('link', { name: 'Je suis professionnel', exact: true });
  await expect(project).toHaveAttribute('href', '/auth/register');
  await expect(professional).toHaveAttribute('href', '/auth/register');
  // Pas de présélection de rôle : le choix reste dans le formulaire d’inscription.
  expect(await project.getAttribute('href')).not.toContain('role');
  expect(await professional.getAttribute('href')).not.toContain('role');
  await professional.click();
  await expect(page).toHaveURL(/\/auth\/register$/);
  await expect(page.getByRole('radio', { name: /Client/ })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Artisan \/ Entreprise/ })).toBeVisible();
});

test('accueil : navigation, sections distinctes et étapes', async ({ page }) => {
  await page.goto('/');
  const header = page.getByRole('banner');
  await expect(header.getByRole('link', { name: 'Se connecter' })).toHaveAttribute('href', '/auth/login');
  await expect(header.getByRole('link', { name: 'Créer un compte' })).toHaveAttribute('href', '/auth/register');
  await expect(page.getByRole('heading', { level: 2, name: /Préparez, comparez et décidez/ })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: /Répondez aux projets qui correspondent à votre métier/ })).toBeVisible();
  await expect(page.getByRole('list').filter({ has: page.getByRole('heading', { level: 3, name: 'Suivre le chantier' }) }).getByRole('listitem')).toHaveCount(4);
  await expect(page.getByRole('link', { name: 'Mot de passe oublié' })).toHaveAttribute('href', '/auth/forgot-password');
});

test('accueil : une offre peut couvrir un ou plusieurs lots', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 3, name: 'Une offre sur un ou plusieurs lots' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Une offre par lot');
});

test('accueil : aucune allégation sur des fonctions non livrées', async ({ page }) => {
  await page.goto('/');
  const text = (await page.locator('body').innerText()).toLowerCase();
  for (const forbidden of ['signature électronique', 'paiement', 'assurance', 'garantie', 'accompagnement personnalisé']) {
    expect(text, forbidden).not.toContain(forbidden);
  }
});

test('accueil : clavier (lien d’évitement) et mobile sans défilement horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Aller au contenu' })).toBeFocused();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.getByRole('link', { name: 'J’ai un projet', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Je suis professionnel', exact: true })).toBeVisible();
});
