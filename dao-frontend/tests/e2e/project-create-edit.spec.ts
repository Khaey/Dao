import { test, expect } from './support/fixtures';
import { createDraftProject, dateOffset, login } from './support/flow';

test('Projet autonome : création, édition, lot principal et soumission @fast', async ({ page, e2eClient }, testInfo) => {
  test.skip(!e2eClient, 'E2E Supabase credentials are not available');

  await login(page, e2eClient!);
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: /Bonjour/ })).toBeVisible();
  let mainLotPosts = 0;
  page.on('request', request => {
    const requestUrl = new URL(request.url());
    if (requestUrl.pathname === '/api/projects/requests' && request.method() === 'POST') mainLotPosts += 1;
  });

  const project = await createDraftProject(page, testInfo, 'create-edit', { validateEndBeforeStart: true });
  await expect(page.getByText('Brouillon', { exact: true })).toHaveCount(1);

  const editedTitle = `${project.title} modifié`;
  const editedStartDate = dateOffset(35);
  const editedEndDate = dateOffset(55);
  await page.getByRole('button', { name: 'Modifier le projet' }).click();
  const editForm = page.locator('form').filter({ has: page.getByLabel('Titre du projet') });
  await editForm.getByLabel('Titre du projet').fill(editedTitle);
  await editForm.getByLabel('Description du projet').fill('Description mise à jour et conservée dans une nouvelle version.');
  await editForm.getByLabel('Budget indicatif du projet (TND)').fill('175000');
  await editForm.getByLabel('Début souhaité du projet').fill(editedStartDate);
  await editForm.getByLabel('Fin souhaitée du projet').fill(editedEndDate);
  const updatePromise = page.waitForResponse(response => response.url().endsWith('/api/projects') && response.request().method() === 'PATCH');
  await editForm.getByRole('button', { name: 'Enregistrer' }).click();
  const update = await updatePromise;
  expect(update.ok()).toBeTruthy();
  expect(update.request().postDataJSON()).toEqual(expect.objectContaining({
    title: editedTitle,
    description: 'Description mise à jour et conservée dans une nouvelle version.',
    indicative_budget_millimes: 175000000,
    desired_start_date: editedStartDate,
    desired_end_date: editedEndDate,
  }));
  await expect(page.getByRole('status')).toContainText('Projet mis à jour.');
  await expect(page.getByRole('heading', { name: editedTitle })).toBeVisible();
  await expect(page.getByTestId('project-location')).not.toContainText('Localisation à préciser');
  await page.reload();
  await expect(page.getByRole('heading', { name: editedTitle })).toBeVisible();
  await expect(page.getByTestId('project-location')).not.toContainText('Localisation à préciser');
  await expect(page.locator('body')).not.toContainText(project.projectId);
  await page.getByRole('button', { name: 'Modifier le projet' }).click();
  await expect(page.getByLabel('Budget indicatif du projet (TND)')).toHaveValue('175000');
  await expect(page.getByLabel('Début souhaité du projet')).toHaveValue(editedStartDate);
  await expect(page.getByLabel('Fin souhaitée du projet')).toHaveValue(editedEndDate);
  await page.getByRole('button', { name: 'Fermer' }).click();

  await page.goto('/app/projects');
  await page.getByLabel('Rechercher un projet').fill(editedTitle);
  await page.getByLabel('Filtrer par statut').selectOption('draft');
  const projectLink = page.locator('a:visible').filter({ hasText: editedTitle });
  await expect(projectLink).toHaveCount(1);
  await projectLink.click();
  await expect(page).toHaveURL(new RegExp(`/app/projects/${project.projectId}$`));

  await page.getByRole('button', { name: /^Lots/ }).click();
  await expect(page.getByRole('heading', { name: 'Travaux du projet' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ajouter un lot' })).toHaveCount(0);
  await expect(page.getByLabel('Métier')).toHaveValue('');
  await expect(page.getByLabel('Intitulé du lot')).toHaveValue(editedTitle);
  await expect(page.getByLabel('Périmètre des travaux')).toHaveValue('Description mise à jour et conservée dans une nouvelle version.');
  await expect(page.getByLabel('Budget indicatif du lot (TND)')).toHaveValue('175000');
  expect(mainLotPosts).toBe(0);

  await page.goto(`/app/projects/${project.projectId}/review`);
  await expect(page.getByRole('heading', { name: 'Un lot actif est nécessaire avant la soumission.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Soumettre pour revue DAO' })).toBeDisabled();
  await page.getByRole('button', { name: 'Créer le lot principal' }).click();
  await expect(page).toHaveURL(new RegExp(`/app/projects/${project.projectId}\\?tab=lots$`));
  expect(mainLotPosts).toBe(0);

  await page.getByRole('button', { name: 'Vue d’ensemble' }).click();
  await page.getByRole('button', { name: 'Modifier le projet' }).click();
  const emptyDescriptionForm = page.locator('form').filter({ has: page.getByLabel('Titre du projet') });
  await emptyDescriptionForm.getByLabel('Description du projet').fill('');
  await emptyDescriptionForm.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('status')).toContainText('Projet mis à jour.');
  await page.getByRole('button', { name: /^Lots/ }).click();
  const mainLotScope = page.getByLabel('Périmètre des travaux');
  await expect(mainLotScope).toHaveValue('');
  await expect(page.getByLabel('Métier')).toHaveValue('');
  await page.getByLabel('Métier').selectOption({ label: 'Entreprise générale' });
  await page.getByRole('button', { name: 'Créer le lot principal' }).click();
  await expect(mainLotScope).toBeFocused();
  expect(mainLotPosts).toBe(0);

  await mainLotScope.fill('Installation plomberie complète');
  const createLotPromise = page.waitForResponse(response => response.url().includes('/api/projects/requests') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Créer le lot principal' }).click();
  const createLot = await createLotPromise;
  expect(createLot.ok()).toBeTruthy();
  expect(createLot.request().postDataJSON()).toEqual(expect.objectContaining({
    project_id: project.projectId,
    trade_id: expect.any(String),
    title: editedTitle,
    scope: 'Installation plomberie complète',
    budget_millimes: 175000000,
  }));
  await expect(page.getByRole('status')).toContainText('Lot principal créé.');
  const mainLotRow = page.locator('tr').filter({ hasText: editedTitle });
  await expect(mainLotRow).toHaveCount(1);
  await expect(mainLotRow).toContainText('Entreprise générale');
  await expect(mainLotRow).toContainText('v1');
  await expect(mainLotRow).toContainText('Installation plomberie complète');
  await expect(mainLotRow.getByRole('cell').nth(2)).toContainText('175');
  expect(mainLotPosts).toBe(1);
  await expect(page.getByRole('button', { name: 'Ajouter un lot' })).toHaveCount(1);

  await page.getByRole('button', { name: 'Vue d’ensemble' }).click();
  await page.getByRole('button', { name: 'Modifier le projet' }).click();
  const afterLotForm = page.locator('form').filter({ has: page.getByLabel('Titre du projet') });
  const laterTitle = `${editedTitle} après le lot`;
  await afterLotForm.getByLabel('Titre du projet').fill(laterTitle);
  await afterLotForm.getByLabel('Description du projet').fill('Description modifiée après la création du lot.');
  await afterLotForm.getByLabel('Budget indicatif du projet (TND)').fill('190000');
  await afterLotForm.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('status')).toContainText('Projet mis à jour.');
  await page.getByRole('button', { name: /^Lots/ }).click();
  await expect(mainLotRow).not.toContainText(laterTitle);
  await expect(mainLotRow).toContainText('Installation plomberie complète');
  await expect(mainLotRow.getByRole('cell').nth(2)).toContainText('175');
  expect(mainLotPosts).toBe(1);

  await page.goto(`/app/projects/${project.projectId}/review`);
  await page.getByRole('button', { name: 'Soumettre pour revue DAO' }).click();
  await expect(page.getByText('Validation client', { exact: true })).toBeVisible();

  await page.goto('/app');
  const dashboardProject = page.getByRole('link').filter({ hasText: laterTitle });
  await expect(dashboardProject).toHaveCount(1);
  await expect(dashboardProject).toContainText('Validation client');
  await page.goto('/app/projects');
  await page.getByLabel('Rechercher un projet').fill(laterTitle);
  await page.getByLabel('Filtrer par statut').selectOption('client_review');
  const submittedProjectTitle = page.getByText(laterTitle, { exact: true });
  await expect(submittedProjectTitle).toHaveCount(1);
  await expect(submittedProjectTitle).toBeVisible();
});
