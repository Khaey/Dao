import { test, expect } from './support/fixtures';
import { createProjectWithMainLot, login } from './support/flow';
import { recordE2EValue } from './support/state';

// #346 P0 (owner report): from their own chantier, a regular Client finds the offers, chooses one per lot, sees
// that the lot is attributed (not only « Publié ») and reaches « Conditions et calendrier ». No Admin, no URL typed.
test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 });

test('Client #346 : depuis son chantier, voir les offres, choisir l’Artisan et voir le lot attribué', async ({ page, browser, e2eClient, e2eOtherClient, e2eReviewer, e2eArtisan }, info) => {
  test.skip(!e2eClient || !e2eOtherClient || !e2eReviewer || !e2eArtisan, 'E2E Supabase credentials are not available');
  test.setTimeout(240_000);
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
  await page.locator(`a[href="/app/projects/${project.projectId}"]`).first().click();
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

  // Another Client never reaches this chantier nor its offers.
  const oc = await browser.newContext(), other = await oc.newPage();
  await login(other, e2eOtherClient!);
  await other.goto(`/app/projects/${project.projectId}`);
  await expect(other.getByText('Chantier indisponible')).toBeVisible();
  await expect(other.getByRole('region', { name: 'Offres et attribution' })).toHaveCount(0);
  await oc.close();
});
