import type { Page, Route } from '@playwright/test';
import { test, expect } from './support/fixtures';
import { login } from './support/flow';

const rpcError = { message: 'temporary_unavailable', code: '503', details: null, hint: null };

async function failFirst(page: Page, endpoint: string) {
  let failed = false;
  await page.route('**/*', async (route: Route) => {
    if (route.request().method() === 'OPTIONS' || !route.request().url().includes(endpoint)) {
      await route.continue();
      return;
    }
    if (!failed) {
      failed = true;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify(rpcError) });
      return;
    }
    await route.continue();
  });
}

test('Espace Artisan : une erreur de chargement ne devient pas un faux état vide et peut être relancée', async ({ page, e2eArtisan }) => {
  test.skip(!e2eArtisan, 'E2E Supabase credentials are not available');

  await failFirst(page, '/rest/v1/publications');
  await login(page, e2eArtisan!);
  await expect(page.getByText('Les DAO disponibles n’ont pas pu être chargés', { exact: true })).toBeVisible();
  await expect(page.getByText('Aucun DAO accessible', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Réessayer', exact: true }).click();
  await expect(page.getByText('Les DAO disponibles n’ont pas pu être chargés', { exact: true })).toHaveCount(0);

  await failFirst(page, '/rest/v1/rpc/my_bid_summaries');
  await page.goto('/app/artisan/offers');
  await expect(page.getByText('Vos offres n’ont pas pu être chargées', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Aucune offre', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Réessayer', exact: true }).click();
  await expect(page.getByText('Vos offres n’ont pas pu être chargées', { exact: true })).toHaveCount(0);

  await failFirst(page, '/rest/v1/rpc/my_project_invitations');
  await page.goto('/app/invitations');
  await expect(page.getByText('Vos invitations n’ont pas pu être chargées', { exact: true })).toBeVisible();
  await expect(page.getByText('Aucune invitation en attente', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Réessayer', exact: true }).click();
  await expect(page.getByText('Vos invitations n’ont pas pu être chargées', { exact: true })).toHaveCount(0);
});
