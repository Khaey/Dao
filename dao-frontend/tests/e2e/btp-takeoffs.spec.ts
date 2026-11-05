import { test, expect } from './support/fixtures';
import { createDraftProject, createMainLot, login } from './support/flow';

// #560 — Parcours métrés complet sur la pile Supabase jetable : chantier → ouvrage du référentiel
// → dimensions réelles avec provenance → données insuffisantes → calcul justifié → soumission sans
// auto-validation → validation par l'administration → budget honnête → révision et comparaison.
test('Métrés #560 : dimensions réelles, calcul justifié, validation sans auto-validation et budget honnête', async ({ page, browser, e2eClient, e2eAdmin, e2eArtisan }, info) => {
  test.skip(!e2eClient || !e2eAdmin || !e2eArtisan, 'E2E Supabase credentials are not available');
  test.setTimeout(240_000);
  const viewport = info.project.name === 'mobile' ? { width: 375, height: 812 } : { width: 1440, height: 900 };
  await login(page, e2eClient!);
  const project = await createDraftProject(page, info, 'metres');

  // Entrée unique depuis la fiche chantier : sans ouvrage, les métrés renvoient vers les lots (#577).
  await page.getByRole('link', { name: 'Saisir les métrés' }).click();
  await expect(page).toHaveURL(`/app/projects/${project.projectId}/metres`);
  await expect(page.getByRole('heading', { name: 'Métrés', level: 1 })).toBeVisible();
  await expect(page.getByTestId('validation-policy')).toContainText('Aucun gestionnaire n’est affecté');
  await expect(page.getByText('Aucun ouvrage pour l’instant')).toBeVisible();
  await page.getByRole('link', { name: 'Ajouter des ouvrages' }).click();
  await expect(page).toHaveURL(new RegExp(`/app/projects/${project.projectId}\\?tab=lots$`));
  await createMainLot(page, project.title, 'Terrasse et abords');

  // #577 — l'ouvrage est choisi dans le lot (sans dimension), puis « Dimensions » ouvre son métré.
  const lot = page.locator('tr').filter({ hasText: project.title });
  await lot.getByRole('button', { name: /Ajouter des ouvrages au lot/ }).click();
  await lot.getByLabel('Rechercher un ouvrage').fill('terrasse');
  await lot.getByRole('checkbox', { name: /Terrasse extérieure/ }).check();
  await lot.getByRole('button', { name: /Ajouter 1 ouvrage/ }).click();
  await expect(lot.getByTestId('work-item').filter({ hasText: 'Terrasse extérieure' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /^Lots/ }).click();
  await expect(page.locator('tr').filter({ hasText: project.title }).getByTestId('work-item').filter({ hasText: 'Terrasse extérieure' })).toBeVisible();
  await page.locator('tr').filter({ hasText: project.title }).getByRole('link', { name: /Renseigner les dimensions : Terrasse extérieure/ }).click();
  await expect(page).toHaveURL(new RegExp(`/app/projects/${project.projectId}/metres\\?item=`));
  const editor = page.getByTestId('takeoff-editor');
  await expect(editor.getByText(/formule : Longueur × largeur/)).toBeVisible();
  await editor.getByLabel('Nom du métré').fill('Terrasse sud');
  await editor.getByLabel('Longueur — valeur', { exact: true }).fill('1000');
  await editor.getByLabel('Longueur — unité', { exact: true }).selectOption('cm');
  await editor.getByLabel('Longueur — provenance', { exact: true }).selectOption('document');
  await editor.getByLabel('Longueur — référence', { exact: true }).fill('Plan A-12');
  // Saisie commencée mais incomplète : erreur ciblée, rien n'est complété à la place du client.
  await editor.getByLabel('Largeur — valeur', { exact: true }).fill('6');
  await editor.getByRole('button', { name: 'Calculer et enregistrer' }).click();
  await expect(editor.getByRole('alert')).toContainText('provenance');
  // Dimension inconnue laissée vide : révision « données insuffisantes », aucune quantité.
  await editor.getByLabel('Largeur — valeur', { exact: true }).fill('');
  await editor.getByRole('button', { name: 'Calculer et enregistrer' }).click();
  const detail = page.getByTestId('takeoff-detail');
  await expect(detail.getByTestId('takeoff-insufficient')).toContainText('Renseignez « Largeur »');
  await expect(detail.getByRole('button', { name: 'Soumettre pour validation' })).toHaveCount(0);

  await detail.getByRole('button', { name: 'Compléter les dimensions' }).click();
  await expect(editor.getByLabel('Longueur — valeur', { exact: true })).toHaveValue('1000');
  await editor.getByLabel('Largeur — valeur', { exact: true }).fill('6');
  await editor.getByLabel('Largeur — provenance', { exact: true }).selectOption('manual');
  await editor.getByLabel('Largeur — référence', { exact: true }).fill('Mesuré sur site');
  await editor.getByRole('button', { name: 'Calculer et enregistrer' }).click();
  await expect(detail.getByTestId('takeoff-result')).toHaveText(/^60(,0+)? m²$/);
  await expect(detail.getByRole('cell', { name: '1000 cm' })).toBeVisible();
  await expect(detail.getByRole('cell', { name: '10 m' })).toBeVisible();
  await expect(detail.getByText('Plan ou document — Plan A-12')).toBeVisible();

  // Soumission : le client ne peut pas valider son propre métré.
  await detail.getByRole('button', { name: 'Soumettre pour validation' }).click();
  await expect(detail.getByText('En attente de validation technique').first()).toBeVisible();
  await expect(detail.getByRole('button', { name: /Valider la révision/ })).toHaveCount(0);
  await expect(page.getByTestId('takeoff-budget')).toContainText('pas encore validé');
  await expect(page.locator('main')).not.toContainText(/\bTND\b/);

  // Un Artisan n'a aucun accès aux métrés ni au budget.
  const ac = await browser.newContext({ viewport }), artisan = await ac.newPage();
  await login(artisan, e2eArtisan!);
  await artisan.goto(`/app/projects/${project.projectId}/metres`);
  await expect(artisan.getByText('Accès réservé')).toBeVisible();
  await ac.close();

  // Validation par l'administration D.A.O. (droits réels de la base), sans Gestionnaire affecté.
  const xc = await browser.newContext({ viewport }), admin = await xc.newPage();
  await login(admin, e2eAdmin!);
  await admin.goto(`/app/projects/${project.projectId}/metres`);
  await admin.getByRole('button', { name: /Terrasse sud/ }).click();
  await admin.getByLabel('Note').fill('Dimensions contrôlées');
  await admin.getByRole('button', { name: 'Valider la révision 2' }).click();
  await expect(admin.getByTestId('takeoff-detail').getByText('Validé', { exact: true }).first()).toBeVisible();
  await xc.close();

  // Budget : le métré validé est lu, aucun tarif vérifié → indisponible et cause par ligne.
  await page.reload();
  await page.getByRole('button', { name: /Terrasse sud/ }).click();
  await expect(detail.getByText('Révision validée de référence : 2')).toBeVisible();
  const budget = page.getByTestId('takeoff-budget');
  await expect(budget).toContainText('métré validé (révision 2)');
  await expect(budget).toContainText('Aucun tarif sourcé et vérifié');
  await expect(budget.getByText('Budget indisponible')).toBeVisible();

  // Correction après validation : nouvelle révision en brouillon, la validée reste la référence.
  await detail.getByRole('button', { name: 'Corriger les dimensions' }).click();
  await editor.getByLabel('Largeur — valeur', { exact: true }).fill('5,5');
  await editor.getByRole('button', { name: 'Calculer et enregistrer' }).click();
  await expect(detail.getByTestId('takeoff-result')).toHaveText(/^55(,0+)? m²$/);
  await expect(detail.getByText('Comparaison avec la révision validée 2')).toBeVisible();
  await expect(detail.getByText(/la révision 2 \(60(,0+)? m²\) reste la référence/)).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
