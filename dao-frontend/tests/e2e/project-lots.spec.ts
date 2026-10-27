import { test, expect } from './support/fixtures';
import { createProjectWithMainLot, dateOffset, login } from './support/flow';
import { actorCommand } from './support/collaboration';

test('Lots : version, duplication, retrait et historique', async ({ page, e2eClient }, testInfo) => {
  test.skip(!e2eClient, 'E2E Supabase credentials are not available');

  await login(page, e2eClient!);
  const project = await createProjectWithMainLot(page, testInfo, 'lots', 'Réseau de plomberie principal.');

  const originalRow = page.locator('tr').filter({ hasText: project.lotTitle });
  await expect(originalRow).toHaveCount(1);
  for (const [title, label] of [['Modifier', 'Modifier le lot'], ['Dupliquer', 'Dupliquer le lot'], ['Retirer', 'Retirer le lot']]) {
    const action = originalRow.getByTitle(title);
    await expect(action).toHaveAttribute('aria-label', label);
    const bounds = await action.boundingBox();
    expect(bounds, `${label} doit être un bouton compact`).not.toBeNull();
    expect(bounds!.height).toBeLessThanOrEqual(48);
    expect(bounds!.width).toBeLessThanOrEqual(48);
  }
  await originalRow.getByTitle('Modifier').click();
  await page.getByLabel('Intitulé du lot').fill('Lot plomberie E2E version 2');
  await page.getByRole('button', { name: 'Enregistrer les modifications' }).click();
  await expect(page.getByText('v2', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Ajouter un lot', exact: true }).click();
  await expect(page.getByLabel('Métier')).toHaveValue('');
  await expect(page.getByLabel('Intitulé du lot')).toHaveValue('');
  await expect(page.getByLabel('Budget indicatif du lot (TND)')).toHaveValue('');
  await expect(page.getByLabel('Périmètre des travaux')).toHaveValue('');
  await page.reload();
  // A reload restores the default tab, so re-open Lots before asserting the preserved row.
  await page.getByRole('button', { name: /^Lots/ }).click();

  const versionTwoRow = page.locator('tr').filter({ hasText: 'Lot plomberie E2E version 2' });
  await expect(versionTwoRow).toHaveCount(1);
  await versionTwoRow.getByTitle('Dupliquer').click();
  await page.getByLabel('Métier').selectOption({ label: 'Électricité' });
  // #465 : référentiel élargi et proposition contrôlée d'un métier absent, sans création publique.
  await expect(page.getByLabel('Métier').getByRole('option', { name: 'Carrelage et faïence' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Métier absent de la liste ? Proposer un métier' }).first().click();
  await page.getByLabel('Métier à proposer').fill('Carrelage et faience');
  await page.getByRole('button', { name: 'Envoyer la proposition' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'existe déjà' })).toContainText('Carrelage et faïence');
  await page.getByLabel('Métier à proposer').fill(`Pisciniste E2E ${test.info().project.name}`);
  await page.getByRole('button', { name: 'Envoyer la proposition' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Proposition envoyée' })).toBeVisible();
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

test('Client : recherche depuis un lot conserve le chantier, sans déclencher la revue DAO', async ({ page, e2eClient }, testInfo) => {
  test.skip(!e2eClient, 'E2E Supabase credentials are not available');
  await login(page, e2eClient!);
  const project = await createProjectWithMainLot(page, testInfo, 'directory-lot', 'Lot pour recherche ciblée.');
  await page.getByRole('button', { name: 'Lots', exact: false }).click();
  const row = page.locator('tr').filter({ hasText: project.lotTitle });
  const link = row.getByRole('link', { name: 'Trouver un professionnel' });
  const href = await link.getAttribute('href');
  expect(href).toContain('/app/professionals?project_id=');
  expect(href).toContain('&request_id=');
  expect(href).not.toContain('/review');
  await link.click();
  await expect(page.getByRole('heading', { name: 'Professionnels vérifiés' })).toBeVisible();
  await expect(page.getByText('Sélectionnez une fiche pour ce lot.')).toBeVisible();
  // A deterministic empty directory verifies the public wording, not the live fixture's moderation state.
  await page.route('**/api/professionals?*', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('view') === 'directory') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
    } else await route.continue();
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Aucun professionnel disponible pour le moment' })).toBeVisible();
  await expect(page.getByText('Aucun professionnel actuellement publiable')).toHaveCount(0);
  await page.getByLabel('Rechercher par nom ou ville').fill('Introuvable');
  await expect(page.getByRole('heading', { name: 'Aucun résultat pour votre recherche' })).toBeVisible();
});

test('Client : vue d’ensemble distingue statut DAO, travaux et accès privé', async ({ page, e2eClient }, testInfo) => {
  test.skip(!e2eClient, 'E2E Supabase credentials are not available');
  await login(page, e2eClient!);
  await createProjectWithMainLot(page, testInfo, 'stages', 'Travaux à préparer.');
  await page.getByRole('button', { name: 'Vue d’ensemble' }).click();
  await expect(page.getByText('Dossier DAO', { exact: true })).toBeVisible();
  await expect(page.getByText('Avancement des travaux', { exact: true })).toBeVisible();
  const privateDetails = page.locator('details').filter({ hasText: 'Coordonnées privées / Accès chantier' });
  await expect(privateDetails).not.toHaveAttribute('open', '');
  await privateDetails.locator('summary').click();
  await expect(privateDetails.getByLabel('Adresse exacte')).toBeVisible();

  // Regression #175: empty desired dates cannot produce a reviewable DAO.
  const projectId = new URL(page.url()).pathname.split('/').pop()!;
  await page.getByRole('button', { name: 'Modifier le projet' }).click();
  await page.getByLabel('Début souhaité du projet').fill('');
  await page.getByLabel('Fin souhaitée du projet').fill('');
  await page.locator('form').filter({ has: page.getByLabel('Titre du projet') }).getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Projet mis à jour.');
  await page.getByRole('button', { name: 'DAO', exact: true }).click();
  await expect(page.getByText('Dates souhaitées', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Revoir le DAO' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Compléter les dates' }).first()).toBeVisible();
  const denied = await actorCommand(page, e2eClient!, '/api/projects/review', { project_id: projectId });
  expect(denied.ok(), 'The server must refuse a direct submission without dates').toBeFalsy();
  await page.goto(`/app/projects/${projectId}/review`);
  await expect(page.getByRole('heading', { name: 'Dates souhaitées à compléter avant la soumission.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Soumettre pour revue DAO' })).toBeDisabled();
  await page.getByRole('button', { name: 'Renseigner les dates' }).click();
  await expect(page.getByLabel('Début souhaité du projet')).toBeVisible();
  await page.getByLabel('Début souhaité du projet').fill(dateOffset(30));
  await page.getByLabel('Fin souhaitée du projet').fill(dateOffset(60));
  await page.locator('form').filter({ has: page.getByLabel('Titre du projet') }).getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Projet mis à jour.');
  await page.getByRole('button', { name: 'DAO', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Revoir le DAO' }).first()).toBeVisible();
  await page.getByRole('link', { name: 'Revoir le DAO' }).first().click();
  await expect(page.getByRole('button', { name: 'Soumettre pour revue DAO' })).toBeEnabled();
});
