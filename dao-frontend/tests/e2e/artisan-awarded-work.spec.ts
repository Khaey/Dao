import { test, expect } from './support/fixtures';
import { createProjectWithMainLot, login } from './support/flow';
import { adminRows } from './support/collaboration';
import { recordE2EValue } from './support/state';

// #356 P0 (owner report): after a real award — and WITHOUT any team membership — the awarded Artisan finds the
// chantier in their dashboard and « Mes chantiers », and the winning offer leaves « En cours » for the results.
// A cancelled award immediately leaves the active space while the history stays readable.
test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 });

test('Artisan #356 : chantier attribué visible sans appartenance, offre classée dans les résultats, annulation', async ({ page, browser, e2eClient, e2eReviewer, e2eArtisan }, info) => {
  test.skip(!e2eClient || !e2eReviewer || !e2eArtisan, 'E2E Supabase credentials are not available');
  test.setTimeout(240_000);
  const viewport = info.project.name === 'mobile' ? { width: 375, height: 812 } : { width: 1440, height: 900 };
  const lotTitle = `Lot attribué Artisan ${info.project.name}`;
  await login(page, e2eClient!);
  const project = await createProjectWithMainLot(page, info, 'artisan-awarded', 'Carrelage de la salle d’eau.', lotTitle);
  await page.goto(`/app/projects/${project.projectId}/review`);
  await page.getByRole('button', { name: 'Soumettre pour revue DAO' }).click();

  const rc = await browser.newContext(), reviewer = await rc.newPage();
  await login(reviewer, e2eReviewer!); await reviewer.goto('/app/dao/review');
  const card = reviewer.getByRole('heading', { name: project.title, exact: true }).locator('xpath=../../..');
  await card.getByRole('button', { name: 'Passer en revue DAO' }).click();
  await expect(card.getByText('Revue DAO', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Approuver' }).click();
  await expect(reviewer.getByRole('heading', { name: project.title, exact: true })).toHaveCount(0);
  await reviewer.goto(`/app/dao/publications/new?project_id=${project.projectId}`);
  await expect(reviewer.getByRole('button', { name: 'Publier le DAO' })).toBeEnabled();
  await reviewer.getByRole('button', { name: 'Publier le DAO' }).click();
  await expect(reviewer).toHaveURL(/\/app\/publications\/[^/]+/);
  const publicationId = reviewer.url().split('/').pop()!;
  recordE2EValue(info, 'publications', publicationId); await rc.close();

  const ac = await browser.newContext({ viewport }), artisan = await ac.newPage();
  await login(artisan, e2eArtisan!); await artisan.goto(`/app/artisan/publications/${publicationId}`);
  const line = artisan.locator('div.rounded-xl').filter({ has: artisan.getByRole('heading', { name: lotTitle, exact: true }) }).filter({ has: artisan.getByLabel('Prix proposé (TND)') });
  await line.getByLabel('Prix proposé (TND)').fill('2600');
  await line.getByLabel('Délai (jours)').fill('8');
  await line.getByLabel('Proposition technique / inclusions').fill('Pose et joints');
  await artisan.getByRole('button', { name: 'Soumettre l’offre' }).click();
  await expect(artisan.getByRole('heading', { name: 'Offre envoyée' })).toBeVisible();
  // Open lot: still listed among « DAO disponibles ».
  await artisan.goto('/app/artisan');
  await expect(artisan.locator(`a[href="/app/artisan/publications/${publicationId}"]`)).toHaveCount(1);
  // Before the decision the offer is « en cours » and « Soumise ».
  await artisan.goto('/app/artisan/offers');
  await artisan.getByRole('button', { name: /^En cours/ }).click();
  const pendingCard = artisan.getByRole('heading', { name: project.title, exact: true }).locator('xpath=../..');
  await expect(pendingCard.getByText('Soumise', { exact: true })).toBeVisible();

  await page.goto(`/app/publications/${publicationId}`);
  const comparison = page.getByRole('heading', { name: 'Comparer et attribuer les offres' }).locator('..');
  const lot = comparison.getByRole('heading', { name: lotTitle, exact: true }).locator('xpath=../..');
  await lot.getByRole('button', { name: 'Attribuer cette offre' }).click();
  await lot.getByRole('button', { name: 'Confirmer l’attribution' }).click();
  await expect(comparison.getByText('Lot attribué', { exact: true })).toBeVisible();
  expect(await adminRows('project_members', `project_id=eq.${project.projectId}&user_id=eq.${e2eArtisan!.id}&select=id`)).toHaveLength(0);

  // 1/1 lot awarded: the DAO leaves « DAO disponibles » (no « Fermé » card in the catalogue).
  await artisan.goto('/app/artisan');
  await expect(artisan.getByRole('heading', { name: 'DAO disponibles' })).toBeVisible();
  await expect(artisan.locator(`a[href="/app/artisan/publications/${publicationId}"]`)).toHaveCount(0);
  // Dashboard and « Mes chantiers »: the awarded chantier is found without being a team member.
  await artisan.goto('/app');
  const dashboard = artisan.getByRole('region', { name: 'Mes chantiers attribués' });
  await expect(dashboard).toContainText(lotTitle);
  await expect(dashboard).toContainText('Conditions à convenir');
  // « Mes chantiers »: ONE table; the awarded chantier is a regular row (owner decision), never a link to the
  // private project page for an Artisan without team membership.
  await artisan.goto('/app/projects');
  await expect(artisan.getByRole('region', { name: 'Mes chantiers attribués' })).toHaveCount(0);
  const row = artisan.locator(`[data-testid="project-row-${project.projectId}"]:visible`);
  await expect(row).toContainText(`Lot retenu : ${lotTitle}`);
  await expect(row).toContainText('Lot attribué');
  await expect(row).toContainText('Montant attribué');
  await expect(row.locator(`a[href="/app/projects/${project.projectId}"]`)).toHaveCount(0);
  await artisan.getByRole('combobox', { name: 'Filtrer par mes offres' }).selectOption('won');
  await expect(row).toBeVisible();
  await artisan.getByRole('combobox', { name: 'Filtrer par mes offres' }).selectOption('lost');
  await expect(row).toHaveCount(0);
  await artisan.getByRole('button', { name: 'Effacer les filtres' }).first().click();
  await artisan.getByRole('combobox', { name: 'Filtrer par statut' }).selectOption('awarded');
  await expect(row).toBeVisible();
  // « ⋯ » lists only real destinations (DAO), keyboard-closable.
  await row.getByRole('button', { name: /^Autres actions/ }).click();
  await expect(artisan.getByRole('link', { name: 'Voir le DAO' })).toBeVisible();
  await artisan.keyboard.press('Escape');
  await expect(artisan.getByRole('link', { name: 'Voir le DAO' })).toHaveCount(0);
  expect(await artisan.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await row.getByRole('link', { name: /^Conditions — / }).click();
  await expect(artisan).toHaveURL(/\/app\/awards\/[^/]+\/conditions$/);
  await expect(artisan.getByRole('heading', { name: 'Conditions et calendrier' })).toBeVisible();

  // Offers: the winning version leaves « En cours » and is listed in the results as « Retenue ».
  await artisan.goto('/app/artisan/offers');
  await artisan.getByRole('button', { name: /^En cours/ }).click();
  await expect(artisan.getByRole('heading', { name: project.title, exact: true })).toHaveCount(0);
  await artisan.getByRole('button', { name: /^Résultats et historique/ }).click();
  const wonCard = artisan.getByRole('heading', { name: project.title, exact: true }).locator('xpath=../..');
  await expect(wonCard.getByText('Retenue', { exact: true })).toBeVisible();
  await expect(wonCard.getByText('1 lot attribué', { exact: true })).toBeVisible();
  await expect(wonCard.getByText('Soumise', { exact: true })).toHaveCount(0);

  // Cancellation by the Client: out of the active space at once, history kept and labelled.
  await lot.getByRole('button', { name: 'Annuler l’attribution', exact: true }).click();
  const cancellation = comparison.getByRole('group', { name: 'Annulation de l’attribution' });
  await cancellation.getByLabel('Motif d’annulation').selectOption('financing');
  await cancellation.getByRole('button', { name: 'Confirmer l’annulation' }).click();
  await expect(comparison.getByText('Lot attribué', { exact: true })).toHaveCount(0);
  await artisan.goto('/app/projects');
  await expect(artisan.locator(`[data-testid="project-row-${project.projectId}"]:visible`)).toHaveCount(0);
  await artisan.goto('/app/artisan/offers');
  // The lot is open again: the offer is back « en cours », labelled with the cancelled award.
  await artisan.getByRole('button', { name: /^En cours/ }).click();
  const cancelledCard = artisan.getByRole('heading', { name: project.title, exact: true }).locator('xpath=../..');
  await expect(cancelledCard.getByText('Attribution annulée', { exact: true })).toBeVisible();
  await expect(cancelledCard.getByText(/lot attribué/)).toHaveCount(0);
  await ac.close();
});
