import { test, expect } from '@playwright/test';

test('Client prépare un projet et ses demandes', async ({ page }, testInfo) => {
  const email = process.env.PLAYWRIGHT_CLIENT_EMAIL;
  const password = process.env.PLAYWRIGHT_CLIENT_PASSWORD;
  test.skip(!email || !password, 'PLAYWRIGHT_CLIENT_EMAIL/PASSWORD requis pour le test E2E réel');

  await page.goto('/auth/login');
  await page.getByPlaceholder('Votre email').fill(email!);
  await page.getByPlaceholder('Mot de passe').fill(password!);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/app\/projects/);

  await page.goto('/app/projects/new');
  await page.getByLabel('Titre du projet').fill('Projet E2E D.A.O');
  await page.getByLabel('Description').fill('Validation du parcours de préparation.');
  await page.getByLabel('Type').selectOption('construction');
  await page.getByLabel('Surface (m²)').fill('180');
  await page.getByLabel('Budget indicatif (TND)').fill('150000');
  await page.getByLabel('Date souhaitée').fill('2027-06-01');
  await page.getByLabel('Gouvernorat').selectOption({ index: 1 });
  await page.getByLabel('Délégation').selectOption({ index: 1 });
  await page.getByLabel('Localité').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Créer le projet et ajouter les demandes' }).click();
  await expect(page).toHaveURL(/\/app\/projects\/[^/]+/);

  await page.getByLabel('Métier').selectOption({ index: 1 });
  await page.getByLabel('Intitulé').fill('Plomberie test E2E');
  await page.getByLabel('Budget indicatif du lot (TND)').fill('25000');
  await page.getByLabel('Périmètre des travaux').fill('Demande créée par Playwright');
  await page.getByRole('button', { name: 'Ajouter la demande' }).click();
  await expect(page.getByText('Plomberie test E2E')).toBeVisible();
  await page.screenshot({ path: `test-results/${testInfo.project.name}-projects-flow.png`, fullPage: true });
});