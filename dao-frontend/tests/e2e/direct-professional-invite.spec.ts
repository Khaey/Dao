import { test, expect } from './support/fixtures';
import { login } from './support/flow';

// Direct invitation UI: server invitation lifecycle and Resend transport are tested separately.
// Keep one-time invite tokens out of screenshots/traces.
test.use({ trace: 'off', screenshot: 'off' });

test('Fiche Artisan : invitation contextualisée envoyée, reprise sur le même lien après erreur', async ({ page, e2eClient }) => {
  test.skip(!e2eClient, 'Client E2E unavailable');
  await login(page, e2eClient!);
  const professionalId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const projectId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
  const requestId = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3';
  const recipientEmail = 'artisan-test@example.invalid';
  await page.route('**/api/professionals?*', async route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ data: { id: professionalId, name: 'Atelier invitation E2E', verification_status: 'verified', professional_email: recipientEmail, portfolio: [], trades: [], areas: [] } }),
  }));
  let creates = 0;
  await page.route('**/api/projects/invitations', async route => {
    const input = route.request().postDataJSON();
    expect(input).toMatchObject({
      project_id: projectId, request_id: requestId,
      expected_role: 'contractor', recipient_name: 'Atelier invitation E2E',
      recipient_email: recipientEmail, can_view_private_details: false,
    });
    creates++;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: {
      id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd4',
      token: 'a'.repeat(64),
    } }) });
  });
  let sends = 0;
  await page.route('**/api/project-invitations/*/send-email', async route => {
    expect(Object.keys(route.request().postDataJSON())).toEqual(['token']);
    sends++;
    await route.fulfill({
      status: sends === 1 ? 502 : 200, contentType: 'application/json',
      body: JSON.stringify(sends === 1 ? { error: 'Envoi temporairement indisponible' } : { data: { sent: true, recipient_masked: 'a***@example.invalid' } }),
    });
  });
  await page.goto(`/app/professionals/${professionalId}?project_id=${projectId}&request_id=${requestId}`);
  const send = page.getByRole('button', { name: 'Envoyer une invitation à cet Artisan' });
  await expect(send).toBeVisible();
  expect(creates).toBe(0); expect(sends).toBe(0);
  page.once('dialog', dialog => dialog.accept());
  await send.click();
  await expect(page.getByRole('alert').filter({ hasText: "L'invitation n'a pas pu être envoyée" })).toBeVisible();
  expect(creates).toBe(1); expect(sends).toBe(1);
  page.once('dialog', dialog => dialog.accept());
  await send.click();
  await expect(page.getByRole('status').filter({ hasText: 'Invitation envoyée' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Invitation envoyée ✓' })).toBeDisabled();
  expect(creates).toBe(1); expect(sends).toBe(2);
});
