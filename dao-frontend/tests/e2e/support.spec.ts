import type { Page, Route } from '@playwright/test';
import { test, expect } from './support/fixtures';
import { login } from './support/flow';

// UI tests against an explicit in-test mock of support contract v1 (docs/messages-assistance.md), independent of
// whether the real routes (#271, DEV20) are deployed. Server behaviour is covered by DEV20's integration tests.
type Ticket = { id: string; reference: string; subject: string; category: string; status: string; project_id: null; created_at: string; updated_at: string; last_message_at: string; unread_count: number; assignee_label: string | null; requester_label?: string };
const now = '2026-10-19T08:00:00.000Z';
const ticket = (n: number, subject: string, extra: Partial<Ticket> = {}): Ticket => ({ id: `0000000${n}-0000-4000-8000-00000000000${n}`, reference: `AS-${n}`, subject, category: 'account', status: 'waiting_staff', project_id: null, created_at: now, updated_at: now, last_message_at: now, unread_count: 0, assignee_label: null, ...extra });

async function mockSupport(page: Page, staff: boolean) {
  const tickets = [ticket(1, 'Invitation introuvable', { unread_count: 1, requester_label: 'Client E2E' })];
  const messages: Record<string, { id: string; ticket_id: string; author_role: string; author_label: string; body: string; created_at: string }[]> = {
    [tickets[0].id]: [{ id: 'm1', ticket_id: tickets[0].id, author_role: 'requester', author_label: 'Vous', body: 'Je ne retrouve pas mon invitation.', created_at: now },
      { id: 'm2', ticket_id: tickets[0].id, author_role: 'staff', author_label: 'Équipe D.A.O.', body: 'Pouvez-vous vérifier vos courriers indésirables ?', created_at: now }],
  };
  const requests: { path: string; body: any }[] = [];
  await page.route('**/api/support/**', async (route: Route) => {
    const url = new URL(route.request().url()); const path = url.pathname.replace('/api/support/', ''); const method = route.request().method();
    const body = method === 'POST' ? route.request().postDataJSON() : null; requests.push({ path, body });
    const ok = (data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
    const find = (id: string) => tickets.find((item) => item.id === id)!;
    if (path === 'summary') return ok({ unread: tickets.filter((item) => item.unread_count > 0).length, open: tickets.length });
    if (path === 'tickets' && method === 'GET') return ok({ items: tickets, next_cursor: null, total: tickets.length });
    if (path === 'queue' && staff) return ok({ items: tickets, next_cursor: null, total: tickets.length });
    if (path === 'tickets' && method === 'POST') {
      const created = ticket(tickets.length + 1, body.subject, { category: body.category, status: 'open' }); tickets.unshift(created);
      messages[created.id] = [{ id: `m${Date.now()}`, ticket_id: created.id, author_role: 'requester', author_label: 'Vous', body: body.body, created_at: now }];
      return ok(created);
    }
    const [, id, action] = path.split('/');
    // Like the real get_support_ticket RPC, the detail carries no unread_count (#462).
    if (!action && method === 'GET') { const { unread_count: _unread, ...detail } = find(id); return ok({ ticket: detail, messages: messages[id] }); }
    if (action === 'messages') { const message = { id: `m${Date.now()}`, ticket_id: id, author_role: staff ? 'staff' : 'requester', author_label: staff ? 'Vous (D.A.O.)' : 'Vous', body: body.body, created_at: now }; messages[id].push(message); return ok(message); }
    if (action === 'read') { find(id).unread_count = 0; return ok({}); }
    if (action === 'assign' && staff) { find(id).assignee_label = 'Vous'; return ok(find(id)); }
    if (action === 'status' && staff) {
      if (['resolved', 'closed'].includes(body.status) && !body.reason) return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: 'invalid', code: 'invalid' }) });
      find(id).status = body.status; return ok(find(id));
    }
    return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'forbidden', code: 'forbidden' }) });
  });
  return requests;
}

test('Assistance : créer une demande avec consentement à la page d’origine, suivre et répondre', async ({ page, e2eClient }) => {
  test.skip(!e2eClient, 'E2E Supabase credentials are not available');
  await login(page, e2eClient!);
  // A temporary server failure (503 « unavailable ») is not presented as « not open yet »: it offers a retry.
  await page.route('**/api/support/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Assistance temporairement indisponible.', code: 'unavailable' }) }));
  await page.goto('/app/messages?onglet=assistance');
  await expect(page.getByRole('alert').filter({ hasText: 'momentanément indisponible' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Réessayer' })).toBeVisible();
  await expect(page.getByText(/pas encore ouverte/)).toHaveCount(0);
  await page.unroute('**/api/support/**');
  const requests = await mockSupport(page, false);
  await page.goto('/app/messages?onglet=assistance&nouvelle=1&origine=%2Fapp%2Fprojects');
  // Desktop sidebar: unread D.A.O. replies are flagged on the « Messages & Assistance » entry (mobile menu is closed).
  if (test.info().project.name !== 'mobile') await expect(page.getByRole('link', { name: /Messages & Assistance\s*1 réponse de D\.A\.O\. non lue/ })).toBeVisible();
  const form = page.getByRole('form', { name: 'Nouvelle demande à D.A.O.' });
  await form.getByRole('button', { name: 'Envoyer la demande' }).click();
  await expect(form.getByRole('alert')).toContainText('Indiquez un sujet');
  await form.getByLabel('Sujet').fill('Accès à mon chantier');
  await form.getByLabel('Catégorie').selectOption('project');
  await form.getByLabel('Votre message').fill('Je ne vois plus le lot électricité.');
  const consent = form.getByRole('checkbox', { name: /la page d’où je viens/ });
  await expect(consent).not.toBeChecked();
  await consent.check();
  await form.getByRole('button', { name: 'Envoyer la demande' }).click();
  await expect(page.getByRole('status')).toContainText('Demande AS-2 envoyée');
  const created = requests.find((request) => request.path === 'tickets' && request.body);
  expect(created!.body).toMatchObject({ subject: 'Accès à mon chantier', category: 'project', origin: { route: '/app/projects', faq_id: null } });
  expect(created!.body.idempotency_key).toMatch(/^ui-/);
  await expect(page.getByText('Je ne vois plus le lot électricité.', { exact: true })).toBeVisible();
  await page.getByLabel('Votre réponse').fill('Merci d’avance.');
  await page.getByRole('button', { name: 'Envoyer la réponse' }).click();
  await expect(page.getByText('Merci d’avance.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mes demandes' }).click();
  await expect(page.getByRole('button', { name: /Invitation introuvable/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Accès à mon chantier/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test('Assistance : lire la réponse D.A.O. efface les pastilles cloche et menu (#462)', async ({ page, e2eClient }) => {
  test.skip(!e2eClient, 'E2E Supabase credentials are not available');
  await login(page, e2eClient!);
  // Internal notifications isolated at zero: the bell then reflects only the Support reply.
  await page.route(/\/api\/notifications(\?|$)/, route => route.request().method() === 'GET'
    ? route.fulfill({ json: { data: { rows: [], workspace: 'client', unread_count: 0, next_cursor: null } } }) : route.fallback());
  const requests = await mockSupport(page, false);
  await page.goto('/app/messages?onglet=assistance');
  await expect(page.getByTestId('support-bell-count')).toHaveText('1');
  const desktop = test.info().project.name !== 'mobile';
  if (desktop) await expect(page.getByRole('link', { name: /Messages & Assistance\s*1 réponse de D\.A\.O\. non lue/ })).toBeVisible();
  await page.getByRole('button', { name: /Invitation introuvable/ }).click();
  await expect(page.getByText('Pouvez-vous vérifier vos courriers indésirables ?', { exact: true })).toBeVisible();
  await expect.poll(() => requests.some((request) => request.path.endsWith('/read'))).toBe(true);
  // Same route, no reload: both badges disappear as soon as the read is recorded.
  await expect(page.getByTestId('support-bell-count')).toHaveCount(0);
  if (desktop) await expect(page.getByRole('link', { name: /réponse de D\.A\.O\. non lue/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Mes demandes' }).click();
  await expect(page.getByRole('button', { name: /Invitation introuvable/ }).getByLabel(/non lu/)).toHaveCount(0);
});

test('Assistance staff : file, attribution, réponse et résolution motivée', async ({ page, e2eAdmin }) => {
  test.skip(!e2eAdmin, 'E2E Supabase credentials are not available');
  await login(page, e2eAdmin!);
  // Route not deployed (simulated 404 without code): the queue says so honestly instead of showing an empty list.
  await page.route('**/api/support/**', route => route.fulfill({ status: 404, contentType: 'text/html', body: 'Not Found' }));
  await page.goto('/app/dao/support');
  await expect(page.getByRole('heading', { name: 'File d’assistance pas encore ouverte' })).toBeVisible();
  await page.unroute('**/api/support/**');
  await mockSupport(page, true);
  await page.getByRole('button', { name: 'Vérifier à nouveau' }).click();
  await page.getByRole('button', { name: /Invitation introuvable/ }).click();
  await expect(page.getByText('Pouvez-vous vérifier vos courriers indésirables ?', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Me l’attribuer' }).click();
  await expect(page.getByText('Attribuée à Vous', { exact: true })).toBeVisible();
  await page.getByLabel('Votre réponse').fill('Invitation renvoyée.');
  await page.getByRole('button', { name: 'Envoyer la réponse' }).click();
  await expect(page.getByText('Invitation renvoyée.', { exact: true })).toBeVisible();
  const status = page.getByRole('form', { name: 'Statut de la demande' });
  await status.getByLabel('Statut').selectOption('resolved');
  await status.getByRole('button', { name: 'Mettre à jour' }).click();
  await expect(status.getByRole('alert')).toContainText('Un motif');
  await status.getByLabel('Motif (visible par le demandeur)').fill('Invitation renvoyée au bon e-mail.');
  await status.getByRole('button', { name: 'Mettre à jour' }).click();
  await expect(page.getByText('Attribuée à Vous', { exact: true }).locator('xpath=../..').getByText('Résolue', { exact: true })).toBeVisible();
});
