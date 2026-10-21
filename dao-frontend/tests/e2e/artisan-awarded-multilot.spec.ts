import { test, expect } from './support/fixtures';
import { createProjectWithMainLot, login } from './support/flow';
import { actorCommand, adminRows } from './support/collaboration';
import { recordE2EValue } from './support/state';

// #356 closing edge cases (PILOT 9 recipe): two lots, two Artisans, partial award then award of the other lot to a
// competitor. Each Artisan sees ONLY their own active lot, the catalogue keeps the DAO while a lot is open, and the
// offers are classified from the real decisions. No team membership is created.
test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 });

test('Artisan #356 multi-lots : attribution partielle, lot du concurrent, catalogue et classement', async ({ page, browser, e2eClient, e2eReviewer, e2eArtisan, e2eSecondArtisan }, info) => {
  test.skip(!e2eClient || !e2eReviewer || !e2eArtisan || !e2eSecondArtisan, 'E2E Supabase credentials are not available');
  test.setTimeout(300_000);
  const viewport = info.project.name === 'mobile' ? { width: 375, height: 812 } : { width: 1440, height: 900 };
  const lotA = `Lot A multi ${info.project.name}`, lotB = `Lot B multi ${info.project.name}`;
  await login(page, e2eClient!);
  const project = await createProjectWithMainLot(page, info, 'artisan-multilot', 'Électricité du rez-de-chaussée.', lotA);
  const trades = await adminRows('trades', 'code=eq.general_contractor&select=id');
  expect((await actorCommand(page, e2eClient!, '/api/projects/requests', { project_id: project.projectId, trade_id: trades[0].id, title: lotB, scope: 'Électricité de l’étage.', budget_millimes: null })).ok()).toBeTruthy();
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

  const offerLine = (who: typeof page, title: string) => who.locator('div.rounded-xl').filter({ has: who.getByRole('heading', { name: title, exact: true }) }).filter({ has: who.getByLabel('Prix proposé (TND)') });
  // Artisan 1 answers both lots separately (no package); Artisan 2 answers lot B only.
  const ac = await browser.newContext({ viewport }), first = await ac.newPage();
  await login(first, e2eArtisan!); await first.goto(`/app/artisan/publications/${publicationId}`);
  for (const title of [lotA, lotB]) { const line = offerLine(first, title); await line.getByLabel('Prix proposé (TND)').fill('3000'); await line.getByLabel('Délai (jours)').fill('9'); await line.getByLabel('Proposition technique / inclusions').fill(`Offre ${title}`); }
  await first.getByRole('button', { name: 'Soumettre l’offre' }).click();
  await expect(first.getByRole('heading', { name: 'Offre envoyée' })).toBeVisible();
  const sc = await browser.newContext({ viewport }), second = await sc.newPage();
  await login(second, e2eSecondArtisan!); await second.goto(`/app/artisan/publications/${publicationId}`);
  await second.getByRole('article').filter({ has: second.getByRole('heading', { name: lotA, exact: true }) }).getByLabel('Répondre à ce lot').uncheck();
  const secondLine = offerLine(second, lotB); await secondLine.getByLabel('Prix proposé (TND)').fill('2900'); await secondLine.getByLabel('Délai (jours)').fill('10'); await secondLine.getByLabel('Proposition technique / inclusions').fill('Offre concurrente B');
  await second.getByRole('button', { name: 'Soumettre l’offre' }).click();
  await expect(second.getByRole('heading', { name: 'Offre envoyée' })).toBeVisible();

  // Client awards lot A to Artisan 1 only.
  await page.goto(`/app/publications/${publicationId}`);
  const comparison = page.getByRole('heading', { name: 'Comparer et attribuer les offres' }).locator('..');
  const lotASection = comparison.getByRole('heading', { name: lotA, exact: true }).locator('xpath=../..');
  await lotASection.getByRole('button', { name: 'Attribuer cette offre' }).click();
  await lotASection.getByRole('button', { name: 'Confirmer l’attribution' }).click();
  await expect(lotASection.getByText('Lot attribué', { exact: true })).toBeVisible();

  // Partial: Artisan 1 sees lot A only, the DAO stays listed with one lot still open, the offer stays « en cours ».
  const rowOf = (who: typeof page) => who.locator(`[data-testid="project-row-${project.projectId}"]:visible`);
  await first.goto('/app/projects');
  await expect(rowOf(first)).toContainText(`Lot retenu : ${lotA}`);
  await expect(rowOf(first)).not.toContainText(lotB);
  await first.goto('/app/artisan');
  const listed = first.locator(`a[href="/app/artisan/publications/${publicationId}"]`);
  await expect(listed).toHaveCount(1);
  await expect(listed).toContainText('1 lot sur 2 encore ouvert aux offres');
  await first.goto('/app/artisan/offers');
  await first.getByRole('button', { name: /^En cours/ }).click();
  const firstOffer = first.getByRole('heading', { name: project.title, exact: true }).locator('xpath=../..');
  await expect(firstOffer.getByText('Partiellement retenue', { exact: true })).toBeVisible();
  await expect(firstOffer.getByText('1 lot en attente de décision', { exact: true })).toBeVisible();
  // Artisan 2 has nothing awarded yet and never sees Artisan 1's lot.
  await second.goto('/app/projects');
  await expect(rowOf(second)).toHaveCount(0);

  // Client awards lot B to the competitor: both lots decided.
  const lotBSection = comparison.getByRole('heading', { name: lotB, exact: true }).locator('xpath=../..');
  await lotBSection.getByTestId('offer-card').filter({ hasText: 'Offre concurrente B' }).getByRole('button', { name: 'Attribuer cette offre' }).click();
  await lotBSection.getByRole('button', { name: 'Confirmer l’attribution' }).click();
  await expect(lotBSection.getByText('Lot attribué', { exact: true })).toBeVisible();

  await second.goto('/app/projects');
  await expect(rowOf(second)).toContainText(`Lot retenu : ${lotB}`);
  await expect(rowOf(second)).not.toContainText(lotA);
  await first.goto('/app/projects');
  await expect(rowOf(first)).toHaveCount(1);
  await expect(rowOf(first)).not.toContainText(lotB);
  // Catalogue: no lot open any more → removed for everyone; offers move to the results.
  await first.goto('/app/artisan');
  await expect(first.locator(`a[href="/app/artisan/publications/${publicationId}"]`)).toHaveCount(0);
  await first.goto('/app/artisan/offers');
  await first.getByRole('button', { name: /^Résultats et historique/ }).click();
  await expect(first.getByRole('heading', { name: project.title, exact: true }).locator('xpath=../..').getByText('Partiellement retenue', { exact: true })).toBeVisible();
  await second.goto('/app/artisan/offers');
  await second.getByRole('button', { name: /^Résultats et historique/ }).click();
  await expect(second.getByRole('heading', { name: project.title, exact: true }).locator('xpath=../..').getByText('Retenue', { exact: true })).toBeVisible();
  expect(await adminRows('project_members', `project_id=eq.${project.projectId}&participation_role=eq.contractor&select=id`)).toHaveLength(0);
  expect(await second.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await ac.close(); await sc.close();
});
