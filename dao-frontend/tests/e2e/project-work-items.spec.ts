import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { test, expect } from './support/fixtures';
import { createProjectWithMainLot, login } from './support/flow';

// #577 — Saisie manuelle Lot → Sous-lot facultatif → Ouvrage, sans dimension, persistée en base ;
// entrée « Avec l'assistant » masquée par le réglage Settings client.project_assistant.
test('Ouvrages #577 : lot, sous-lot manuel, ouvrages du référentiel et hors référentiel, persistance', async ({ page, e2eClient }, info) => {
  test.skip(!e2eClient, 'E2E Supabase credentials are not available');
  test.setTimeout(180_000);
  await login(page, e2eClient!);
  const project = await createProjectWithMainLot(page, info, 'ouvrages', 'Rénovation salle de bain et séjour');
  const lot = () => page.locator('tr').filter({ hasText: project.lotTitle });

  // Sous-lot créé à la main (facultatif) : nouvelle version du lot.
  await lot().getByRole('button', { name: `Ajouter un sous-lot au lot ${project.lotTitle}` }).click();
  const subForm = page.getByRole('form', { name: `Sous-lots officiels du lot ${project.lotTitle}` });
  await subForm.getByLabel('Intitulé').fill('Salle de bain');
  await subForm.getByLabel('Périmètre').fill('Sol, murs et équipements de la salle de bain');
  await subForm.getByRole('button', { name: 'Enregistrer les sous-lots' }).click();
  await expect(page.getByText('Sous-lots enregistrés')).toBeVisible();

  // Ouvrages du référentiel placés dans le sous-lot, sans aucune dimension.
  await lot().getByRole('button', { name: /Ajouter des ouvrages au lot/ }).click();
  const picker = lot().getByTestId('work-picker');
  await picker.getByLabel('Placer dans').selectOption({ label: 'Salle de bain' });
  await picker.getByLabel('Rechercher un ouvrage').fill('carrelage');
  await picker.getByRole('group', { name: 'Ouvrages du référentiel' }).getByRole('checkbox').first().check();
  await picker.getByRole('button', { name: /Ajouter 1 ouvrage/ }).click();
  await expect(page.getByText(/1 ouvrage\(s\) ajouté\(s\), sans dimension/)).toBeVisible();

  // Ouvrage hors référentiel, directement dans le lot : jamais chiffré.
  await lot().getByRole('button', { name: /Ajouter des ouvrages au lot/ }).click();
  const customForm = lot().getByTestId('work-picker').locator('details');
  await customForm.getByText('L’ouvrage n’est pas dans la liste').click();
  await customForm.getByLabel('Ouvrage hors référentiel').fill('Pose d’une niche murale sur mesure');
  await customForm.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(lot().getByTestId('work-item').filter({ hasText: 'Pose d’une niche murale sur mesure' })).toContainText('Hors référentiel');

  // Rechargement : mêmes ouvrages, même rattachement, lus depuis la base.
  await page.reload();
  await page.getByRole('button', { name: /^Lots/ }).click();
  const works = lot().getByTestId('lot-works');
  await expect(works.getByTestId('work-item')).toHaveCount(2);
  await expect(works.getByText('Salle de bain', { exact: true })).toBeVisible();
  await expect(works.getByText('Directement dans le lot', { exact: true })).toBeVisible();

  // « À confirmer », puis retrait de l'ouvrage hors référentiel (trace conservée côté base).
  const custom = works.getByTestId('work-item').filter({ hasText: 'Pose d’une niche murale sur mesure' });
  await custom.getByRole('button', { name: 'À confirmer' }).click();
  await expect(custom).toContainText('À confirmer');
  await custom.getByRole('button', { name: /Retirer Pose d’une niche/ }).click();
  await expect(works.getByTestId('work-item')).toHaveCount(1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('Entrées #577 : assistant masqué par Settings pour un compte, création manuelle toujours disponible', async ({ page, e2eClient, e2eAdmin }) => {
  test.skip(!e2eClient || !e2eAdmin || !process.env.DAO_SUPABASE_SECRET_KEY, 'E2E Supabase credentials are not available');
  const url = process.env.DAO_SUPABASE_URL!, key = process.env.DAO_SUPABASE_PUBLISHABLE_KEY!, secret = process.env.DAO_SUPABASE_SECRET_KEY!;
  expect(url).toBe('http://127.0.0.1:54321');
  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const service = createClient(url, secret, opts);
  // Compte Client jetable : le réglage par compte ne touche aucun autre test.
  const email = `e2e-577-off-${randomUUID()}@example.invalid`, password = `Off577-${randomUUID()}!`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  expect(created.error).toBeNull();
  const userId = created.data.user!.id;
  expect((await service.from('profiles').insert({ user_id: userId, display_name: 'E2E 577 assistant masqué' })).error).toBeNull();
  expect((await service.from('user_roles').insert({ user_id: userId, role: 'client' })).error).toBeNull();
  const admin = createClient(url, key, opts);
  expect((await admin.auth.signInWithPassword({ email: e2eAdmin!.email, password: e2eAdmin!.password })).error).toBeNull();
  const set = await admin.rpc('admin_setting_command', { p_action: 'set', p_input: { key: 'client.project_assistant', scope: 'account', user_id: userId, value: false, reason: 'E2E #577 : assistant masqué pour ce compte' } });
  expect(set.error, JSON.stringify(set.error)).toBeNull();

  // Assistant activé (défaut) pour le Client habituel : deux entrées explicites.
  await login(page, e2eClient!);
  await page.goto('/app/projects/new');
  await expect(page.getByTestId('entry-assistant')).toContainText('Avec l’assistant');
  await expect(page.getByTestId('entry-manual')).toContainText('Créer manuellement');

  // Assistant masqué pour le compte jetable : seule la création manuelle reste, et l'URL directe est refusée.
  await page.context().clearCookies();
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await login(page, { email, password } as any);
  await page.goto('/app/projects/new');
  await expect(page.getByTestId('entry-manual')).toContainText('Créer manuellement');
  await expect(page.getByTestId('entry-assistant')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Je cherche des professionnels' })).toBeVisible();
  await page.goto('/app/projects/new/assistant');
  await expect(page.getByRole('heading', { name: 'Assistant indisponible', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Créer manuellement' })).toBeVisible();
});
