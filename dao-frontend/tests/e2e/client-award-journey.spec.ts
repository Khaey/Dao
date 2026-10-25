import { test, expect } from './support/fixtures';
import { createProjectWithMainLot, login } from './support/flow';
import { recordE2EValue } from './support/state';
import { groupAwardedLotsByContractor } from '../../lib/contractor-lot-dossiers';

// #346 P0 (owner report): from their own chantier, a regular Client finds the offers, chooses one per lot, sees
// that the lot is attributed (not only « Publié ») and reaches « Conditions et calendrier ». No Admin, no URL typed.
test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 });

test('Client #346 : depuis son chantier, voir les offres, choisir l’Artisan et voir le lot attribué', async ({ page, browser, e2eClient, e2eOtherClient, e2eReviewer, e2eArtisan }, info) => {
  test.skip(!e2eClient || !e2eOtherClient || !e2eReviewer || !e2eArtisan, 'E2E Supabase credentials are not available');
  test.setTimeout(240_000);
  // #381: contract-preparation grouping cannot combine unrelated contractors or chantiers.
  const dossiers = groupAwardedLotsByContractor('p1', [
    { projectId: 'p1', requestId: 'lot-a', awardId: 'award-a', contractorId: 'artisan-a', agreedMillimes: 8000000 },
    { projectId: 'p1', requestId: 'lot-b', awardId: 'award-b', contractorId: 'artisan-a', agreedMillimes: 2100500 },
    { projectId: 'p1', requestId: 'lot-c', awardId: 'award-c', contractorId: 'artisan-b', agreedMillimes: 3000000 },
  ]);
  expect(dossiers.map(d => [d.contractorId, d.lotIds.length, d.totalMillimes])).toEqual([
    ['artisan-a', 2, 10100500],
    ['artisan-b', 1, 3000000],
  ]);
  expect(() => groupAwardedLotsByContractor('p1', [
    { projectId: 'p1', requestId: 'lot-a', awardId: 'a', contractorId: 'artisan-a', agreedMillimes: 1000 },
    { projectId: 'p1', requestId: 'lot-a', awardId: 'b', contractorId: 'artisan-b', agreedMillimes: 1000 },
  ])).toThrow(/Multiple active awards/);
  expect(() => groupAwardedLotsByContractor('p1', [
    { projectId: 'p2', requestId: 'lot-d', awardId: 'd', contractorId: 'artisan-a', agreedMillimes: 1000 },
  ])).toThrow(/Cross-project/);
  expect(groupAwardedLotsByContractor('p1', [
    { projectId: 'p1', requestId: 'lot-a', awardId: 'award-a', contractorId: 'artisan-a', agreedMillimes: 1000 },
    { projectId: 'p1', requestId: 'lot-b', awardId: 'award-a', contractorId: 'artisan-a', agreedMillimes: 2500 },
  ])[0]).toEqual({ projectId: 'p1', contractorId: 'artisan-a', lotIds: ['lot-a', 'lot-b'], awardIds: ['award-a'], totalMillimes: 3500 });
  expect(() => groupAwardedLotsByContractor('p1', [
    { projectId: 'p1', requestId: 'lot-a', awardId: 'award-a', contractorId: 'artisan-a', agreedMillimes: Number.MAX_SAFE_INTEGER },
    { projectId: 'p1', requestId: 'lot-b', awardId: 'award-b', contractorId: 'artisan-a', agreedMillimes: 1 },
  ])).toThrow(/precision/);
  await page.setViewportSize(info.project.name === 'mobile' ? { width: 375, height: 812 } : { width: 1440, height: 900 });
  const lotTitle = `Lot parcours Client ${info.project.name}`;
  await login(page, e2eClient!);
  const project = await createProjectWithMainLot(page, info, 'client-award', 'Peinture des pièces de vie.', lotTitle);
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

  // Published, no offer yet: honest waiting state, no misleading action.
  await page.goto(`/app/projects/${project.projectId}`);
  const commercial = page.getByRole('region', { name: 'Offres et attribution' });
  await expect(commercial).toContainText('En attente d’offres');
  await expect(commercial.getByRole('link', { name: /Comparer et choisir/ })).toHaveCount(0);
  await expect(page.getByText('Publié', { exact: true }).first()).toBeVisible();

  const ac = await browser.newContext(), artisan = await ac.newPage();
  await login(artisan, e2eArtisan!); await artisan.goto(`/app/artisan/publications/${publicationId}`);
  const line = artisan.locator('div.rounded-xl').filter({ has: artisan.getByRole('heading', { name: lotTitle, exact: true }) }).filter({ has: artisan.getByLabel('Prix proposé (TND)') });
  await line.getByLabel('Prix proposé (TND)').fill('2100');
  await line.getByLabel('Délai (jours)').fill('6');
  await line.getByLabel('Proposition technique / inclusions').fill('Deux couches, finitions mates');
  await artisan.getByRole('button', { name: 'Soumettre l’offre' }).click();
  await expect(artisan.getByRole('heading', { name: 'Offre envoyée' })).toBeVisible();
  await ac.close();

  // Client journey from the dashboard, without typing a publication URL.
  await page.goto('/app');
  // #477: a published chantier is never shown as an empty space; one « Nouveau chantier »; the real next action.
  await expect(page.getByText('Votre espace est prêt')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Nouveau chantier' })).toHaveCount(1);
  const todo = page.getByRole('region', { name: 'À faire maintenant' });
  const more = todo.getByRole('button', { name: /^Afficher les \d+ autres$/ });
  if (await more.count()) await more.click();
  const action = todo.getByRole('listitem').filter({ hasText: project.title });
  await expect(action.getByRole('heading', { name: '1 offre reçue à comparer' })).toBeVisible();
  await expect(action.getByRole('link', { name: /Comparer les offres/ })).toHaveAttribute('href', `/app/publications/${publicationId}#offres`);
  await expect(page.getByTestId('dashboard-stat-published')).toContainText(/[1-9]/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await page.locator(`a[href="/app/projects/${project.projectId}"]`).first().click();
  await expect(page).toHaveURL(new RegExp(`/app/projects/${project.projectId}$`));
  await expect(page.getByText('Offres à comparer', { exact: true })).toBeVisible();
  await expect(commercial).toContainText('1 lot avec des offres reçues');
  await commercial.getByRole('link', { name: /Comparer et choisir une offre/ }).click();
  await expect(page).toHaveURL(new RegExp(`/app/publications/${publicationId}#offres$`));
  const comparison = page.getByRole('heading', { name: 'Comparer et attribuer les offres' }).locator('..');
  await expect(comparison).toContainText('Ce n’est ni une signature ni un contrat');
  const lot = comparison.getByRole('heading', { name: lotTitle, exact: true }).locator('xpath=../..');
  await lot.getByRole('button', { name: 'Attribuer cette offre' }).click();
  await lot.getByRole('button', { name: 'Confirmer l’attribution' }).click();
  await expect(comparison.getByText('Lot attribué', { exact: true })).toBeVisible();

  // Back on the chantier: the commercial result comes first, the publication status is secondary.
  await page.goto(`/app/projects/${project.projectId}`);
  await expect(page.getByText('Artisan choisi', { exact: true })).toBeVisible();
  await expect(page.getByText('Publication en ligne', { exact: true })).toBeVisible();
  await expect(commercial).toContainText('1 lot sur 1 attribué');
  await expect(commercial.getByRole('list', { name: 'Étapes après publication' })).toContainText('Offre choisie');
  await expect(commercial.getByRole('link', { name: /Comparer et choisir/ })).toHaveCount(0);
  await expect(commercial.getByRole('link', { name: 'Voir les offres et l’attribution' })).toBeVisible();
  // #360: post-publication journey from proven data only — nothing signed, works not started.
  const steps = commercial.getByRole('list', { name: 'Étapes après publication' });
  await expect(steps.getByRole('listitem').filter({ hasText: 'Contrat' })).toContainText('Non signé');
  await expect(steps.getByRole('listitem').filter({ hasText: 'Travaux' })).toContainText('Pas commencés');
  await expect(steps.getByRole('listitem').filter({ hasText: 'Clôture' })).toContainText('Non clôturé');
  // Lots tab: the commercially awarded Artisan (from the active award) is shown, distinct from the optional team member.
  await page.getByRole('button', { name: /^Lots/ }).click();
  const lotRow = page.getByRole('row').filter({ hasText: lotTitle });
  await expect(lotRow.getByText('Artisan retenu', { exact: true })).toBeVisible();
  await expect(lotRow.getByText('Attribué', { exact: true })).toBeVisible();
  await expect(lotRow.getByText('Statut à préciser')).toHaveCount(0);
  await expect(lotRow.getByRole('link', { name: 'Voir l’offre retenue' })).toHaveAttribute('href', `/app/publications/${publicationId}#offres`);
  await expect(lotRow.getByRole('link', { name: 'Trouver un professionnel' })).toHaveCount(0);
  await expect(lotRow.getByText('Participant de l’équipe affecté au lot (optionnel)')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  // A failed read is explained with a retry, never shown as « en attente d’offres ».
  let mockedAwardReads = 0;
  await page.route('**/rest/v1/award_items*', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    mockedAwardReads += 1;
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"unavailable"}' });
  });
  await page.reload();
  await expect.poll(() => mockedAwardReads, { message: 'Le GET award_items doit être intercepté après rechargement' }).toBeGreaterThan(0);
  await expect(commercial.getByRole('alert')).toContainText('n’ont pas pu être chargées', { timeout: 20_000 });
  await expect(commercial).not.toContainText('En attente d’offres');
  await page.unroute('**/rest/v1/award_items*');
  await commercial.getByRole('button', { name: 'Réessayer' }).click();
  await expect(commercial).toContainText('1 lot sur 1 attribué');
  await commercial.getByRole('link', { name: 'Définir les conditions avec l’Artisan' }).click();
  await expect(page).toHaveURL(/\/app\/awards\/[^/]+\/conditions$/);
  await expect(page.getByRole('heading', { name: 'Conditions et calendrier' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  // « Mes chantiers »: the same row reflects the award and can be filtered by offers / status (#356).
  await page.goto('/app/projects');
  const row = page.locator(`[data-testid="project-row-${project.projectId}"]:visible`);
  await expect(row).toContainText('Artisan choisi');
  await page.getByRole('combobox', { name: 'Filtrer par offres' }).selectOption('awarded');
  await expect(row).toBeVisible();
  await page.getByRole('combobox', { name: 'Filtrer par offres' }).selectOption('none');
  await expect(row).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Filtrer par offres' }).selectOption('');
  await page.getByRole('combobox', { name: 'Filtrer par statut' }).selectOption('awarded');
  await expect(row).toBeVisible();

  // A click on the overflow menu must not navigate the chantier row.
  await expect(row.getByRole('link', { name: /^(Ouvrir|Suivre les travaux) — / })).toHaveCount(0);
  const rowMenu = row.getByRole('button', { name: 'Autres actions — ' + project.title });
  await rowMenu.click();
  await expect(page).toHaveURL(new RegExp('/app/projects$'));
  await expect(page.getByRole('link', { name: 'Ouvrir le chantier' })).toBeVisible();
  await page.keyboard.press('Escape');
  // Enter on the focused row opens the same authorised chantier as a mouse click.
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp('/app/projects/' + project.projectId + '$'));
  // Another Client never reaches this chantier nor its offers.
  const oc = await browser.newContext(), other = await oc.newPage();
  await login(other, e2eOtherClient!);
  await other.goto(`/app/projects/${project.projectId}`);
  await expect(other.getByText('Chantier indisponible')).toBeVisible();
  await expect(other.getByRole('region', { name: 'Offres et attribution' })).toHaveCount(0);
  await oc.close();
});
