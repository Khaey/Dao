import { createHash } from 'node:crypto';
import { expect, type Page, type TestInfo } from '@playwright/test';
import type { E2EUser } from './fixtures';
import { recordE2EValue } from './state';

export async function login(page: Page, user: E2EUser) {
  await page.goto('/auth/login');
  await page.getByPlaceholder('Votre email').fill(user.email);
  await page.getByPlaceholder('Mot de passe').fill(user.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/app\/projects/);
}

export function dateOffset(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function createDraftProject(
  page: Page,
  testInfo: TestInfo,
  scenario: string,
  options: { validateEndBeforeStart?: boolean } = {},
) {
  const testKey = createHash('sha1').update(testInfo.testId).digest('hex').slice(0, 10);
  const run = process.env.GITHUB_RUN_ID || `local-${process.pid}`;
  const attempt = process.env.GITHUB_RUN_ATTEMPT || '1';
  const title = `DAO E2E ${scenario} ${run}-${attempt}-${testInfo.project.name}-${testInfo.workerIndex}-${testKey}`;
  const description = `Projet E2E autonome ${scenario} ${testKey}`;
  const startDate = dateOffset(30);
  const endDate = dateOffset(60);

  await page.goto('/app/projects/new');
  await page.getByLabel('Titre du projet').fill(title);
  await page.getByLabel('Description').fill(description);
  await page.getByLabel('Type de projet').selectOption('renovation');
  await page.getByLabel('Surface (m²)').fill('180');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByLabel('Gouvernorat').selectOption({ index: 1 });
  await expect(page.getByLabel('Délégation')).toBeEnabled();
  await page.getByLabel('Délégation').selectOption({ index: 1 });
  await expect(page.getByLabel('Localité')).toBeEnabled();
  await page.getByLabel('Localité').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByLabel('Budget indicatif (TND)').fill('150000');
  await page.getByLabel('Début souhaité').fill(startDate);
  await page.getByLabel('Fin souhaitée').fill(endDate);
  if (options.validateEndBeforeStart) {
    await page.getByLabel('Fin souhaitée').fill(dateOffset(14));
    await page.getByRole('button', { name: 'Continuer' }).click();
    await expect(page.locator('p[role="alert"]')).toContainText('date de fin');
    await page.getByLabel('Fin souhaitée').fill(endDate);
  }
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByRole('heading', { name: 'Vérifiez les informations' })).toBeVisible();
  await page.getByRole('button', { name: 'Créer le projet' }).click();
  await expect(page).toHaveURL(/\/app\/projects\/(?!new(?:\/|$))[^/?#]+/);
  const projectId = page.url().split('/').pop()!;
  recordE2EValue(testInfo, 'projects', projectId);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  return { projectId, title, description, startDate, endDate };
}

export async function createMainLot(page: Page, projectTitle: string, scope: string, lotTitle = projectTitle) {
  await page.getByRole('button', { name: /^Lots/ }).click();
  await expect(page.getByRole('heading', { name: 'Travaux du projet' })).toBeVisible();
  await expect(page.getByLabel('Métier')).toHaveValue('');
  await expect(page.getByLabel('Intitulé du lot')).toHaveValue(projectTitle);
  if (lotTitle !== projectTitle) await page.getByLabel('Intitulé du lot').fill(lotTitle);
  await page.getByLabel('Métier').selectOption({ label: 'Entreprise générale' });
  await page.getByLabel('Périmètre des travaux').fill(scope);
  const responsePromise = page.waitForResponse(response => response.url().includes('/api/projects/requests') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Créer le lot principal' }).click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  const row = page.locator('tr').filter({ hasText: lotTitle });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Entreprise générale');
  await expect(row).toContainText('v1');
  await expect(row).toContainText(scope);
  return { row, response };
}

export async function createProjectWithMainLot(page: Page, testInfo: TestInfo, scenario: string, scope?: string, lotTitle?: string) {
  const project = await createDraftProject(page, testInfo, scenario);
  const lotScope = scope || `Travaux autonomes E2E ${scenario}`;
  await createMainLot(page, project.title, lotScope, lotTitle);
  return { ...project, lotTitle: lotTitle || project.title, lotScope };
}
