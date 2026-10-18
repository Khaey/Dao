import { test, expect } from './support/fixtures';
import { login } from './support/flow';

// Deterministic directory: the UI state continuity is under test, not the live publication fixtures.
const alpha = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', name: 'Atelier Alpha E2E', city: 'Sousse', governorate: 'Sousse', areas: ['Monastir'], trades: ['Plomberie'], contractor_type: 'artisan', years_experience: 12, availability: 'now', portfolio_count: 3, rating_average: 4.5, rating_count: 2 };
const beta = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', name: 'Bati Beta E2E', city: 'Tunis', governorate: 'Tunis', areas: [], trades: ['Électricité'], contractor_type: 'company', years_experience: 3, availability: 'to_discuss', portfolio_count: 0, rating_average: null, rating_count: 0 };

test('Annuaire : recherche, filtres et tri survivent à la fiche, au retour, au rechargement', async ({ page, e2eClient }) => {
  test.skip(!e2eClient, 'E2E Supabase credentials are not available');
  await login(page, e2eClient!);
  await page.route('**/api/professionals?*', async route => {
    const view = new URL(route.request().url()).searchParams.get('view');
    if (view === 'directory') await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [alpha, beta] }) });
    else await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Fiche non publiée ou non autorisée' }) });
  });
  const search = page.getByLabel('Rechercher par nom ou ville');
  const sort = page.getByLabel('Trier les professionnels');
  const zone = page.locator('#directory-filters select').nth(1);

  // Shared or reloaded link restores filters; forged values are ignored.
  await page.goto('/app/professionals?zone=Sousse&type=artisan&rating=9&sort=hack');
  await expect(page.getByRole('link', { name: /Atelier Alpha E2E/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Bati Beta E2E/ })).toHaveCount(0);
  await expect(zone).toHaveValue('Sousse');
  await expect(sort).toHaveValue('recent');
  await expect(page).not.toHaveURL(/rating=|sort=/);

  await search.fill('Atel');
  await sort.selectOption('name');
  await expect(page).toHaveURL(/q=Atel/);
  await expect(page).toHaveURL(/sort=name/);

  await page.reload();
  await expect(search).toHaveValue('Atel');
  await expect(sort).toHaveValue('name');
  await expect(zone).toHaveValue('Sousse');

  // Browser Back from a profile returns to the exact search.
  await page.getByRole('link', { name: /Atelier Alpha E2E/ }).click();
  await expect(page).toHaveURL(new RegExp(`/app/professionals/${alpha.id}`));
  await page.goBack();
  await expect(search).toHaveValue('Atel');
  await expect(zone).toHaveValue('Sousse');
  await expect(page.getByRole('link', { name: /Atelier Alpha E2E/ })).toBeVisible();

  // The profile's own "back to directory" link has no query string: the tab remembers the search.
  await page.getByRole('link', { name: /Atelier Alpha E2E/ }).click();
  await expect(page).toHaveURL(new RegExp(`/app/professionals/${alpha.id}`));
  await page.goto('/app/professionals');
  await expect(search).toHaveValue('Atel');
  await expect(page).toHaveURL(/q=Atel/);

  // Clearing filters cleans both the UI and the address bar.
  await page.getByRole('button', { name: 'Effacer les filtres', exact: true }).click();
  await expect(zone).toHaveValue('');
  await expect(page).not.toHaveURL(/zone=|type=/);
  await search.fill('');
  await expect(page).not.toHaveURL(/q=/);
  await expect(page.getByRole('link', { name: /Bati Beta E2E/ })).toBeVisible();
  // No review yet is stated as such, never as a fake "new" badge; card links are named after the professional.
  await expect(page.getByRole('link', { name: 'Bati Beta E2E', exact: true }).getByText('Pas encore d’avis')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});
