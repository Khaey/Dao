import { test, expect } from './support/fixtures';
import { createDraftProject, login } from './support/flow';

test('Documents privés : dépôt, consultation, retrait et confidentialité', async ({ page, e2eClient }, testInfo) => {
  test.skip(!e2eClient, 'E2E Supabase credentials are not available');

  await login(page, e2eClient!);
  // #467 : quartier libre saisi à la création, stocké uniquement dans les informations privées.
  await createDraftProject(page, testInfo, 'documents-private', { address: 'Sahloul 3, près de la mosquée' });
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

  // #464 : plan DWG (type MIME absent côté navigateur) accepté, stocké privé et téléchargé, jamais prévisualisé.
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'plan-e2e.dwg', mimeType: '', buffer: Buffer.from('AC1032 DAO E2E') });
  const dwgRow = page.getByTestId('project-document-row').filter({ hasText: 'plan-e2e.dwg' });
  await expect(dwgRow).toHaveCount(1);
  await expect(dwgRow).toContainText('En attente de contrôle');
  const dwgDownload = page.waitForResponse(response => response.url().includes('/api/documents/project/download') && response.request().method() === 'POST');
  const dwgPopup = page.waitForEvent('popup', { timeout: 10_000 }).catch(() => null);
  await dwgRow.getByRole('button', { name: 'Consulter' }).click();
  const dwgPayload = await (await dwgDownload).json();
  expect(dwgPayload.data).toMatch(/[?&]download=/);
  await (await dwgPopup)?.close();

  page.once('dialog', dialog => dialog.accept());
  await documentRow.getByRole('button', { name: 'Retirer' }).click();
  await expect(page.getByText('plan-e2e.pdf', { exact: true })).not.toBeVisible();

  await page.getByRole('button', { name: 'Vue d’ensemble' }).click();
  await page.getByText('Coordonnées privées / Accès chantier — ouvrir').click();
  await expect(page.getByRole('heading', { name: 'Informations privées et confidentielles' })).toBeVisible();
  await expect(page.getByText('Réservées aux participants disposant d’une autorisation explicite. Jamais visibles sur le marketplace.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Adresse exacte')).toHaveValue('Sahloul 3, près de la mosquée');
  await page.getByLabel('Adresse exacte').fill('12 rue de Sahloul, Sousse');
  await page.getByLabel('Instructions d’accès').fill('Appeler avant l’arrivée.');
  await page.getByLabel('Téléphone privé').fill('+21620123456');
  await page.getByLabel('Email privé').fill('client-e2e@example.invalid');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('status')).toContainText('Coordonnées privées enregistrées.');
  await page.reload();
  await page.getByText('Coordonnées privées / Accès chantier — ouvrir').click();
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
