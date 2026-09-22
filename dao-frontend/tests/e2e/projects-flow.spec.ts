import { expect, test, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

async function login(page: Page, email: string, password: string) {
  await page.goto('/auth/login');
  await page.getByPlaceholder('Votre email').fill(email);
  await page.getByPlaceholder('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/app\/projects/);
}

function rememberProject(id: string) {
  const file = process.env.DAO_E2E_STATE_FILE;
  if (!file) return;
  const state = JSON.parse(readFileSync(file, 'utf8'));
  state.projects = [...(state.projects || []), id];
  writeFileSync(file, JSON.stringify(state));
}

test('Client → reviewer DAO → artisan → offre DEV', async ({ browser }, testInfo) => {
  const clientEmail = process.env.PLAYWRIGHT_CLIENT_EMAIL;
  const clientPassword = process.env.PLAYWRIGHT_CLIENT_PASSWORD;
  const reviewerEmail = process.env.PLAYWRIGHT_REVIEWER_EMAIL;
  const reviewerPassword = process.env.PLAYWRIGHT_REVIEWER_PASSWORD;
  const artisanEmail = process.env.PLAYWRIGHT_ARTISAN_EMAIL;
  const artisanPassword = process.env.PLAYWRIGHT_ARTISAN_PASSWORD;
  test.skip(!clientEmail || !clientPassword || !reviewerEmail || !reviewerPassword || !artisanEmail || !artisanPassword, 'E2E users were not provisioned');

  const clientContext = await browser.newContext();
  const client = await clientContext.newPage();
  await login(client, clientEmail!, clientPassword!);
  const projectTitle = `DAO E2E DEV ${testInfo.project.name}`;
  await client.goto('/app/projects/new');
  await client.getByLabel('Titre du projet').fill(projectTitle);
  await client.getByLabel('Description').fill('Projet E2E client reviewer publication');
  await client.getByLabel('Gouvernorat').selectOption({ index: 1 });
  await client.getByLabel('Délégation').selectOption({ index: 1 });
  await client.getByLabel('Localité').selectOption({ index: 1 });
  await client.getByLabel('Budget indicatif (TND)').fill('150000');
  await client.getByRole('button', { name: 'Créer le projet et ajouter les demandes' }).click();
  await expect(client).toHaveURL(/\/app\/projects\/(?!new(?:\/|$))[^/?#]+/);
  const projectId = client.url().split('/').pop()!;
  rememberProject(projectId);
  await client.getByLabel('Métier').selectOption({ index: 1 });
  await client.getByLabel('Intitulé du lot').fill('Lot plomberie E2E');
  await client.getByLabel('Budget indicatif du lot (TND)').fill('25000');
  await client.getByLabel('Périmètre des travaux').fill('Installation plomberie complète');
  await client.getByRole('button', { name: 'Ajouter la demande' }).click();
  await expect(client.getByText('Lot plomberie E2E')).toBeVisible();
  await client.getByRole('button', { name: 'Modifier', exact: true }).click();
  await client.getByLabel('Intitulé du lot').fill('Lot plomberie E2E version 2');
  await client.getByRole('button', { name: 'Enregistrer les modifications' }).click();
  await expect(client.getByText('Version 2', { exact: true })).toBeVisible();
  await expect(client.getByText('Historique (2)')).toBeVisible();
  await client.getByRole('link', { name: 'Revoir le DAO' }).click();
  await client.getByRole('button', { name: 'Soumettre pour revue DAO' }).click();
  await expect(client.getByText('Validation client').first()).toBeVisible();
  await client.close();
  await clientContext.close();

  const reviewerContext = await browser.newContext();
  const reviewer = await reviewerContext.newPage();
  await login(reviewer, reviewerEmail!, reviewerPassword!);
  await reviewer.goto('/app/dao/review');
  const reviewCard = reviewer.locator('section > div').filter({ hasText: projectTitle }).first();
  await expect(reviewCard).toBeVisible();
  await reviewCard.getByLabel('Commentaire de revue').fill('Commentaire E2E DAO');
  await reviewCard.getByRole('button', { name: 'Passer en revue DAO' }).click();
  await expect(reviewCard.getByText('dao_review')).toBeVisible();
  await reviewCard.getByLabel('Commentaire de revue').fill('À corriger : précisez le périmètre du lot.');
  await reviewCard.getByRole('button', { name: 'Refuser' }).click();
  await expect(reviewCard).not.toBeVisible();
  await reviewerContext.close();

  const correctionContext = await browser.newContext();
  const correctionClient = await correctionContext.newPage();
  await login(correctionClient, clientEmail!, clientPassword!);
  await correctionClient.goto('/app/projects/' + projectId);
  await expect(correctionClient.getByText('Corrections demandées')).toBeVisible();
  await expect(correctionClient.getByText('À corriger : précisez le périmètre du lot.')).toBeVisible();
  await correctionClient.getByRole('button', { name: 'Corriger le DAO' }).click();
  await expect(correctionClient.getByRole('link', { name: 'Revoir le DAO' })).toBeVisible();
  await expect(correctionClient.getByText('Version 2').first()).toBeVisible();
  await correctionClient.getByRole('link', { name: 'Revoir le DAO' }).click();
  await correctionClient.getByRole('button', { name: 'Soumettre pour revue DAO' }).click();
  await expect(correctionClient.getByText('Validation client').first()).toBeVisible();
  await correctionContext.close();

  const finalReviewerContext = await browser.newContext();
  const finalReviewer = await finalReviewerContext.newPage();
  await login(finalReviewer, reviewerEmail!, reviewerPassword!);
  await finalReviewer.goto('/app/dao/review');
  const finalReviewCard = finalReviewer.locator('section > div').filter({ hasText: projectTitle }).first();
  await expect(finalReviewCard).toBeVisible();
  await finalReviewCard.getByLabel('Commentaire de revue').fill('Version corrigée conforme.');
  await finalReviewCard.getByRole('button', { name: 'Passer en revue DAO' }).click();
  await expect(finalReviewCard.getByText('dao_review')).toBeVisible();
  await finalReviewCard.getByLabel('Commentaire de revue').fill('Validation finale E2E');
  await finalReviewCard.getByRole('button', { name: 'Approuver' }).click();
  await expect(finalReviewCard).not.toBeVisible();
  await finalReviewer.goto('/app/dao/publications/new?project_id=' + projectId);
  await finalReviewer.getByRole('button', { name: 'Publier le DAO' }).click();
  await expect(finalReviewer).toHaveURL(/\/app\/publications\/[^/]+/);
  const publicationUrl = finalReviewer.url();
  const publicationId = publicationUrl.split('/').pop()!;
  const stateFile = process.env.DAO_E2E_STATE_FILE!;
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  state.publications = [...(state.publications || []), publicationId];
  writeFileSync(stateFile, JSON.stringify(state));
  await expect(finalReviewer.getByText(projectTitle)).toBeVisible();
  await finalReviewer.screenshot({ path: `test-results/${testInfo.project.name}-published.png`, fullPage: true });
  await finalReviewerContext.close();

  const artisanContext = await browser.newContext();
  const artisan = await artisanContext.newPage();
  await login(artisan, artisanEmail!, artisanPassword!);
  await artisan.goto('/app/artisan');
  await expect(artisan.getByText(projectTitle)).toBeVisible();
  await artisan.getByRole('link', { name: projectTitle }).click();
  await expect(artisan).toHaveURL(/\/app\/artisan\/publications\//);
  await expect(artisan.getByRole('heading', { name: /Lot plomberie E2E/ }).first()).toBeVisible();
  await artisan.getByLabel('Répondre à ce lot').check();
  await artisan.getByLabel('Prix proposé (TND)').fill('25000');
  await artisan.getByLabel('Délai (jours)').fill('21');
  await artisan.getByLabel('Proposition technique / inclusions').fill('Fourniture, pose, essais et remise en état.');
  await artisan.getByRole('button', { name: 'Enregistrer le brouillon' }).click();
  await expect(artisan.getByRole('status')).toContainText('Brouillon enregistré');
  await artisan.getByRole('button', { name: 'Soumettre l’offre' }).click();
  await expect(artisan.getByRole('heading', { name: 'Offre envoyée' })).toBeVisible();
  await artisan.getByRole('button', { name: 'Préparer une nouvelle version' }).click();
  await expect(artisan.getByRole('button', { name: 'Soumettre l’offre' })).toBeVisible();
  await artisan.getByLabel('Prix proposé (TND)').fill('26000');
  await artisan.getByLabel('Délai (jours)').fill('22');
  await artisan.getByLabel('Proposition technique / inclusions').fill('Version révisée avec délai actualisé.');
  await artisan.getByRole('button', { name: 'Soumettre l’offre' }).click();
  await expect(artisan.getByText(/Version 2 soumise/)).toBeVisible();
  await artisan.screenshot({ path: `test-results/${testInfo.project.name}-artisan-offer.png`, fullPage: true });
  await artisan.goto('/app/artisan');
  await expect(artisan.getByText('Offre envoyée').first()).toBeVisible();
  await artisanContext.close();

  const finalContext = await browser.newContext();
  const final = await finalContext.newPage();
  await login(final, clientEmail!, clientPassword!);
  await final.goto(publicationUrl);
  await expect(final.getByText(projectTitle)).toBeVisible();
  await finalContext.close();
});
