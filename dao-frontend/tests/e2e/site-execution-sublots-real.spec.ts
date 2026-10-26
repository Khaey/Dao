import { randomUUID } from 'node:crypto';
import { test, expect } from './support/fixtures';
import { createProjectWithMainLot, login } from './support/flow';
import { actorCommand, adminRows } from './support/collaboration';
import { recordE2EValue } from './support/state';

// #346 B2 against the real A2 backend (#353), through the actual product journey with NO team membership for the
// awarded Artisan: offer with a sub-lot → award → award-scoped journal → sub-lot intervention with a quantity →
// Client technical confirmation (not a reception, not a payment); competitor refused.
test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 });

test('Suivi B2 réel : sous-lot attribué, quantité déclarée, confirmation technique Client, concurrent refusé', async ({ page, browser, e2eClient, e2eReviewer, e2eArtisan, e2eSecondArtisan }, info) => {
  test.skip(!e2eClient || !e2eReviewer || !e2eArtisan || !e2eSecondArtisan, 'E2E Supabase credentials are not available');
  test.setTimeout(240_000);
  const viewport = info.project.name === 'mobile' ? { width: 375, height: 812 } : { width: 1440, height: 900 };
  const lotTitle = `Lot suivi B2 ${info.project.name}`, subLot = `Rainures B2 ${info.project.name}`;
  await login(page, e2eClient!);
  const project = await createProjectWithMainLot(page, info, 'execution-b2', 'Saignées et passage de gaines.', lotTitle);
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
  await line.getByLabel('Prix proposé (TND)').fill('1800');
  await line.getByLabel('Délai (jours)').fill('10');
  await line.getByLabel('Proposition technique / inclusions').fill('Saignées et gaines');
  await line.locator('summary').filter({ hasText: 'Détailler ce lot (facultatif)' }).click();
  await artisan.getByRole('button', { name: 'Ajouter un sous-lot' }).click();
  await artisan.getByLabel('Sous-lot 1', { exact: true }).fill(subLot);
  await artisan.getByRole('button', { name: 'Soumettre l’offre' }).click();
  await expect(artisan.getByRole('heading', { name: 'Offre envoyée' })).toBeVisible();

  await page.goto(`/app/publications/${publicationId}`);
  const comparison = page.getByRole('heading', { name: 'Comparer et attribuer les offres' }).locator('..');
  const lot = comparison.getByRole('heading', { name: lotTitle, exact: true }).locator('xpath=../..');
  await lot.getByRole('button', { name: 'Attribuer cette offre' }).click();
  await lot.getByRole('button', { name: 'Confirmer l’attribution' }).click();
  await expect(comparison.getByText('Lot attribué', { exact: true })).toBeVisible();
  const [awardItem] = await adminRows('award_items', `project_id=eq.${project.projectId}&active=eq.true&select=id`);
  expect(await adminRows('project_members', `project_id=eq.${project.projectId}&participation_role=eq.contractor&select=id`)).toHaveLength(0);

  // Awarded Artisan, not a team member: award-scoped journal only.
  await artisan.reload();
  await artisan.getByRole('link', { name: /Suivi du chantier de votre lot/ }).click();
  await expect(artisan).toHaveURL(`/app/native-execution/${project.projectId}?section=journal`);
  await expect(artisan.getByText('Votre lot', { exact: true })).toBeVisible();
  const subLots = artisan.getByRole('list', { name: 'Sous-lots de l’offre attribuée' });
  await expect(subLots).toContainText(subLot);
  await expect(subLots).toContainText('Aucune déclaration');
  const intervention = artisan.locator('details').filter({ hasText: 'Consigner une intervention' });
  await intervention.locator('summary').click();
  await intervention.getByLabel('Sous-lot — facultatif').selectOption({ label: subLot });
  await intervention.getByLabel('Quantité', { exact: true }).fill('12,5');
  await intervention.getByLabel('Rapport court').fill('Saignées du séjour réalisées.');
  await intervention.getByRole('button', { name: 'Ajouter l’intervention' }).click();
  await expect(artisan.getByRole('alert').filter({ hasText: 'Précisez l’unité' })).toBeVisible();
  await intervention.getByLabel('Unité', { exact: true }).fill('ml');
  await intervention.getByRole('button', { name: 'Ajouter l’intervention' }).click();
  await expect(artisan.getByRole('status').filter({ hasText: 'Intervention ajoutée' })).toBeVisible();
  await expect(subLots).toContainText('12,5 ml déclarés');
  await artisan.getByRole('radio', { name: 'Par semaine' }).click();
  await expect(artisan.getByRole('region', { name: /^Semaine du/ }).first()).toContainText('Saignées du séjour réalisées.');
  expect(await artisan.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  const [logged] = await adminRows('site_log_events', `award_item_id=eq.${awardItem.id}&event_kind=eq.intervention&select=id,bid_sub_lot_id,executed_quantity_milli,quantity_unit`);
  expect(logged).toMatchObject({ executed_quantity_milli: 12500, quantity_unit: 'ml' });
  expect(logged.bid_sub_lot_id).toBeTruthy();
  await ac.close();

  // Competitor: refused by the API.
  const cc = await browser.newContext(), competitor = await cc.newPage();
  await login(competitor, e2eSecondArtisan!);
  const denied = await actorCommand(competitor, e2eSecondArtisan!, '/api/projects/execution', { kind: 'intervention', award_item_id: awardItem.id, work_date: new Date().toISOString().slice(0, 10), note: 'Tentative concurrente', document_ids: [], idempotency_key: randomUUID() });
  expect(denied.status()).toBe(403);
  await cc.close();

  // Client: sees the sub-lot and quantity, then confirms the step technically (explicitly non-legal).
  await page.goto(`/app/projects/${project.projectId}?tab=tracking`);
  const event = page.locator('li').filter({ hasText: 'Saignées du séjour réalisées.' }).first();
  await expect(event).toContainText(subLot);
  await expect(event).toContainText('12,5 ml');
  await event.locator('summary').filter({ hasText: 'Ajouter une observation Client' }).click();
  await event.getByLabel('Retour').selectOption('technical_validated');
  await expect(event.getByText(/ni réception des travaux, ni acceptation juridique, ni autorisation de paiement/)).toBeVisible();
  await event.getByRole('button', { name: 'Enregistrer le retour' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Confirmation technique enregistrée' })).toBeVisible();
  await expect(event.getByText('Étape confirmée techniquement par le Client', { exact: true })).toBeVisible();
  expect(await adminRows('site_client_observations', `event_id=eq.${logged.id}&select=outcome`)).toEqual([{ outcome: 'technical_validated' }]);
  expect(await adminRows('contracts', `project_id=eq.${project.projectId}&select=id`)).toHaveLength(0);
});
