import { randomUUID } from 'node:crypto';
import { test, expect } from './support/fixtures';
import { createProjectWithMainLot, login } from './support/flow';
import { actorCommand, adminInsert, adminPatch, adminRows, approveDocument, signOut } from './support/collaboration';

test('Carnet d’exécution : lot attribué, intervention justifiée et observation Client', async ({ page, browser, e2eClient, e2eArtisan, e2eSecondArtisan }, testInfo) => {
  test.skip(!e2eClient || !e2eArtisan || !e2eSecondArtisan, 'E2E Supabase credentials are not available');
  await login(page, e2eClient!);
  const project = await createProjectWithMainLot(page, testInfo, 'site-execution', 'Pose et essais du réseau.', 'Lot plomberie carnet E2E');

  await page.getByRole('button', { name: 'Suivi du chantier', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Suivi du chantier' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Carnet de chantier' })).toBeVisible();
  await expect(page.getByText('Aucun lot attribué accessible')).toBeVisible();

  const request = (await adminRows('project_requests', `project_id=eq.${project.projectId}&select=id`))[0];
  const requestVersion = (await adminRows('project_request_versions', `request_id=eq.${request.id}&select=id`))[0];
  const contractor = (await adminRows('contractor_profiles', `user_id=eq.${e2eArtisan!.id}&select=id`))[0];
  await adminInsert('project_members', { project_id: project.projectId, user_id: e2eArtisan!.id, participation_role: 'contractor', status: 'accepted' });
  await adminPatch('profiles', `user_id=eq.${e2eArtisan!.id}`, { last_workspace: 'contractor' });
  const bid = (await adminInsert('bids', { project_id: project.projectId, contractor_id: contractor.id }))[0];
  const bidVersion = (await adminInsert('bid_versions', { bid_id: bid.id, project_id: project.projectId, contractor_id: contractor.id, version_no: 1, status: 'draft', validity: 'current', expires_at: '2099-01-01' }))[0];
  const bidItem = (await adminInsert('bid_items', { bid_version_id: bidVersion.id, project_id: project.projectId, contractor_id: contractor.id, request_version_id: requestVersion.id, request_id: request.id, price_millimes: 1500000, duration_days: 7, inclusions: 'Pose et essais' }))[0];
  await adminPatch('bid_versions', `id=eq.${bidVersion.id}`, { status: 'submitted', submitted_at: new Date().toISOString() });
  const award = (await adminInsert('awards', { project_id: project.projectId, contractor_id: contractor.id, status: 'confirmed' }))[0];
  const awardItem = (await adminInsert('award_items', { award_id: award.id, project_id: project.projectId, contractor_id: contractor.id, request_id: request.id, bid_item_id: bidItem.id, agreed_millimes: 1500000, active: true }))[0];
  await adminPatch('project_requests', `id=eq.${request.id}`, { status: 'awarded' });

  await signOut(page);
  await login(page, e2eArtisan!);
  await page.goto(`/app/projects/${project.projectId}`);
  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  await page.getByLabel('Partage du nouveau document').selectOption('project_members');
  await page.getByLabel('Ajouter un document').setInputFiles({ name: 'preuve-intervention.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('image-e2e') });
  await expect(page.getByText('preuve-intervention.jpg', { exact: true }).last()).toBeVisible();
  const document = (await adminRows('documents', `project_id=eq.${project.projectId}&original_name=eq.preuve-intervention.jpg&select=id`))[0];
  await approveDocument(document.id);
  await page.reload();
  await page.getByRole('button', { name: 'Suivi du chantier', exact: true }).click();
  await expect(page.getByText('Votre lot', { exact: true })).toBeVisible();
  const intervention = page.locator('details').filter({ hasText: 'Consigner une intervention' });
  await intervention.locator('summary').click();
  await intervention.getByLabel('Rapport court').fill('Pose du réseau principal et contrôle visuel.');
  await intervention.getByLabel('Progression après intervention — facultatif').fill('45');
  await intervention.getByText('preuve-intervention.jpg', { exact: true }).click();
  await intervention.getByRole('button', { name: 'Ajouter l’intervention' }).click();
  await expect(page.getByRole('status')).toContainText('Intervention ajoutée');
  await expect(page.getByText('Pose du réseau principal et contrôle visuel.', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('preuve-intervention.jpg', { exact: true }).last()).toBeVisible();

  const denied = await actorCommand(page, e2eSecondArtisan!, '/api/projects/execution', { kind: 'progress', award_item_id: awardItem.id, status: 'in_progress', percent: 50, reason: 'Tentative concurrente', document_ids: [], idempotency_key: randomUUID() });
  expect(denied.status()).toBe(403);

  const clientContext = await browser.newContext({ viewport: testInfo.project.name === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 } });
  const client = await clientContext.newPage();
  await login(client, e2eClient!);
  await client.goto(`/app/projects/${project.projectId}?tab=tracking`);
  await expect(client.getByText('Pose du réseau principal et contrôle visuel.', { exact: true })).toBeVisible();
  const event = client.locator('li').filter({ hasText: 'Pose du réseau principal et contrôle visuel.' }).first();
  await event.locator('summary').filter({ hasText: 'Ajouter une observation Client' }).click();
  await event.getByLabel('Retour').selectOption('disputed');
  await event.getByLabel(/Motif/).fill('Merci d’ajouter une photo du raccord final.');
  await event.getByRole('button', { name: 'Enregistrer le retour' }).click();
  await expect(client.getByRole('status')).toContainText('Contestation enregistrée');
  await expect(event.getByText('Observation Client', { exact: true }).locator('..')).toContainText('Merci d’ajouter une photo du raccord final.');
  expect(await client.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  await clientContext.close();

  await page.reload();
  await page.getByRole('button', { name: 'Suivi du chantier', exact: true }).click();
  const artisanEvent = page.locator('li').filter({ hasText: 'Pose du réseau principal et contrôle visuel.' }).first();
  await expect(artisanEvent.getByText('Observation Client', { exact: true }).locator('..')).toContainText('Merci d’ajouter une photo du raccord final.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});
