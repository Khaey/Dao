import { test, expect } from './support/fixtures';
import { login } from './support/flow';
import { recordE2EValue } from './support/state';

const VILLA = 'Villa R+1 à Sousse : terrain 206 m², construit total 180 m², 2 chambres à l’étage, garage 1 voiture, cuisine séparée, 2 salles de bain, jardin et terrasse si possible, sans piscine, budget inconnu, plans et études absents.';

test('Assistant BTP : description libre → proposition immédiate → corrections → chantier créé (réel)', async ({ page, e2eClient }, testInfo) => {
  test.skip(!e2eClient, 'E2E Supabase credentials are not available');
  await login(page, e2eClient!);
  await page.goto('/app/projects/new');
  await page.getByRole('link', { name: /Décrire mon projet à l’assistant/ }).click();
  await expect(page.getByRole('heading', { name: 'Décrivez votre projet', level: 1 })).toBeVisible();

  // Description libre : aucune question préalable, proposition immédiate.
  await page.getByLabel('Description libre').fill(VILLA);
  await page.getByRole('button', { name: 'Voir la proposition' }).click();
  await expect(page.getByRole('heading', { name: /Construction d’une villa/, level: 1 })).toBeVisible();
  await expect(page.getByText('Référentiel provisoire (données de démonstration)', { exact: false })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Fondations selon l’étude de sol/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Garage/ }).first()).toBeChecked();
  await expect(page.getByText('206 m²')).toBeVisible();
  await expect(page.getByText(/Aucun prix ni budget n’est calculé/)).toBeVisible();
  await expect(page.locator('main')).not.toContainText(/\bTND\b|millimes/);
  await expect(page.getByRole('heading', { name: /S’agit-il|Quelles pièces/ })).toHaveCount(0);

  // Correction en langage naturel, choix précédents conservés.
  await page.getByLabel('Modifier avec vos mots').fill('retire le garage et ajoute une clôture');
  await page.getByRole('button', { name: 'Appliquer' }).click();
  await expect(page.getByText(/sans perdre vos choix précédents/)).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Clôture et mur de clôture/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /^Garage/ })).toHaveCount(0);
  await page.getByLabel('Modifier avec vos mots').fill('ajoute un héliport');
  await page.getByRole('button', { name: 'Appliquer' }).click();
  await expect(page.getByText(/Rien n’a été inventé/)).toBeVisible();

  // Reprise du brouillon persisté après rechargement.
  await page.reload();
  await expect(page.getByText(/Brouillon en cours/)).toBeVisible();
  await page.getByRole('button', { name: 'Reprendre' }).click();
  await expect(page.getByRole('checkbox', { name: /Clôture et mur de clôture/ })).toBeChecked();

  // Création : gouvernorat requis, puis chantier brouillon persistant.
  await page.getByLabel('Gouvernorat').selectOption({ label: 'Gouvernorat E2E' });
  await expect(page.getByText('Gouvernorat enregistré.')).toBeVisible();
  await page.getByRole('button', { name: 'Créer mon chantier' }).click();
  await expect(page).toHaveURL(/\/app\/projects\/[0-9a-f-]{36}$/);
  const projectId = page.url().split('/').pop()!;
  recordE2EValue(testInfo, 'projects', projectId);
  await expect(page.getByText('Plomberie et sanitaires').first()).toBeVisible();
  await expect(page.getByText('Aménagements extérieurs').first()).toBeVisible();

  // Le brouillon transformé n'est plus proposé à la reprise (pas de doublon).
  await page.goto('/app/projects/new/assistant');
  await expect(page.getByRole('heading', { name: 'Décrivez votre projet', level: 1 })).toBeVisible();
  await expect(page.getByText(/Brouillon en cours/)).toHaveCount(0);
});
