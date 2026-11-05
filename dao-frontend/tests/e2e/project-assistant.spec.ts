import { test, expect } from './support/fixtures';
import { login } from './support/flow';
import { recordE2EValue } from './support/state';

const VILLA = 'Villa R+1 à Sousse : terrain 206 m², construit total 180 m², 2 chambres à l’étage, garage 1 voiture, cuisine séparée, 2 salles de bain, jardin et terrasse si possible, sans piscine, budget inconnu, plans et études absents.';

test('Assistant BTP : description libre → proposition immédiate → corrections → chantier créé (réel)', async ({ page, e2eClient }, testInfo) => {
  test.skip(!e2eClient, 'E2E Supabase credentials are not available');
  await login(page, e2eClient!);
  await page.goto('/app/projects/new');
  // #577 — deux entrées explicites ; l'assistant propose des questions guidées ou la description directe.
  await expect(page.getByTestId('entry-manual')).toContainText('Créer manuellement');
  await page.getByRole('link', { name: /Avec l’assistant/ }).click();
  await expect(page.getByRole('heading', { name: 'Décrivez votre projet', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Quel type de lieu ?' })).toBeVisible();
  await page.getByRole('button', { name: 'Décrire directement' }).click();

  // Description libre : aucune question préalable, proposition immédiate.
  await page.getByLabel('Description libre').fill(VILLA);
  await page.getByRole('button', { name: 'Voir la proposition' }).click();
  await expect(page.getByRole('heading', { name: /Construction d’une villa/, level: 1 })).toBeVisible();
  await expect(page.getByText(/Référentiel en cours de constitution · version TN-/)).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Fondations selon études/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Garage/ }).first()).toBeChecked();
  await expect(page.getByText('206 m²')).toBeVisible();
  await expect(page.getByText(/Aucun prix ni budget n’est calculé/)).toBeVisible();
  await expect(page.locator('main')).not.toContainText(/\bTND\b|millimes/);
  await expect(page.getByRole('heading', { name: /S’agit-il|Quelles pièces/ })).toHaveCount(0);

  // Correction en langage naturel, choix précédents conservés.
  await page.getByLabel('Modifier avec vos mots').fill('retire le garage et ajoute des fenêtres');
  await page.getByRole('button', { name: 'Appliquer' }).click();
  await expect(page.getByText(/sans perdre vos choix précédents/)).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Menuiseries extérieures/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /^Garage/ })).toHaveCount(0);
  await page.getByLabel('Modifier avec vos mots').fill('ajoute un héliport');
  await page.getByRole('button', { name: 'Appliquer' }).click();
  await expect(page.getByText(/Rien n’a été inventé/)).toBeVisible();

  // Reprise du brouillon persisté après rechargement.
  await page.reload();
  await expect(page.getByText(/Brouillon en cours/)).toBeVisible();
  await page.getByRole('button', { name: 'Reprendre' }).click();
  await expect(page.getByRole('checkbox', { name: /Menuiseries extérieures/ })).toBeChecked();

  // Création : gouvernorat requis, puis chantier brouillon persistant.
  await page.getByLabel('Gouvernorat').selectOption({ label: 'Gouvernorat E2E' });
  await expect(page.getByText('Gouvernorat enregistré.')).toBeVisible();
  await page.getByRole('button', { name: 'Créer mon chantier' }).click();
  await expect(page).toHaveURL(/\/app\/projects\/[0-9a-f-]{36}\?tab=lots$/);
  const projectId = new URL(page.url()).pathname.split('/').pop()!;
  recordE2EValue(testInfo, 'projects', projectId);
  // Le chantier s'ouvre sur l'onglet Lots : les ouvrages retenus y sont transcrits, sans dimension.
  await expect(page.locator('tr').filter({ hasText: 'Plomberie et sanitaires' }).first()).toBeVisible();
  await expect(page.getByTestId('lot-works').first()).toBeVisible();
  await expect(page.getByTestId('work-item').filter({ hasText: /Fondations selon études/ }).first()).toBeVisible();
  await expect(page.getByText('retenu avec l’assistant').first()).toBeVisible();
  // Rechargement : la liste vient de la base, pas d'un état local.
  await page.reload();
  await expect(page.getByTestId('work-item').filter({ hasText: /Fondations selon études/ }).first()).toBeVisible();
  await expect(page.locator('tr').filter({ hasText: 'Aménagements extérieurs' }).first()).toBeVisible();

  // Le brouillon transformé n'est plus proposé à la reprise (pas de doublon).
  await page.goto('/app/projects/new/assistant');
  await expect(page.getByRole('heading', { name: 'Décrivez votre projet', level: 1 })).toBeVisible();
  await expect(page.getByText(/Brouillon en cours/)).toHaveCount(0);
});

test('Assistant BTP #577 : questions guidées une à la fois, « Passer » et « Je ne sais pas », mobile sans débordement', async ({ page, e2eClient }) => {
  test.skip(!e2eClient, 'E2E Supabase credentials are not available');
  await login(page, e2eClient!);
  await page.goto('/app/projects/new/assistant');
  await expect(page.getByRole('heading', { name: 'Quel type de lieu ?' })).toBeVisible();
  for (const label of ['Maison / villa', 'Appartement', 'Local commercial', 'Bureau', 'Autre / je ne sais pas']) await expect(page.getByRole('button', { name: label })).toBeVisible();
  await page.getByRole('button', { name: 'Appartement' }).click();
  await expect(page.getByRole('heading', { name: 'Quelle nature de travaux ?' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Quel type de lieu ?' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Passer' }).click();
  await expect(page.getByRole('heading', { name: 'Quelle surface, si vous la connaissez ?' })).toBeVisible();
  await page.getByRole('button', { name: 'Je ne sais pas' }).click();
  await expect(page.getByLabel('Description libre')).toBeVisible();
  await expect(page.getByText('Vos réponses :')).toContainText('Appartement');
  const sizes = await page.locator('form button:visible').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().height));
  expect(Math.min(...sizes)).toBeGreaterThanOrEqual(43.5);
  await page.getByLabel('Description libre').fill('refaire la salle de bain et la cuisine');
  await page.getByRole('button', { name: 'Voir la proposition' }).click();
  await expect(page.getByText('Lots et ouvrages proposés')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'Recommencer' }).first().click();
});
