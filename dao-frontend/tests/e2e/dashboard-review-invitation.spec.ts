import { test, expect } from './support/fixtures';
import { login } from './support/flow';
import type { Page } from '@playwright/test';

type Opportunity = {
  project_id: string; project_title: string | null; project_stage: string; contractor_id: string; contractor_name: string;
  review: null | { id: string; status: 'published' | 'hidden' | 'withdrawn'; rating: number; comment: string; created_at: string; edited_at: string | null; hidden_reason: string | null; criteria: Record<string, number | null> };
};

const opportunity = (n: number, status?: 'published' | 'hidden' | 'withdrawn'): Opportunity => ({
  project_id: `00000000-0000-4000-8000-00000000000${n}`, project_title: `Chantier fictif ${n}`, project_stage: 'started',
  contractor_id: `00000000-0000-4000-9000-00000000000${n}`, contractor_name: `Professionnel fictif ${n}`,
  review: status ? { id: `00000000-0000-4000-a000-00000000000${n}`, status, rating: 4, comment: 'Avis fictif de test, suffisamment long.', created_at: '2026-10-01T10:00:00Z', edited_at: null, hidden_reason: status === 'hidden' ? 'Motif fictif' : null, criteria: {} } : null,
});

/** Stubs only the review RPC (the server rules are covered by the reviews integration tests) and counts its calls. */
async function stubOpportunities(page: Page, respond: { status?: number; body: unknown }) {
  const calls = { count: 0 };
  await page.route('**/rest/v1/rpc/my_review_opportunities', async (route) => {
    const origin = route.request().headers().origin ?? '*';
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    calls.count += 1;
    return route.fulfill({ status: respond.status ?? 200, headers: cors, contentType: 'application/json', body: JSON.stringify(respond.body) });
  });
  return calls;
}

const card = (page: Page) => page.getByTestId('review-invitation');
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test('Tableau Client : aucun avis en attente, l’encart reste masqué', async ({ page, e2eClient }) => {
  test.skip(!e2eClient, 'E2E Supabase credentials are not available');
  const calls = await stubOpportunities(page, { body: [] });
  await login(page, e2eClient!);
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: /^Bonjour / })).toBeVisible();
  await expect(page.getByTestId('dashboard-stat-total')).toBeVisible();
  await expect(card(page)).toHaveCount(0);
  await expect(page.getByText(/avis vous attend/)).toHaveCount(0);
  expect(calls.count).toBe(1);
});

test('Tableau Client : un avis en attente, texte prudent, lien et cible tactile', async ({ page, e2eClient }) => {
  test.skip(!e2eClient, 'E2E Supabase credentials are not available');
  const calls = await stubOpportunities(page, { body: [opportunity(1)] });
  await login(page, e2eClient!);
  await page.goto('/app');
  await expect(card(page)).toBeVisible();
  await expect(card(page).getByRole('heading', { name: 'Un avis vous attend', exact: true })).toBeVisible();
  await expect(card(page)).toContainText('Professionnel fictif 1 · Chantier fictif 1');
  await expect(card(page)).toContainText('Un avis ne certifie ni la fin des travaux ni un paiement.');
  const link = card(page).getByRole('link', { name: 'Donner mon avis' });
  await expect(link).toHaveAttribute('href', '/app/reviews');
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await noOverflow(page)).toBe(true);
  expect(calls.count).toBe(1);
  await link.click();
  await expect(page).toHaveURL(/\/app\/reviews$/);
});

test('Tableau Client : seuls les avis absents ou retirés comptent, aperçu limité à deux', async ({ page, e2eClient }) => {
  test.skip(!e2eClient, 'E2E Supabase credentials are not available');
  await stubOpportunities(page, { body: [opportunity(1), opportunity(2, 'withdrawn'), opportunity(3), opportunity(4), opportunity(5, 'published'), opportunity(6, 'hidden')] });
  await login(page, e2eClient!);
  await page.goto('/app');
  await expect(card(page).getByRole('heading', { name: '4 avis vous attendent', exact: true })).toBeVisible();
  await expect(card(page).getByTestId('review-invitation-list').getByRole('listitem')).toHaveCount(3);
  await expect(card(page)).toContainText('+ 2 autres');
  await expect(card(page)).not.toContainText('Professionnel fictif 5');
  await expect(card(page)).not.toContainText('Professionnel fictif 6');
});

test('Tableau Client : avis déjà publiés, masqués ou modifiés, aucune invitation', async ({ page, e2eClient }) => {
  test.skip(!e2eClient, 'E2E Supabase credentials are not available');
  await stubOpportunities(page, { body: [opportunity(1, 'published'), opportunity(2, 'hidden')] });
  await login(page, e2eClient!);
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: /^Bonjour / })).toBeVisible();
  await expect(card(page)).toHaveCount(0);
});

test('Tableau Client : échec de la RPC, ni erreur bloquante ni faux zéro', async ({ page, e2eClient }) => {
  test.skip(!e2eClient, 'E2E Supabase credentials are not available');
  await stubOpportunities(page, { status: 500, body: { code: 'XX000', message: 'boom' } });
  await login(page, e2eClient!);
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: /^Bonjour / })).toBeVisible();
  await expect(page.getByTestId('dashboard-stat-total')).toBeVisible();
  await expect(card(page)).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText(/0 avis|Aucun avis/)).toHaveCount(0);
});

test('Tableau Client : 375 px sans débordement, cibles ≥ 44 px', async ({ page, e2eClient }) => {
  test.skip(!e2eClient, 'E2E Supabase credentials are not available');
  await page.setViewportSize({ width: 375, height: 800 });
  await stubOpportunities(page, { body: [opportunity(1), opportunity(2), opportunity(3)] });
  await login(page, e2eClient!);
  await page.goto('/app');
  await expect(card(page)).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
  expect((await card(page).getByRole('link', { name: 'Donner mon avis' }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

test('Tableau Artisan seul : aucun encart et aucun appel à la RPC des avis', async ({ page, e2eArtisan }) => {
  test.skip(!e2eArtisan, 'E2E Supabase credentials are not available');
  const calls = await stubOpportunities(page, { body: [opportunity(1)] });
  await login(page, e2eArtisan!);
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Mes chantiers clients', exact: true })).toBeVisible();
  await expect(card(page)).toHaveCount(0);
  expect(calls.count).toBe(0);
});

test('Double rôle : l’encart suit l’espace actif, jamais dans l’espace Artisan', async ({ page, e2eDualRole }) => {
  test.skip(!e2eDualRole, 'Disposable dual-role E2E account is unavailable');
  const calls = await stubOpportunities(page, { body: [opportunity(1)] });
  await login(page, e2eDualRole!);
  const mobile = (page.viewportSize()?.width ?? 1440) < 1024;
  const chooseWorkspace = async (name: 'Artisan' | 'Client') => {
    await page.goto('/app/projects');
    if (mobile) await page.getByRole('button', { name: 'Ouvrir le menu', exact: true }).click();
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page).toHaveURL(/\/app$/);
    await page.goto('/app');
  };
  await chooseWorkspace('Artisan');
  await expect(page.getByRole('heading', { name: 'Mes chantiers clients', exact: true })).toBeVisible();
  await expect(card(page)).toHaveCount(0);
  const afterArtisan = calls.count;
  expect(afterArtisan).toBe(0);
  await chooseWorkspace('Client');
  await expect(card(page)).toBeVisible();
  expect(calls.count).toBeGreaterThan(afterArtisan);
});
