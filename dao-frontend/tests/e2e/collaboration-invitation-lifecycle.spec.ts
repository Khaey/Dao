import { test, expect } from './support/fixtures';
import { login } from './support/flow';
import { actorCommand, adminRows, createCollaborative, signOut } from './support/collaboration';

test('Invitation : rôle incompatible, valeurs internes rejetées et isolation d’un autre client', async ({ page, e2eClient, e2eArtisan, e2eOtherClient }, info) => {
  test.skip(!e2eClient || !e2eArtisan || !e2eOtherClient, 'Disposable E2E credentials are not available');
  await login(page, e2eClient!);
  const project = await createCollaborative(page, info, false, e2eArtisan!.email);
  for (const expected_role of ['dao_admin', 'dao_reviewer', 'internal']) {
    const response = await actorCommand(page, e2eClient!, '/api/projects/invitations', { project_id: project.projectId, expected_role });
    expect(response.status()).toBe(400);
  }
  await page.goto(project.link);
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Cette invitation nécessite un compte Artisan / Entreprise');
  await expect(page.getByRole('button', { name: 'Confirmer et rejoindre le chantier' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Se connecter avec un autre compte' }).click();
  await expect(page).toHaveURL(/\/auth\/login/);
  await login(page, e2eOtherClient!);
  await page.goto('/app/projects');
  await expect(page.getByText(project.title, { exact: true })).toHaveCount(0);
  await page.goto(`/app/projects/${project.projectId}`);
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Projet inaccessible');
  const response = await actorCommand(page, e2eOtherClient!, '/api/projects/invitations/respond', { token: new URL(project.link).pathname.split('/').pop(), accept: true });
  expect(response.status()).toBe(403);
  expect(await adminRows('project_members', `project_id=eq.${project.projectId}&user_id=eq.${e2eOtherClient!.id}&select=id`)).toHaveLength(0);
});

test('Invitation révoquée : lien inutilisable, puis nouvelle invitation refusée', async ({ page, e2eClient, e2eArtisan }, info) => {
  test.skip(!e2eClient || !e2eArtisan, 'Disposable E2E credentials are not available');
  await login(page, e2eClient!);
  const project = await createCollaborative(page, info, false, e2eArtisan!.email);
  await page.getByRole('button', { name: 'Révoquer l’invitation' }).click();
  await expect(page.getByText('Révoquée', { exact: true })).toBeVisible();
  await page.goto(project.link);
  await expect(page.getByRole('heading', { name: 'Invitation indisponible' })).toBeVisible();
  const response = await actorCommand(page, e2eArtisan!, '/api/projects/invitations/respond', { token: new URL(project.link).pathname.split('/').pop(), accept: true });
  expect(response.status()).toBe(409);
  await page.goto(`/app/projects/${project.projectId}?tab=team`);
  await page.getByLabel('Nom du destinataire').fill('Artisan réinvité E2E');
  await page.getByLabel('Lot principal de l’invitation').selectOption({ index: 1 });
  await page.getByLabel('Email du destinataire — optionnel').fill(e2eArtisan!.email);
  await page.getByRole('button', { name: 'Préparer l’invitation', exact: true }).click();
  await expect(page.getByLabel('Lien d’invitation')).toBeVisible();
  const newLink = await page.getByLabel('Lien d’invitation').inputValue();
  await signOut(page);
  await login(page, e2eArtisan!);
  await page.goto('/app/invitations');
  const inboxCard=page.getByRole('heading',{name:project.title,exact:true}).locator('xpath=../..');
  await expect(inboxCard.getByText('À traiter',{exact:true})).toBeVisible();
  await inboxCard.getByRole('button',{name:'Refuser',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Invitation refusée');
  await expect(page.getByRole('heading',{name:project.title,exact:true}).locator('xpath=../..').getByText('Refusée',{exact:true})).toBeVisible();
  await page.goto(newLink);
  await expect(page.getByRole('heading', { name: 'Invitation indisponible' })).toBeVisible();
  expect(await adminRows('project_members', `project_id=eq.${project.projectId}&user_id=eq.${e2eArtisan!.id}&select=id`)).toHaveLength(0);
  expect((await adminRows('project_invitations', `project_id=eq.${project.projectId}&select=status`)).map(row => row.status).sort()).toEqual(['declined', 'revoked']);
});
