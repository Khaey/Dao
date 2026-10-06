import { test, expect } from './support/fixtures';
import { createProjectWithMainLot, login } from './support/flow';
import { actorCommand, adminRows } from './support/collaboration';
import { recordE2EValue } from './support/state';

test('Package indivisible : proposition, attribution complète, annulation et réattribution', async ({ page, browser, e2eClient, e2eReviewer, e2eArtisan }, info) => {
  test.skip(!e2eClient || !e2eReviewer || !e2eArtisan, 'Local E2E credentials unavailable');
  await login(page, e2eClient!);
  const project = await createProjectWithMainLot(page, info, 'package', 'Travaux du premier lot', 'Lot package A');
  const trades = await adminRows('trades', 'code=eq.general_contractor&select=id');
  const added = await actorCommand(page, e2eClient!, '/api/projects/requests', { project_id: project.projectId, trade_id: trades[0].id, title: 'Lot package B', scope: 'Travaux du second lot', budget_millimes: null });
  expect(added.ok()).toBeTruthy();
  await page.goto(`/app/projects/${project.projectId}/review`);
  await page.getByRole('button', { name: 'Soumettre pour revue DAO' }).click();
  const rc = await browser.newContext(), reviewer = await rc.newPage();
  await login(reviewer, e2eReviewer!); await reviewer.goto('/app/dao/review');
  const heading = reviewer.getByRole('heading', { name: project.title, exact: true });
  const card = heading.locator('xpath=../../..');
  await card.getByRole('button', { name: 'Passer en revue DAO' }).click();
  await expect(card.getByText('dao_review', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Approuver' }).click();
  await expect(heading).toHaveCount(0);
  await reviewer.goto(`/app/dao/publications/new?project_id=${project.projectId}`);
  await expect(reviewer.getByRole('button', { name: 'Publier le DAO' })).toBeEnabled();
  await reviewer.getByRole('button', { name: 'Publier le DAO' }).click();
  await expect(reviewer).toHaveURL(/\/app\/publications\/[^/]+/);
  const publicationId = reviewer.url().split('/').pop()!;
  recordE2EValue(info, 'publications', publicationId); await rc.close();
  const ac = await browser.newContext(), artisan = await ac.newPage();
  await login(artisan, e2eArtisan!); await artisan.goto(`/app/artisan/publications/${publicationId}`);
  for (const title of ['Lot package A', 'Lot package B']) {
    // The proposal form and published-lot list both contain the title. Scope
    // the editable line via its labelled input, without a forced interaction.
    const formLine = artisan.locator('div.rounded-xl').filter({ has: artisan.getByRole('heading', { name: title, exact: true }) }).filter({ has: artisan.getByLabel('Prix proposé (TND)') });
    await expect(formLine).toHaveCount(1);
    await formLine.getByLabel('Prix proposé (TND)').fill('1500');
    await formLine.getByLabel('Délai (jours)').fill('10');
    await formLine.getByLabel('Proposition technique / inclusions').fill(`Package complet ${title}`);
  }
  await artisan.getByLabel('Package indivisible : tous les lots de cette offre ensemble').check();
  await artisan.getByRole('button', { name: 'Soumettre l’offre' }).click();
  await expect(artisan.getByRole('heading', { name: 'Offre envoyée' })).toBeVisible(); await ac.close();
  await page.goto(`/app/publications/${publicationId}`);
  const comparison = page.getByRole('heading', { name: 'Comparer et attribuer les offres' }).locator('..');
  const lot = comparison.getByRole('heading', { name: 'Lot package A', exact: true }).locator('xpath=../..');
  await expect(comparison.getByTestId('offer-card')).toHaveCount(2);
  await lot.getByRole('button', { name: 'Attribuer tout le package' }).click();
  await expect(lot.getByText('Confirmer l’attribution de tous les lots de ce package indivisible ?')).toBeVisible();
  await lot.getByRole('button', { name: 'Confirmer l’attribution' }).click();
  await expect(comparison.getByText('Lot attribué', { exact: true })).toHaveCount(2);
  const first = await adminRows('award_items', `project_id=eq.${project.projectId}&active=eq.true&select=id,award_id`);
  expect(first).toHaveLength(2); expect(new Set(first.map(row => row.award_id)).size).toBe(1);
  await lot.getByRole('button', { name: 'Annuler l’attribution', exact: true }).click();
  const cancellation = comparison.getByRole('group', { name: 'Annulation de l’attribution' });
  await cancellation.getByLabel('Motif d’annulation').selectOption('financing');
  await cancellation.getByRole('button', { name: 'Confirmer l’annulation' }).click();
  await expect(comparison.getByText('Lot attribué', { exact: true })).toHaveCount(0);
  await expect(lot.getByRole('button', { name: 'Attribuer tout le package' })).toBeVisible();
  await lot.getByRole('button', { name: 'Attribuer tout le package' }).click();
  await lot.getByRole('button', { name: 'Confirmer l’attribution' }).click();
  await expect(comparison.getByText('Lot attribué', { exact: true })).toHaveCount(2);
  const history = await adminRows('award_items', `project_id=eq.${project.projectId}&select=id,active`);
  expect(history).toHaveLength(4); expect(history.filter(row => row.active)).toHaveLength(2);
  expect(await adminRows('contracts', `project_id=eq.${project.projectId}&select=id`)).toHaveLength(0);
  expect(await adminRows('project_members', `project_id=eq.${project.projectId}&participation_role=eq.contractor&select=id`)).toHaveLength(0);
});
