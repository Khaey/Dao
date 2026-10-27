import { test, expect } from './support/fixtures';
import { createDraftProject, login } from './support/flow';
import { adminRows, approveDocument } from './support/collaboration';

// Dossier documentaire V2 (#456) : classement, versions V1/V2, ancienne version « Remplacé », historique.
test('Dossier documentaire : classer un plan, déposer une V2 et conserver la V1 remplacée', async ({ page, e2eClient }, testInfo) => {
  test.skip(!e2eClient, 'E2E Supabase credentials are not available');
  await login(page, e2eClient!);
  const { projectId } = await createDraftProject(page, testInfo, 'document-dossier');
  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  await page.getByLabel('Ajouter un document').setInputFiles({ name: 'plan-rdc.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%Plan V1\n') });
  const row = page.getByTestId('project-document-row').filter({ hasText: 'plan-rdc.pdf' });
  await expect(row).toContainText('En attente de contrôle');
  await row.getByRole('button', { name: 'Classer' }).click();
  const form = page.getByRole('form', { name: 'Classer le document' });
  await form.getByLabel('Intitulé').fill('Plan RDC');
  await form.getByLabel('Catégorie (facultative)').selectOption('plan');
  await form.getByRole('button', { name: 'Classer en V1' }).click();

  const family = page.getByTestId('document-family').filter({ hasText: 'Plan RDC' });
  await expect(family).toContainText('V1 courante');
  await expect(family).toContainText('À consulter');
  await expect(family).toContainText('Fichier en contrôle');
  await expect(page.getByTestId('project-document-row')).toHaveCount(0);
  // A self-authored plan offers no visa action to its author.
  await expect(family.getByRole('button', { name: 'Marquer « Revu techniquement »' })).toHaveCount(0);

  await family.getByLabel('Nouvelle version de Plan RDC').setInputFiles({ name: 'plan-rdc-indice-b.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%Plan V2\n') });
  await expect(family).toContainText('V2 courante');
  await family.getByRole('button', { name: /^Versions et historique/ }).click();
  const versions = family.getByRole('list', { name: 'Versions de Plan RDC' });
  await expect(versions.getByRole('listitem')).toHaveCount(2);
  await expect(versions.getByRole('listitem').nth(1)).toContainText('Remplacé');
  await expect(family.getByRole('list', { name: 'Historique de Plan RDC' })).toContainText('Nouvelle version déposée');

  // The file control (here the disposable fixture) makes the current version previewable through a signed URL.
  const files = await adminRows('documents', `project_id=eq.${projectId}&select=id,original_name`);
  await approveDocument(files.find(file => file.original_name === 'plan-rdc-indice-b.pdf')!.id);
  await page.reload();
  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  const reloaded = page.getByTestId('document-family').filter({ hasText: 'Plan RDC' });
  await expect(reloaded).not.toContainText('Fichier en contrôle');
  const preview = page.waitForResponse(response => response.url().includes('/api/documents/project/download') && response.request().method() === 'POST');
  await reloaded.getByRole('button', { name: 'Consulter Plan RDC' }).click();
  expect((await preview).ok()).toBeTruthy();
  await expect(page.getByRole('dialog', { name: 'Aperçu de plan-rdc-indice-b.pdf' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
