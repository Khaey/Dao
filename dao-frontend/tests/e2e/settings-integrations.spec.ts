import type { Page, Route } from '@playwright/test';
import { test, expect } from './support/fixtures';
import { login } from './support/flow';

// #515 — interface Admin « Intégrations & API ». Le backend (#505, DEV 4) n'est pas encore livré :
// ces tests isolent l'UI avec des réponses RPC simulées au niveau réseau, sans rien afficher de fictif sur DEV.
const overview = {
  contract_version: 'provider-integrations.v1', registry_version: 3, markets: ['TN'], legal_entities: [{ id: 'dao-tn', label: 'D.A.O. Tunisie' }],
  categories: [
    { key: 'signature', label: 'Signature électronique', sensitive: true, capabilities: [{ key: 'signature.simple', label: 'Signature simple' }] },
    { key: 'maps', label: 'Cartes', sensitive: false, capabilities: [{ key: 'maps.display', label: 'Carte' }, { key: 'maps.geocode', label: 'Géocodage' }] },
  ],
  connectors: [
    { provider_id: 'dropbox_sign', manifest_version: '1', label: 'Dropbox Sign', category: 'signature', status: 'installed', adapter_version: '1.0.0', countries: ['TN'], capabilities: ['signature.simple'],
      environments: ['sandbox'], auth_modes: ['api_key'], live_locked: true, connection_check_supported: false, fields: [{ key: 'api_key', label: 'Clé API', required: true, type: 'text', secret: true }] },
    { provider_id: 'ngsign', manifest_version: '1', label: 'NGSIGN', category: 'signature', status: 'candidate', adapter_version: null, countries: ['TN'], capabilities: [], environments: [],
      auth_modes: [], live_locked: true, connection_check_supported: false, fields: [] },
    { provider_id: 'mapbox', manifest_version: '1', label: 'Mapbox', category: 'maps', status: 'installed', adapter_version: '0.1.0', countries: ['TN'], capabilities: ['maps.display', 'maps.geocode'],
      environments: ['sandbox', 'live'], auth_modes: ['api_key'], live_locked: false, connection_check_supported: true, fields: [{ key: 'style', label: 'Style', required: true, type: 'enum', options: ['streets'], secret: false },
        { key: 'token', label: 'Jeton', required: true, type: 'text', secret: true }] },
  ],
  connections: [
    { id: 'c-sign-1', provider_id: 'dropbox_sign', alias: 'Dropbox Sign test', category: 'signature', country: 'TN', legal_entity_id: 'dao-tn', environment: 'sandbox', state: 'verified',
      params: {}, secrets: [{ key: 'api_key', present: true, rotated_at: '2026-10-26T10:00:00Z' }], last_check: { status: 'verified', at: '2026-10-26T10:05:00Z', reason: null }, version: 2 },
  ],
  policies: [],
};

async function openIntegrations(page: Page, handler: (route: Route) => Promise<void> | void) {
  await page.route('**/rest/v1/rpc/admin_integrations_overview', handler);
  await page.goto('/app/dao/settings');
  await page.getByRole('button', { name: 'Intégrations & API', exact: true }).click();
}

test('Intégrations Admin : statuts honnêtes, défaut et secret jamais relu', async ({ page, e2eAdmin }) => {
  await login(page, e2eAdmin!);
  const commands: Array<Record<string, any>> = [];
  await page.route('**/rest/v1/rpc/admin_integration_command', async route => {
    commands.push(route.request().postDataJSON()); await route.fulfill({ json: { version: 4 } });
  });
  await openIntegrations(page, route => route.fulfill({ json: overview }));
  const main = page.getByRole('main');
  await expect(main.getByText('Candidat · non installé')).toBeVisible();
  await expect(main.getByText('Vérifié', { exact: true })).toBeVisible();
  await expect(main.getByText(/api_key : enregistré/)).toBeVisible();
  await expect(main.getByText('Adaptateur à développer et publier avant toute connexion.')).toBeVisible();
  // Pas de contrôle fournisseur réel : aucun bouton « Tester », donc aucun PASS simulé.
  await expect(main.getByText('Test réel non disponible')).toBeVisible();
  await expect(main.getByRole('button', { name: 'Tester' })).toHaveCount(0);

  await main.getByLabel('Défaut pour Signature simple').selectOption('c-sign-1');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Confirmer' })).toBeDisabled();
  await dialog.getByLabel('Motif (obligatoire)').fill('Recette E2E défaut signature test');
  await dialog.getByRole('button', { name: 'Confirmer' }).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({ p_action: 'set_default', p_input: { capability: 'signature.simple', connection_id: 'c-sign-1', environment: 'sandbox', expected_version: null } });
  expect(commands[0].p_idempotency_key).toMatch(/^[0-9a-f-]{36}$/);

  // Réel : catégorie sensible verrouillée, aucun défaut sélectionnable.
  await main.getByLabel('Environnement').selectOption('live');
  await expect(main.getByText(/Mode réel verrouillé/)).toBeVisible();
  await expect(main.getByLabel('Défaut pour Signature simple')).toBeDisabled();
  expect(await page.content()).not.toContain('sk_');
});

test('Intégrations Admin : formulaire généré depuis le manifeste', async ({ page, e2eAdmin }) => {
  await login(page, e2eAdmin!);
  const commands: Array<Record<string, any>> = [];
  await page.route('**/rest/v1/rpc/admin_integration_command', async route => {
    commands.push(route.request().postDataJSON()); await route.fulfill({ json: { version: 1, connection_id: 'c-map-1' } });
  });
  const secrets: Array<Record<string, unknown>> = [];
  await page.route('**/functions/v1/integration-secret', async route => { secrets.push(route.request().postDataJSON()); await route.fulfill({ json: { present: true, rotated_at: '2026-10-27T00:00:00Z' } }); });
  await openIntegrations(page, route => route.fulfill({ json: overview }));
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Cartes', exact: true }).click();
  await main.getByRole('button', { name: 'Ajouter une connexion' }).click();
  await expect(main.getByRole('button', { name: 'Continuer' })).toBeDisabled();
  await main.getByLabel(/Style/).selectOption('streets');
  await main.getByLabel('Jeton').fill('valeur-de-test-e2e');
  await main.getByRole('button', { name: 'Continuer' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Motif (obligatoire)').fill('Recette E2E connexion carte');
  await dialog.getByRole('button', { name: 'Confirmer' }).click();
  await expect.poll(() => secrets.length).toBe(1);
  // Le secret ne part jamais dans la commande RPC, seulement vers la fonction serveur.
  expect(JSON.stringify(commands[0])).not.toContain('valeur-de-test-e2e');
  expect(commands[0]).toMatchObject({ p_action: 'create_connection', p_input: { provider_id: 'mapbox', params: { style: 'streets' } } });
  expect(secrets[0]).toMatchObject({ connection_id: 'c-map-1', key: 'token' });
});

test('Intégrations Admin : service non déployé affiché honnêtement', async ({ page, e2eAdmin }) => {
  await login(page, e2eAdmin!);
  await openIntegrations(page, route => route.fulfill({ status: 404, json: { code: 'PGRST202', message: 'Could not find the function' } }));
  await expect(page.getByRole('main').getByText(/pas encore disponible sur cet environnement/)).toBeVisible();
  await expect(page.getByRole('main').getByText('Candidat · non installé')).toHaveCount(0);
});

test('Intégrations Admin : version de contrat inconnue jamais interprétée', async ({ page, e2eAdmin }) => {
  await login(page, e2eAdmin!);
  await openIntegrations(page, route => route.fulfill({ json: { ...overview, contract_version: 'provider-integrations.v2' } }));
  await expect(page.getByRole('main').getByRole('alert').filter({ hasText: /Version de contrat inattendue/ })).toBeVisible();
  await expect(page.getByRole('main').getByText('Dropbox Sign test')).toHaveCount(0);
});
