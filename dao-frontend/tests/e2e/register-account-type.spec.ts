import { randomUUID } from 'node:crypto';
import { test, expect } from './support/fixtures';
import { recordE2EValue } from './support/state';

const supabaseUrl = process.env.DAO_SUPABASE_URL;
const supabaseSecret = process.env.DAO_SUPABASE_SECRET_KEY;

async function initializedUserId(response: import('@playwright/test').Response) {
  const body = await response.json() as { data?: { user_id?: string } };
  return body.data?.user_id ?? null;
}

async function adminRows<T>(table: string, filterColumn: string, value: string): Promise<T[]> {
  if (!supabaseUrl || !supabaseSecret) throw new Error('Disposable E2E Supabase credentials are required');
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?${filterColumn}=eq.${value}&select=*`, {
    headers: { apikey: supabaseSecret, Authorization: `Bearer ${supabaseSecret}` },
  });
  if (!response.ok) throw new Error(`Could not verify E2E account data (${response.status})`);
  return response.json() as Promise<T[]>;
}

test('inscription client : type obligatoire, rôle client et redirection vers les projets', async ({ page }, testInfo) => {
  test.skip(!supabaseUrl || !supabaseSecret, 'E2E Supabase credentials are not available');
  const suffix = randomUUID();
  await page.goto('/auth/register');
  const create = page.getByRole('button', { name: 'Créer mon compte' });
  await expect(page.getByRole('radio', { name: /Client/ })).not.toBeChecked();
  await expect(page.getByRole('radio', { name: /Artisan \/ Entreprise/ })).not.toBeChecked();
  await expect(create).toBeDisabled();

  await page.getByPlaceholder('Nom complet').fill('Client E2E');
  await page.getByPlaceholder('Email').fill(`dao-register-client-${suffix}@logiclab.invalid`);
  await page.getByPlaceholder('Mot de passe').fill(`Dao-E2e-${suffix}-A9!`);
  await page.getByRole('radio', { name: /Client/ }).check();
  await expect(create).toBeEnabled();
  const initialized = page.waitForResponse(response => response.url().endsWith('/api/profile') && response.request().method() === 'POST');
  await create.click();
  await expect(page).toHaveURL(/\/app\/projects/);

  const userId = await initializedUserId(await initialized);
  expect(userId).toBeTruthy();
  recordE2EValue(testInfo, 'users', userId!);
  const roles = await adminRows<{ role: string }>('user_roles', 'user_id', userId!);
  expect(roles.map(row => row.role)).toEqual(['client']);
  expect(await adminRows('contractor_profiles', 'user_id', userId!)).toHaveLength(0);
});

test('inscription artisan/entreprise : activité requise, statut pending et redirection artisan', async ({ page }, testInfo) => {
  test.skip(!supabaseUrl || !supabaseSecret, 'E2E Supabase credentials are not available');
  const suffix = randomUUID();
  await page.goto('/auth/register');
  await page.getByPlaceholder('Nom complet').fill('Artisan E2E');
  await page.getByPlaceholder('Email').fill(`dao-register-contractor-${suffix}@logiclab.invalid`);
  await page.getByPlaceholder('Mot de passe').fill(`Dao-E2e-${suffix}-A9!`);
  await page.getByRole('radio', { name: /Artisan \/ Entreprise/ }).check();

  const businessName = page.getByPlaceholder('Nom de l’activité / entreprise');
  await expect(businessName).toBeVisible();
  await expect(businessName).toHaveAttribute('required', '');
  const create = page.getByRole('button', { name: 'Créer mon compte' });
  await expect(create).toBeDisabled();
  await businessName.fill(`Atelier E2E ${suffix}`);
  await expect(create).toBeEnabled();
  const initialized = page.waitForResponse(response => response.url().endsWith('/api/profile') && response.request().method() === 'POST');
  await create.click();
  await expect(page).toHaveURL(/\/app\/artisan/);

  const userId = await initializedUserId(await initialized);
  expect(userId).toBeTruthy();
  recordE2EValue(testInfo, 'users', userId!);
  const roles = await adminRows<{ role: string }>('user_roles', 'user_id', userId!);
  expect(roles.map(row => row.role)).toEqual(['contractor']);
  const profiles = await adminRows<{ id: string; business_name: string; verification_status: string; contractor_type: string | null }>('contractor_profiles', 'user_id', userId!);
  expect(profiles).toHaveLength(1);
  expect(profiles[0].business_name).toBe(`Atelier E2E ${suffix}`);
  expect(profiles[0].verification_status).toBe('pending');
  expect(profiles[0].contractor_type).toBeNull();
  expect(await adminRows('contractor_trades', 'contractor_id', profiles[0].id)).toHaveLength(0);
  recordE2EValue(testInfo, 'contractorProfiles', profiles[0].id);
});
