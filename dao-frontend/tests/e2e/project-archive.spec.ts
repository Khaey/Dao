import { test, expect } from './support/fixtures';
import { createDraftProject, login } from './support/flow';

test('Archive logique : projet brouillon absent des listes actives', async ({ page, e2eClient }, testInfo) => {
  test.skip(!e2eClient, 'E2E Supabase credentials are not available');

  await login(page, e2eClient!);
  const project = await createDraftProject(page, testInfo, 'archive');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Abandonner le projet' }).click();
  await expect(page.getByRole('status')).toContainText('Projet archivé.');
  await page.reload();
  await expect(page.getByText('Archivé', { exact: true })).toBeVisible();

  await page.goto('/app/projects');
  await page.getByLabel('Rechercher un projet').fill(project.title);
  await page.getByLabel('Filtrer par statut').selectOption('archived');
  const archivedProjectLink = page.locator('a:visible').filter({ hasText: project.title });
  await expect(archivedProjectLink).toHaveCount(1);
});
