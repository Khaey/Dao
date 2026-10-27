import { test, expect } from './support/fixtures';
import { addLocalRole } from './support/collaboration';
import { createDraftProject, createMainLot, login } from './support/flow';

test('Tableau client : nom canonique, compteurs et prochaine action distinguent les deux revues', async ({ page, browser, e2eUxClient, e2eReviewer }, testInfo) => {
  test.skip(!e2eUxClient || !e2eReviewer, 'E2E Supabase credentials are not available');

  await login(page, e2eUxClient!);
  await page.goto('/app/profile');
  const displayName = `Nom canonique ${testInfo.project.name}`;
  await page.getByRole('button', { name: 'Modifier le profil' }).click();
  await page.getByLabel('Nom affiché').fill(displayName);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('status')).toContainText('Profil mis à jour.');

  await page.goto('/app');
  await expect(page.getByRole('heading', { name: `Bonjour ${displayName}`, exact: true })).toBeVisible();
  // #477: without any chantier the dashboard shows the empty state (no counters); otherwise both reviews start at 0.
  await expect(page.getByTestId('dashboard-stat-client-review').or(page.getByText('Votre espace est prêt', { exact: true }))).toBeVisible();
  if (await page.getByTestId('dashboard-stat-client-review').count()) {
    await expect(page.getByTestId('dashboard-stat-client-review')).toContainText('0');
    await expect(page.getByTestId('dashboard-stat-dao-review')).toContainText('0');
  }

  const project = await createDraftProject(page, testInfo, 'dashboard-ux');
  await createMainLot(page, project.title, 'Lot principal pour la recette des états du tableau.');
  await page.goto(`/app/projects/${project.projectId}/review`);
  await page.getByRole('button', { name: 'Soumettre pour revue DAO' }).click();
  await expect(page.getByText('En attente de validation D.A.O.', { exact: true })).toBeVisible();
  await page.goto('/app');
  await expect(page.getByTestId('dashboard-stat-client-review')).toContainText('1');
  await expect(page.getByTestId('dashboard-stat-dao-review')).toContainText('0');
  await expect(page.getByRole('heading', { name: 'Dossier envoyé à D.A.O.', exact: true })).toBeVisible();

  const reviewerContext = await browser.newContext();
  const reviewer = await reviewerContext.newPage();
  await login(reviewer, e2eReviewer!);
  await reviewer.goto('/app/dao/review');
  const reviewCard = reviewer.getByRole('heading', { name: project.title, exact: true }).locator('xpath=../../..');
  await reviewCard.getByRole('button', { name: 'Passer en revue DAO' }).click();
  await expect(reviewCard.getByText('Revue DAO', { exact: true })).toBeVisible();
  await reviewerContext.close();

  await page.goto('/app');
  await expect(page.getByTestId('dashboard-stat-client-review')).toContainText('0');
  await expect(page.getByTestId('dashboard-stat-dao-review')).toContainText('1');
  await expect(page.getByRole('heading', { name: 'Revue D.A.O. en cours', exact: true })).toBeVisible();
});

test('Profil Admin et Client : activité et Mes chantiers restent limités aux projets du client', async ({ page, browser, e2eUxAdmin, e2eClient }, testInfo) => {
  test.skip(!e2eUxAdmin || !e2eClient, 'E2E Supabase credentials are not available');

  await addLocalRole(e2eUxAdmin!.id, 'client');
  await login(page, e2eUxAdmin!);
  await createDraftProject(page, testInfo, 'admin-client-own');

  const foreignContext = await browser.newContext();
  const foreign = await foreignContext.newPage();
  await login(foreign, e2eClient!);
  await createDraftProject(foreign, testInfo, 'admin-client-foreign');
  await foreignContext.close();

  await page.goto('/app/profile');
  await expect(page.getByTestId('profile-project-link-count')).toHaveText('1 dossier');
  await expect(page.getByTestId('profile-activity-total')).toContainText('1');
  await expect(page.getByTestId('profile-activity-draft')).toContainText('1');
  await page.goto('/app/dao');
  await expect(page.getByRole('heading', { name: 'Pilotage D.A.O' })).toBeVisible();
});
