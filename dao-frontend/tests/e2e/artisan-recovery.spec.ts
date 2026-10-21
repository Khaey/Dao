import type { Page, Route } from '@playwright/test';
import { test, expect } from './support/fixtures';
import { login } from './support/flow';

const rpcError = { message: 'query_failed', code: 'PGRST000', details: null, hint: null };

async function failUntilRetry(page: Page, endpoint: string) {
  const handler = async (route: Route) => {
    if (route.request().method() === 'OPTIONS' || !route.request().url().includes(endpoint)) {
      await route.continue();
      return;
    }
    await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify(rpcError) });
  };
  await page.route('**/*', handler);
  return () => page.unroute('**/*', handler);
}

test('Espace Artisan : une erreur de chargement ne devient pas un faux état vide et peut être relancée', async ({ page, e2eArtisan }) => {
  test.skip(!e2eArtisan, 'E2E Supabase credentials are not available');

  const restoreDao = await failUntilRetry(page, '/rest/v1/publications');
  await login(page, e2eArtisan!);
  await page.goto('/app/artisan');
  await expect(page.getByText('Les DAO disponibles n’ont pas pu être chargés', { exact: true })).toBeVisible();
  await expect(page.getByText('Aucun DAO accessible', { exact: true })).toHaveCount(0);
  await restoreDao();
  await page.getByRole('button', { name: 'Réessayer', exact: true }).click();
  await expect(page.getByText('Les DAO disponibles n’ont pas pu être chargés', { exact: true })).toHaveCount(0);

  const restoreOffers = await failUntilRetry(page, '/rest/v1/rpc/my_bid_summaries');
  await page.goto('/app/artisan/offers');
  await expect(page.getByText('Vos offres n’ont pas pu être chargées', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Aucune offre', exact: true })).toHaveCount(0);
  await restoreOffers();
  await page.getByRole('button', { name: 'Réessayer', exact: true }).click();
  await expect(page.getByText('Vos offres n’ont pas pu être chargées', { exact: true })).toHaveCount(0);

  // #356: an award-items outage must never turn an awarded offer into a false "Attribution annulée".
  const restoreAwards = await failUntilRetry(page, '/rest/v1/award_items');
  await page.goto('/app/artisan/offers');
  await expect(page.getByText('Statut de vos attributions indisponible', { exact: true })).toBeVisible();
  await expect(page.getByText('Attribution annulée', { exact: true })).toHaveCount(0);
  await restoreAwards();
  await page.getByRole('button', { name: 'Réessayer', exact: true }).click();
  await expect(page.getByText('Statut de vos attributions indisponible', { exact: true })).toHaveCount(0);

  const restoreInvitations = await failUntilRetry(page, '/rest/v1/rpc/my_project_invitations');
  await page.goto('/app/invitations');
  await expect(page.getByText('Vos invitations n’ont pas pu être chargées', { exact: true })).toBeVisible();
  await expect(page.getByText('Aucune invitation en attente', { exact: true })).toHaveCount(0);
  await restoreInvitations();
  await page.getByRole('button', { name: 'Réessayer', exact: true }).click();
  await expect(page.getByText('Vos invitations n’ont pas pu être chargées', { exact: true })).toHaveCount(0);
});
