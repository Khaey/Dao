import { test, expect } from './support/fixtures';
import { createProjectWithMainLot, login } from './support/flow';

test('Lots : version, duplication, retrait et historique', async ({ page, e2eClient }, testInfo) => {
  test.skip(!e2eClient, 'E2E Supabase credentials are not available');

  await login(page, e2eClient!);
  const project = await createProjectWithMainLot(page, testInfo, 'lots', 'Réseau de plomberie principal.');

  const originalRow = page.locator('tr').filter({ hasText: project.lotTitle });
  await expect(originalRow).toHaveCount(1);
  await originalRow.getByTitle('Modifier').click();
  await page.getByLabel('Intitulé du lot').fill('Lot plomberie E2E version 2');
  await page.getByRole('button', { name: 'Enregistrer les modifications' }).click();
  await expect(page.getByText('v2', { exact: true })).toBeVisible();

  const versionTwoRow = page.locator('tr').filter({ hasText: 'Lot plomberie E2E version 2' });
  await expect(versionTwoRow).toHaveCount(1);
  await versionTwoRow.getByTitle('Dupliquer').click();
  await page.getByLabel('Métier').selectOption({ label: 'Électricité' });
  await page.getByLabel('Intitulé du lot').fill('Lot électricité E2E');
  await page.getByLabel('Budget indicatif du lot (TND)').fill('12000');
  await page.getByLabel('Périmètre des travaux').fill('Réseau électrique et appareillage.');
  const duplicatePromise = page.waitForResponse(response => response.url().includes('/api/projects/requests') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Ajouter la demande' }).click();
  const duplicateResponse = await duplicatePromise;
  expect(duplicateResponse.ok()).toBeTruthy();
  await expect(page.getByText('Lot électricité E2E', { exact: true })).toBeVisible();

  const duplicateRow = page.locator('tr').filter({ hasText: 'Lot électricité E2E' });
  await expect(duplicateRow).toHaveCount(1);
  page.once('dialog', dialog => dialog.accept());
  await duplicateRow.getByTitle('Retirer').click();
  await expect(page.getByText('Lot électricité E2E', { exact: true })).not.toBeVisible();

  await page.getByRole('button', { name: 'Historique' }).click();
  await page.getByRole('button', { name: /Lot plomberie E2E version 2/ }).click();
  await expect(page.getByText('v2', { exact: true })).toBeVisible();
});
