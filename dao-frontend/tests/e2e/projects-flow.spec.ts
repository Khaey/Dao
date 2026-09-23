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

function screenshot(page: Page, testInfo: { project: { name: string } }, name: string) {
  return page.screenshot({ path: `test-results/${testInfo.project.name}-${name}.png`, fullPage: true });
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
  await client.goto('/app');
  await expect(client.getByRole('heading', { name: /Bonjour/ })).toBeVisible();
  await screenshot(client, testInfo, 'dashboard');
  await client.goto('/app/projects');
  await screenshot(client, testInfo, 'projects');

  const projectTitle = `DAO E2E DEV ${testInfo.project.name}`;
  await client.goto('/app/projects/new');
  await screenshot(client, testInfo, 'new-project-step1');
  await client.getByLabel('Titre du projet').fill(projectTitle);
  await client.getByLabel('Description').fill('Projet E2E client reviewer publication');
  await client.getByLabel('Type de projet').selectOption('renovation');
  await client.getByLabel('Surface (m²)').fill('180');
  await client.getByRole('button', { name: 'Continuer' }).click();
  await client.getByLabel('Gouvernorat').selectOption({ index: 1 });
  await expect(client.getByLabel('Délégation')).toBeEnabled();
  await client.getByLabel('Délégation').selectOption({ index: 1 });
  await expect(client.getByLabel('Localité')).toBeEnabled();
  await client.getByLabel('Localité').selectOption({ index: 1 });
  await client.getByRole('button', { name: 'Continuer' }).click();
  await client.getByLabel('Budget indicatif (TND)').fill('150000');
  await client.getByLabel('Début souhaité').fill('2026-10-20');
  await client.getByLabel('Fin souhaitée').fill('2026-10-10');
  await client.getByRole('button', { name: 'Continuer' }).click();
  await expect(client.locator('p[role="alert"]')).toContainText('date de fin');
  await client.getByLabel('Début souhaité').fill('2026-10-01');
  await client.getByLabel('Fin souhaitée').fill('2026-10-15');
  await client.getByRole('button', { name: 'Continuer' }).click();
  await expect(client.getByRole('heading', { name: 'Vérifiez les informations' })).toBeVisible();
  await screenshot(client, testInfo, 'new-project-summary');
  await client.getByRole('button', { name: 'Créer le projet et ajouter les demandes' }).click();
  await expect(client).toHaveURL(/\/app\/projects\/(?!new(?:\/|$))[^/?#]+/);
  const projectId = client.url().split('/').pop()!;
  rememberProject(projectId);
  await screenshot(client, testInfo, 'project-overview');

  // Verify the complete project edit command, including versioned fields and
  // location preservation (the edit form intentionally does not send IDs).
  const editedProjectTitle = `${projectTitle} modifié`;
  await client.getByRole('button', { name: 'Modifier le projet' }).click();
  await client.getByLabel('Titre du projet').fill(editedProjectTitle);
  await client.getByLabel('Description du projet').fill('Description mise à jour et conservée dans une nouvelle version.');
  await client.getByLabel('Budget indicatif du projet (TND)').fill('175000');
  await client.getByLabel('Début souhaité du projet').fill('2026-10-05');
  await client.getByLabel('Fin souhaitée du projet').fill('2026-10-20');
  await client.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(client.getByRole('status')).toContainText('Projet mis à jour.');
  await expect(client.getByRole('heading', { name: editedProjectTitle })).toBeVisible({ timeout: 15_000 });
  await expect(client.getByTestId('project-location')).not.toContainText('Localisation à préciser', { timeout: 15_000 });
  await client.reload();
  await expect(client.getByRole('heading', { name: editedProjectTitle })).toBeVisible({ timeout: 15_000 });
  await expect(client.getByTestId('project-location')).not.toContainText('Localisation à préciser', { timeout: 15_000 });
  await expect(client.locator('body')).not.toContainText(projectId);
  await client.getByRole('button', { name: 'Modifier le projet' }).click();
  await expect(client.getByLabel('Budget indicatif du projet (TND)')).toHaveValue('175000');
  await expect(client.getByLabel('Début souhaité du projet')).toHaveValue('2026-10-05');
  await expect(client.getByLabel('Fin souhaitée du projet')).toHaveValue('2026-10-20');
  await client.getByRole('button', { name: 'Fermer' }).click();

  // The list uses the RLS-scoped data and supports search/filter without
  // exposing technical identifiers.
  await client.goto('/app/projects');
  await client.getByLabel('Rechercher un projet').fill(editedProjectTitle);
  await client.getByLabel('Filtrer par statut').selectOption('draft');
  const projectLink = client.locator('a:visible').filter({ hasText: editedProjectTitle }).first();
  await expect(projectLink).toBeVisible({ timeout: 15_000 });
  await projectLink.click();
  await expect(client).toHaveURL(new RegExp(`/app/projects/${projectId}$`));

  await client.getByRole('button', { name: /^Lots/ }).click();
  await screenshot(client, testInfo, 'project-lots');
  await screenshot(client, testInfo, 'project-add-lot');
  await client.getByLabel('Métier').selectOption({ index: 1 });
  await client.getByLabel('Intitulé du lot').fill('Lot plomberie E2E');
  await client.getByLabel('Budget indicatif du lot (TND)').fill('25000');
  await client.getByLabel('Périmètre des travaux').fill('Installation plomberie complète');
  await client.getByRole('button', { name: 'Ajouter la demande' }).click();
  await expect(client.getByText('Lot plomberie E2E')).toBeVisible();
  await screenshot(client, testInfo, 'project-lots-filled');
  await client.getByTitle('Modifier').click();
  await client.getByLabel('Intitulé du lot').fill('Lot plomberie E2E version 2');
  await client.getByRole('button', { name: 'Enregistrer les modifications' }).click();
  await expect(client.getByText('v2', { exact: true })).toBeVisible();
  await client.getByTitle('Dupliquer').first().click();
  await client.getByLabel('Intitulé du lot').fill('Lot électricité E2E');
  await client.getByLabel('Budget indicatif du lot (TND)').fill('12000');
  await client.getByLabel('Périmètre des travaux').fill('Réseau électrique et appareillage.');
  await client.getByRole('button', { name: 'Ajouter la demande' }).click();
  await expect(client.getByText('Lot électricité E2E', { exact: true })).toBeVisible();
  const duplicateRow = client.locator('tr').filter({ hasText: 'Lot électricité E2E' });
  client.once('dialog', dialog => dialog.accept());
  await duplicateRow.getByTitle('Retirer').click();
  await expect(client.getByText('Lot électricité E2E', { exact: true })).not.toBeVisible();
  await client.getByRole('button', { name: 'Historique' }).click();
  await screenshot(client, testInfo, 'project-history');
  await client.getByRole('button', { name: /Lot plomberie E2E version 2/ }).click();
  await expect(client.getByText(/v2/)).toBeVisible();
  await client.getByRole('button', { name: 'Documents' }).click();
  await client.locator('input[type="file"]').setInputFiles({ name: 'plan-e2e.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%DAO E2E\n') });
  const documentRow = client.getByTestId('project-document-row').filter({ hasText: 'plan-e2e.pdf' });
  await expect(documentRow).toBeVisible();
  await expect(documentRow).toContainText('En attente de contrôle');
  const [documentPage, documentResponse] = await Promise.all([
    client.waitForEvent('popup'),
    client.waitForResponse(response => response.url().includes('/api/documents/project/download') && response.request().method() === 'POST'),
    documentRow.getByRole('button', { name: 'Consulter' }).click(),
  ]);
  expect(documentResponse.ok()).toBeTruthy();
  await expect(documentPage).toHaveURL(/\/storage\/v1\/object\/sign\/dao-private\//);
  await documentPage.close();
  client.once('dialog', dialog => dialog.accept());
  await documentRow.getByRole('button', { name: 'Retirer' }).click();
  await expect(client.getByText('plan-e2e.pdf', { exact: true })).not.toBeVisible();
  await client.getByLabel('Adresse exacte').fill('12 rue de Sahloul, Sousse');
  await client.getByLabel('Instructions d’accès').fill('Appeler avant l’arrivée.');
  await client.getByLabel('Téléphone privé').fill('+21620123456');
  await client.getByLabel('Email privé').fill('client-e2e@example.invalid');
  await client.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(client.getByRole('status')).toContainText('Coordonnées privées enregistrées.');
  await client.reload();
  await client.getByRole('button', { name: 'Documents' }).click();
  await expect(client.getByLabel('Adresse exacte')).toHaveValue('12 rue de Sahloul, Sousse');
  await expect(client.getByLabel('Instructions d’accès')).toHaveValue('Appeler avant l’arrivée.');
  await expect(client.getByLabel('Téléphone privé')).toHaveValue('+21620123456');
  await expect(client.getByLabel('Email privé')).toHaveValue('client-e2e@example.invalid');
  await screenshot(client, testInfo, 'project-documents');
  await client.getByRole('button', { name: 'DAO' }).click();
  await screenshot(client, testInfo, 'project-dao');
  await client.getByRole('link', { name: 'Revoir le DAO' }).first().click();
  await screenshot(client, testInfo, 'dao-review');
  await client.getByRole('button', { name: 'Soumettre pour revue DAO' }).click();
  await expect(client.getByText('Validation client').first()).toBeVisible();
  await client.close();
  await clientContext.close();

  const reviewerContext = await browser.newContext();
  const reviewer = await reviewerContext.newPage();
  await login(reviewer, reviewerEmail!, reviewerPassword!);
  await reviewer.goto('/app/dao/review');
  const reviewCard = reviewer.locator('section > div').filter({ hasText: editedProjectTitle }).first();
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
  await expect(correctionClient.getByText('Corrections demandées').first()).toBeVisible();
  await expect(correctionClient.getByText('À corriger : précisez le périmètre du lot.')).toBeVisible();
  await screenshot(correctionClient, testInfo, 'corrections-demandees');
  await correctionClient.getByRole('button', { name: 'Corriger le DAO' }).click();
  await expect(correctionClient.getByRole('link', { name: 'Revoir le DAO' }).first()).toBeVisible();
  await correctionClient.getByRole('link', { name: 'Revoir le DAO' }).first().click();
  await correctionClient.getByRole('button', { name: 'Soumettre pour revue DAO' }).click();
  await expect(correctionClient.getByText('Validation client').first()).toBeVisible();
  await correctionContext.close();

  const finalReviewerContext = await browser.newContext();
  const finalReviewer = await finalReviewerContext.newPage();
  await login(finalReviewer, reviewerEmail!, reviewerPassword!);
  await finalReviewer.goto('/app/dao/review');
  const finalReviewCard = finalReviewer.locator('section > div').filter({ hasText: editedProjectTitle }).first();
  await expect(finalReviewCard).toBeVisible();
  await finalReviewCard.getByLabel('Commentaire de revue').fill('Version corrigée conforme.');
  await finalReviewCard.getByRole('button', { name: 'Passer en revue DAO' }).click();
  await expect(finalReviewCard.getByText('dao_review')).toBeVisible();
  await finalReviewCard.getByLabel('Commentaire de revue').fill('Validation finale E2E');
  await finalReviewCard.getByRole('button', { name: 'Approuver' }).click();
  await expect(finalReviewCard).not.toBeVisible();
  await finalReviewer.goto('/app/dao/publications/new?project_id=' + projectId);
  await screenshot(finalReviewer, testInfo, 'publication-review');
  await finalReviewer.getByRole('button', { name: 'Publier le DAO' }).click();
  await expect(finalReviewer).toHaveURL(/\/app\/publications\/[^/]+/);
  const publicationUrl = finalReviewer.url();
  const publicationId = publicationUrl.split('/').pop()!;
  const stateFile = process.env.DAO_E2E_STATE_FILE!;
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  state.publications = [...(state.publications || []), publicationId];
  writeFileSync(stateFile, JSON.stringify(state));
  await expect(finalReviewer.getByText(editedProjectTitle)).toBeVisible();
  await finalReviewerContext.close();

  const artisanContext = await browser.newContext();
  const artisan = await artisanContext.newPage();
  await login(artisan, artisanEmail!, artisanPassword!);
  await artisan.goto('/app/artisan');
  await expect(artisan.getByText(editedProjectTitle)).toBeVisible();
  await artisan.getByRole('link', { name: editedProjectTitle }).click();
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
  await artisan.getByLabel('Prix proposé (TND)').fill('26000');
  await artisan.getByLabel('Délai (jours)').fill('22');
  await artisan.getByLabel('Proposition technique / inclusions').fill('Version révisée avec délai actualisé.');
  await artisan.getByRole('button', { name: 'Soumettre l’offre' }).click();
  await expect(artisan.getByText(/Version 2 soumise/)).toBeVisible();
  await screenshot(artisan, testInfo, 'artisan-offer');
  await artisanContext.close();

  const finalContext = await browser.newContext();
  const final = await finalContext.newPage();
  await login(final, clientEmail!, clientPassword!);
  await final.goto(publicationUrl);
  await expect(final.getByText(editedProjectTitle)).toBeVisible();
  await expect(final.getByText('12 rue de Sahloul, Sousse', { exact: true })).not.toBeVisible();
  await expect(final.getByText('client-e2e@example.invalid', { exact: true })).not.toBeVisible();

  // Archive a separate draft and verify the logical (non-destructive) path in
  // the dashboard/list. The main published fixture remains available for the
  // artisan assertions above.
  const archivedTitle = `DAO E2E archive ${testInfo.project.name}`;
  await final.goto('/app/projects/new');
  await final.getByLabel('Titre du projet').fill(archivedTitle);
  await final.getByLabel('Description').fill('Projet temporaire pour vérifier l’archivage logique.');
  await final.getByRole('button', { name: 'Continuer' }).click();
  await final.getByLabel('Gouvernorat').selectOption({ index: 1 });
  await final.getByLabel('Délégation').selectOption({ index: 1 });
  await final.getByLabel('Localité').selectOption({ index: 1 });
  await final.getByRole('button', { name: 'Continuer' }).click();
  await final.getByRole('button', { name: 'Continuer' }).click();
  await final.getByRole('button', { name: 'Créer le projet et ajouter les demandes' }).click();
  const archivedProjectId = final.url().split('/').pop()!;
  rememberProject(archivedProjectId);
  final.once('dialog', dialog => dialog.accept());
  await final.getByRole('button', { name: 'Abandonner le projet' }).click();
  await expect(final.getByRole('status')).toContainText('Projet archivé.');
  await final.reload();
  await expect(final.getByText('Archivé', { exact: true }).first()).toBeVisible();
  await final.goto('/app/projects');
  await final.getByLabel('Rechercher un projet').fill(archivedTitle);
  await final.getByLabel('Filtrer par statut').selectOption('archived');
  await expect(final.locator('a:visible').filter({ hasText: archivedTitle }).first()).toBeVisible();
  await finalContext.close();
});
