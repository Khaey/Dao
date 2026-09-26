import { test, expect } from './support/fixtures';
import { createProjectWithMainLot, login } from './support/flow';

test('Revue DAO : soumission, rejet, correction, resoumission et approbation', async ({ page, browser, e2eClient, e2eReviewer }, testInfo) => {
  test.skip(!e2eClient || !e2eReviewer, 'E2E Supabase credentials are not available');

  await login(page, e2eClient!);
  const project = await createProjectWithMainLot(page, testInfo, 'review', 'Installation et essais des réseaux d’eau.', 'Lot plomberie E2E revue');
  const initialLotRow = page.locator('tr').filter({ hasText: project.lotTitle });
  await expect(initialLotRow).toHaveCount(1);
  await initialLotRow.getByTitle('Modifier').click();
  project.lotTitle = 'Lot plomberie E2E revue v2';
  await page.getByLabel('Intitulé du lot').fill(project.lotTitle);
  await page.getByRole('button', { name: 'Enregistrer les modifications' }).click();
  await expect(page.getByText('v2', { exact: true })).toBeVisible();
  await page.goto(`/app/projects/${project.projectId}/review`);
  await page.getByRole('button', { name: 'Soumettre pour revue DAO' }).click();
  await expect(page.getByText('Validation client', { exact: true })).toBeVisible();

  const reviewerContext = await browser.newContext();
  const reviewer = await reviewerContext.newPage();
  await login(reviewer, e2eReviewer!);
  await reviewer.goto('/app/dao/review');
  const reviewHeading = reviewer.getByRole('heading', { name: project.title, exact: true });
  await expect(reviewHeading).toHaveCount(1);
  const reviewCard = reviewHeading.locator('xpath=../../..');
  await expect(reviewCard.getByText(project.lotTitle, { exact: true })).toBeVisible();
  await expect(reviewCard.getByText(project.lotScope, { exact: true })).toBeVisible();
  await reviewCard.getByLabel('Commentaire de revue').fill('Commentaire E2E DAO');
  await reviewCard.getByRole('button', { name: 'Passer en revue DAO' }).click();
  await expect(reviewCard.getByText('dao_review', { exact: true })).toBeVisible();
  await reviewCard.getByLabel('Commentaire de revue').fill('À corriger : précisez le périmètre du lot.');
  await reviewCard.getByRole('button', { name: 'Refuser' }).click();
  await expect(reviewHeading).toHaveCount(0);

  await page.goto(`/app/projects/${project.projectId}`);
  await expect(page.getByText('Corrections demandées', { exact: true })).toBeVisible();
  await expect(page.getByText('À corriger : précisez le périmètre du lot.')).toBeVisible();
  await page.getByRole('button', { name: 'Corriger le DAO' }).click();
  const reviewLink = page.getByRole('link', { name: 'Revoir le DAO' });
  await expect(reviewLink).toHaveCount(1);
  await reviewLink.click();
  await page.getByRole('button', { name: 'Soumettre pour revue DAO' }).click();
  await expect(page.getByText('Validation client', { exact: true })).toBeVisible();

  await reviewer.goto('/app/dao/review');
  const finalHeading = reviewer.getByRole('heading', { name: project.title, exact: true });
  await expect(finalHeading).toHaveCount(1);
  const finalReviewCard = finalHeading.locator('xpath=../../..');
  await expect(finalReviewCard.getByText(project.lotTitle, { exact: true })).toBeVisible();
  await finalReviewCard.getByLabel('Commentaire de revue').fill('Version corrigée conforme.');
  await finalReviewCard.getByRole('button', { name: 'Passer en revue DAO' }).click();
  await expect(finalReviewCard.getByText('dao_review', { exact: true })).toBeVisible();
  await finalReviewCard.getByLabel('Commentaire de revue').fill('Validation finale E2E');
  await finalReviewCard.getByRole('button', { name: 'Approuver' }).click();
  await expect(finalHeading).toHaveCount(0);
  await reviewerContext.close();
});
