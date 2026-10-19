import { randomUUID } from 'node:crypto';
import { test, expect } from './support/fixtures';
import { login } from './support/flow';

// Real end-to-end path on the disposable Supabase stack: Client creates a support request, staff takes it,
// answers and resolves it, the Client reads the answer. No mock. Skipped while the support routes (#271) are absent.
test('Assistance réelle : demande Client, prise en charge staff, réponse lue par le Client', async ({ page, browser, e2eClient, e2eAdmin }) => {
  test.skip(!e2eClient || !e2eAdmin, 'E2E Supabase credentials are not available');
  const subject = `Demande E2E ${randomUUID().slice(0, 8)}`;
  const question = `Question réelle ${subject}`;
  const answer = `Réponse staff ${subject}`;

  await login(page, e2eClient!);
  await page.goto('/app/messages?onglet=assistance');
  const create = page.getByRole('button', { name: 'Nouvelle demande' });
  const notOpen = page.getByText(/pas encore ouverte/);
  await expect(create.or(notOpen)).toBeVisible();
  test.skip(await notOpen.isVisible(), 'Support routes are not deployed on this stack');

  await create.click();
  const form = page.getByRole('form', { name: 'Nouvelle demande à D.A.O.' });
  await form.getByLabel('Sujet').fill(subject);
  await form.getByLabel('Catégorie').selectOption('technical');
  await form.getByLabel('Votre message').fill(question);
  await form.getByRole('button', { name: 'Envoyer la demande' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'envoyée' })).toBeVisible();
  await expect(page.getByText(question, { exact: true })).toBeVisible();

  const staffContext = await browser.newContext();
  const staff = await staffContext.newPage();
  await login(staff, e2eAdmin!);
  await staff.goto('/app/dao/support');
  await staff.getByRole('button', { name: new RegExp(subject) }).click();
  await expect(staff.getByText(question, { exact: true })).toBeVisible();
  // The staff view never exposes project conversations, only this request.
  await staff.getByRole('button', { name: 'Me l’attribuer' }).click();
  await expect(staff.getByText(/^Attribuée à /)).toBeVisible();
  await staff.getByLabel('Votre réponse').fill(answer);
  await staff.getByRole('button', { name: 'Envoyer la réponse' }).click();
  await expect(staff.getByText(answer, { exact: true })).toBeVisible();
  const status = staff.getByRole('form', { name: 'Statut de la demande' });
  await status.getByLabel('Statut').selectOption('resolved');
  await status.getByLabel('Motif (visible par le demandeur)').fill('Question traitée en E2E.');
  await status.getByRole('button', { name: 'Mettre à jour' }).click();
  await expect(staff.getByText(/^Attribuée à /).locator('xpath=../..').getByText('Résolue', { exact: true })).toBeVisible();
  await staffContext.close();

  await page.goto('/app/messages?onglet=assistance');
  const row = page.getByRole('button', { name: new RegExp(subject) });
  await expect(row).toContainText('Résolue');
  await row.click();
  await expect(page.getByText(answer, { exact: true })).toBeVisible();
});
