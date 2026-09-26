import { test, expect } from './support/fixtures';
import { createDraftProject, login } from './support/flow';

test('Documents privés : dépôt, consultation, retrait et confidentialité', async ({ page, e2eClient }, testInfo) => {
  test.skip(!e2eClient, 'E2E Supabase credentials are not available');

  await login(page, e2eClient!);
  await createDraftProject(page, testInfo, 'documents-private');
  await page.getByRole('button', { name: 'Documents' }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'plan-e2e.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n%DAO E2E\n'),
  });

  const documentRow = page.getByTestId('project-document-row').filter({ hasText: 'plan-e2e.pdf' });
  await expect(documentRow).toHaveCount(1);
  await expect(documentRow).toContainText('En attente de contrôle');
  const [documentPage, documentResponse] = await Promise.all([
    page.waitForEvent('popup'),
    page.waitForResponse(response => response.url().includes('/api/documents/project/download') && response.request().method() === 'POST'),
    documentRow.getByRole('button', { name: 'Consulter' }).click(),
  ]);
  expect(documentResponse.ok()).toBeTruthy();
  const documentPayload = await documentResponse.json();
  expect(documentPayload.data).toMatch(/\/storage\/v1\/object\/sign\/dao-private\//);
  await documentPage.close();

  page.once('dialog', dialog => dialog.accept());
  await documentRow.getByRole('button', { name: 'Retirer' }).click();
  await expect(page.getByText('plan-e2e.pdf', { exact: true })).not.toBeVisible();

  await page.getByRole('button', { name: 'Vue d’ensemble' }).click();
  await expect(page.getByRole('heading', { name: 'Informations privées et confidentielles' })).toBeVisible();
  await expect(page.getByText('Non visibles par les artisans.', { exact: true })).toBeVisible();
  await page.getByLabel('Adresse exacte').fill('12 rue de Sahloul, Sousse');
  await page.getByLabel('Instructions d’accès').fill('Appeler avant l’arrivée.');
  await page.getByLabel('Téléphone privé').fill('+21620123456');
  await page.getByLabel('Email privé').fill('client-e2e@example.invalid');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('status')).toContainText('Coordonnées privées enregistrées.');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Informations privées et confidentielles' })).toBeVisible();
  await expect(page.getByLabel('Adresse exacte')).toHaveValue('12 rue de Sahloul, Sousse');
  await expect(page.getByLabel('Instructions d’accès')).toHaveValue('Appeler avant l’arrivée.');
  await expect(page.getByLabel('Téléphone privé')).toHaveValue('+21620123456');
  await expect(page.getByLabel('Email privé')).toHaveValue('client-e2e@example.invalid');

  await page.getByRole('button', { name: 'Documents' }).click();
  await expect(page.getByLabel('Adresse exacte')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Informations privées et confidentielles' })).toHaveCount(0);
  await expect(page.getByText('12 rue de Sahloul, Sousse', { exact: true })).toHaveCount(0);
  await expect(page.getByText('client-e2e@example.invalid', { exact: true })).toHaveCount(0);
});
