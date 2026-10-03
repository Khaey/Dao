import { randomUUID } from 'node:crypto';
import { expect, Page, TestInfo } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { E2EUser } from './fixtures';
import { recordE2EValue } from './state';

function localConfig() {
  if (process.env.DAO_SUPABASE_URL !== 'http://127.0.0.1:54321' || !process.env.DAO_SUPABASE_SECRET_KEY) throw new Error('Collaboration E2E requires disposable local Supabase');
  return { url: process.env.DAO_SUPABASE_URL, secret: process.env.DAO_SUPABASE_SECRET_KEY };
}
export async function adminRows<T = any>(table: string, query: string): Promise<T[]> {
  const { url, secret } = localConfig();
  const response = await fetch(`${url}/rest/v1/${table}?${query}`, { headers: { apikey: secret, Authorization: `Bearer ${secret}` } });
  if (!response.ok) throw new Error(`Collaboration fixture read failed (${response.status})`);
  return response.json();
}
export async function approveDocument(id: string) {
  const { url, secret } = localConfig();
  const response = await fetch(`${url}/rest/v1/documents?id=eq.${id}`, { method: 'PATCH', headers: { apikey: secret, Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'approved' }) });
  if (!response.ok) throw new Error(`Local document moderation fixture failed (${response.status})`);
}
export async function actorCommand(page: Page, user: E2EUser, path: string, body: Record<string, unknown>) {
  const { url, secret } = localConfig();
  const auth = createClient(url, process.env.DAO_SUPABASE_PUBLISHABLE_KEY || secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const login = await auth.auth.signInWithPassword({ email: user.email, password: user.password });
  if (login.error || !login.data.session) throw new Error('Could not authenticate collaboration fixture');
  return page.request.post(path, { headers: { Authorization: 'Bearer ' + login.data.session.access_token }, data: body });
}
export async function createCollaborative(page: Page, info: TestInfo, contractor: boolean, email = '', stayOnInvitation = false) {
  const title = `Chantier E2E ${info.project.name} ${randomUUID()}`;
  await page.goto('/app/projects/new');
  if (!contractor) await page.getByRole('button', { name: 'J’ai déjà mes artisans / entreprises' }).click();
  await page.getByLabel('Titre du chantier').fill(title);
  await page.getByLabel('Description courte').fill('Travaux existants à suivre ensemble.');
  const territory = page.getByLabel('Localisation', { exact: true });
  await expect(territory.getByRole('option')).not.toHaveCount(1);
  await territory.selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Continuer', exact: true }).click();
  await page.getByRole('radio', { name: 'Travaux en cours', exact: true }).check();
  await page.getByLabel('Situation du paiement — optionnel').selectOption('partial');
  await page.getByRole('button', { name: 'Continuer', exact: true }).click();
  if (email) await page.getByLabel('Email du destinataire — optionnel').fill(email);
  await page.getByRole('button', { name: 'Continuer', exact: true }).click();
  await page.getByRole('button', { name: 'Créer et préparer l’invitation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Invitation au chantier prête' })).toBeVisible();
  const link = await page.getByLabel('Lien d’invitation').inputValue();
  const href = await page.getByRole('link', { name: 'Ouvrir le chantier' }).getAttribute('href');
  const projectId = href?.match(/\/app\/projects\/([0-9a-f-]{36})/)?.[1];
  if (!projectId) throw new Error('Created collaboration project id is missing');
  recordE2EValue(info, 'projects', projectId);
  if (!stayOnInvitation) {
    await page.getByRole('link', { name: 'Ouvrir le chantier' }).click();
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  }
  return { projectId, title, link };
}
export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Déconnexion', exact: true }).click();
  await expect(page).toHaveURL(/\/auth\/login/);
}
export async function acceptWithLogin(page: Page, link: string, user: E2EUser) {
  await page.goto(link);
  await page.getByRole('link', { name: 'Se connecter', exact: true }).click();
  await page.getByPlaceholder('Votre email').fill(user.email);
  await page.getByPlaceholder('Mot de passe').fill(user.password);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  // Never include the single-use token in the expected assertion output.
  await expect(page).toHaveURL(/\/invite\/[a-f0-9]{64}$/);
  await page.getByRole('button', { name: 'Confirmer et rejoindre le chantier' }).click();
  await expect(page).toHaveURL(/\/app\/projects\/[0-9a-f-]{36}$/);
}
