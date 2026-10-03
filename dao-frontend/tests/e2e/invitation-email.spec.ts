import { test, expect } from './support/fixtures';
import { login } from './support/flow';
import { adminRows, createCollaborative } from './support/collaboration';
import type { Page } from '@playwright/test';

// The one-time token exists in this screen and its POST body. Do not persist it
// in browser traces, automatic screenshots or assertion values.
test.use({ trace: 'off', screenshot: 'off' });
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus && !page.isClosed()) {
    await page.getByLabel('Lien d’invitation').evaluateAll(inputs => inputs.forEach(input => {
      (input as HTMLInputElement).value = '[lien masqué]'; input.setAttribute('value', '[lien masqué]');
    }));
    await page.screenshot({ path: info.outputPath('email-ui-redacted.png'), mask: [page.getByLabel('Lien d’invitation')] });
  }
});

async function fitsViewport(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  const button = page.getByRole('button', { name: /Envoyer par e-mail|Envoi…|Invitation envoyée/ });
  await button.scrollIntoViewIfNeeded(); await expect(button).toBeInViewport();
  const box = await button.boundingBox(); expect(Boolean(box && box.height >= 40)).toBe(true);
}
async function snapshot(projectId: string) {
  return JSON.stringify(await adminRows('project_invitations', `project_id=eq.${projectId}&select=id,status,token_hash,expires_at&order=id`));
}

test('Email client : envoi en cours, erreur propre, retry du même lien et succès sans mutation', async ({ page, context, e2eClient, e2eArtisan }, info) => {
  test.skip(!e2eClient || !e2eArtisan, 'Disposable E2E credentials are not available');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await login(page, e2eClient!);
  const project = await createCollaborative(page, info, false, e2eArtisan!.email, true);
  const before = await snapshot(project.projectId);
  const token = new URL(project.link).pathname.split('/').pop();
  let attempts = 0;
  let firstRequested!: () => void;
  const firstRequest = new Promise<void>(resolve => { firstRequested = resolve; });
  let releaseFirst!: () => void;
  const firstResponse = new Promise<void>(resolve => { releaseFirst = resolve; });
  await page.route('**/api/project-invitations/*/send-email', async route => {
    const body = route.request().postDataJSON();
    expect(Object.keys(body)).toEqual(['token']); expect(body.token === token).toBe(true);
    attempts++;
    if (attempts === 1) {
      firstRequested();
      await firstResponse;
      await route.fulfill({ status: 502, json: { error: 'Provider failure fixture' } });
    } else await route.fulfill({ status: 200, json: { data: { sent: true, recipient_masked: 'a***@logiclab.invalid' } } });
  });
  await fitsViewport(page);
  await page.getByRole('button', { name: 'Envoyer par e-mail', exact: true }).click();
  await firstRequest;
  await expect(page.getByRole('button', { name: 'Envoi…', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Copier le lien', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Copier le lien', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lien copié', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Envoi…', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  expect(attempts).toBe(1);
  releaseFirst();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText("L'invitation n'a pas pu être envoyée. Vous pouvez réessayer ou copier le lien.");
  await expect(page.getByRole('button', { name: 'Envoyer par e-mail', exact: true })).toBeEnabled();
  expect((await page.getByLabel('Lien d’invitation').inputValue()) === project.link).toBe(true);
  expect((await snapshot(project.projectId)) === before).toBe(true);
  await page.getByRole('button', { name: 'Envoyer par e-mail', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Invitation envoyée ✓', exact: true })).toBeDisabled();
  await expect(page.getByRole('status').filter({ hasText: 'Invitation envoyée à' })).toHaveText('Invitation envoyée à a***@logiclab.invalid');
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0); expect(attempts).toBe(2);
  await expect(page.getByRole('button', { name: 'Lien copié', exact: true })).toBeEnabled();
  expect((await snapshot(project.projectId)) === before).toBe(true);
  await fitsViewport(page);
  await page.getByRole('link', { name: 'Ouvrir le chantier', exact: true }).click();
  await expect(page.getByRole('heading', { name: project.title, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Envoyer par e-mail|Invitation envoyée/ })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: project.title, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Envoyer par e-mail|Invitation envoyée/ })).toHaveCount(0);
});

test('Email artisan : absence d’adresse explicite, invitation depuis Équipe et aucun renvoi après navigation', async ({ page, e2eArtisan, e2eClient }, info) => {
  test.skip(!e2eClient || !e2eArtisan, 'Disposable E2E credentials are not available');
  await login(page, e2eArtisan!);
  const project = await createCollaborative(page, info, true, '', true);
  await expect(page.getByRole('button', { name: 'Envoyer par e-mail', exact: true })).toBeDisabled();
  await expect(page.getByText('Aucune adresse e-mail renseignée. Copiez le lien pour transmettre l’invitation.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copier le lien', exact: true })).toBeEnabled();
  await fitsViewport(page);
  await page.getByRole('link', { name: 'Ouvrir le chantier', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Équipe du chantier', exact: true })).toBeVisible();
  // An explicit existing revoke action precedes a new invitation with an email;
  // sending itself must not perform either mutation.
  await page.getByRole('button', { name: 'Révoquer l’invitation', exact: true }).click();
  await expect(page.getByLabel('Email du destinataire — optionnel')).toBeVisible();
  await page.getByLabel('Nom du destinataire').fill('Client E2E invité');
  await page.getByLabel('Email du destinataire — optionnel').fill(e2eClient!.email);
  await page.getByRole('button', { name: 'Préparer l’invitation', exact: true }).click();
  await expect(page.getByLabel('Lien d’invitation')).toBeVisible();
  const before = await snapshot(project.projectId);
  let sends = 0;
  await page.route('**/api/project-invitations/*/send-email', async route => {
    expect(Object.keys(route.request().postDataJSON())).toEqual(['token']); sends++;
    await route.fulfill({ status: 200, json: { data: { sent: true, recipient_masked: 'c***@logiclab.invalid' } } });
  });
  await page.getByRole('button', { name: 'Envoyer par e-mail', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Invitation envoyée ✓', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Copier le lien', exact: true })).toBeEnabled();
  expect(sends).toBe(1); expect((await snapshot(project.projectId)) === before).toBe(true);
  expect(await adminRows('projects', `id=eq.${project.projectId}&select=client_id,initiator_id`)).toEqual([{ client_id: null, initiator_id: e2eArtisan!.id }]);
  expect((await adminRows('user_roles', `user_id=eq.${e2eArtisan!.id}&select=role`)).map(row => row.role)).toEqual(['contractor']);
  await fitsViewport(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Équipe du chantier', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Envoyer par e-mail|Invitation envoyée/ })).toHaveCount(0);
  await expect(page.getByLabel('Lien d’invitation')).toHaveCount(0);
});
