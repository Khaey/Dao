import type { Page, Route } from '@playwright/test';
import { test, expect } from './support/fixtures';
import { login } from './support/flow';

// #346 B1 — « Conditions et calendrier » UI. The backend (#345, DEV 2) is not delivered yet: these tests drive the UI
// against an EXPLICIT in-test mock of the proposed DTO. They are UI evidence only, never proof of integration.
const awardId = '00000000-0000-4000-8000-000000000346';
const at = (minute: number) => `2026-10-20T19:${String(minute).padStart(2, '0')}:00.000Z`;
const terms = (extra: Record<string, unknown> = {}) => ({ mode: 'simple', start_date: null, end_date: null, duration_days: null, conditions: null, payment: { frequency: 'unspecified', note: null }, sub_lots: [], ...extra });

type Version = { id: string; version_no: number; content_hash: string; author_role: string; status: string; created_at: string; terms: any; acceptances: any[]; rejection: any };
function mockServer() {
  const state = { versions: [] as Version[], draft: null as Version | null, events: [] as any[], agreed: null as string | null, conflictOnce: false };
  const current = () => [...state.versions].sort((a, b) => b.version_no - a.version_no)[0] ?? null;
  const view = () => {
    const latest = current();
    const pendingForClient = !!latest && latest.status === 'sent' && !latest.acceptances.some(row => row.party_role === 'client');
    return {
      award_id: awardId, contract_id: null, viewer_role: 'client', total_millimes: 12_500_000,
      lots: [{ request_id: 'lot-1', title: 'Lot menuiserie démo', agreed_millimes: 12_500_000, sub_lots: [{ id: 'sub-1', title: 'Pose des cadres' }] }],
      draft: state.draft, current: latest, agreed_version_id: state.agreed, versions: state.versions, events: state.events,
      can: { save_draft: !state.agreed, send: !!state.draft, accept: pendingForClient && latest!.author_role !== 'client', reject: pendingForClient && latest!.author_role !== 'client' },
    };
  };
  const event = (type: string, actor: string, version: number | null, reason: string | null = null) => state.events.push({ id: `e${state.events.length}`, type, actor_role: actor, version_no: version, reason, created_at: at(state.events.length) });
  const contractorSends = (patch: Record<string, unknown>) => {
    const base = current();
    if (base) base.status = 'superseded';
    const no = (base?.version_no ?? 0) + 1;
    state.versions.push({ id: `v${no}`, version_no: no, content_hash: `hash${no}`.padEnd(64, '0'), author_role: 'contractor', status: 'sent', created_at: at(30 + no), terms: { ...(base?.terms ?? terms()), ...patch }, acceptances: [{ party_role: 'contractor', accepted_at: at(30 + no) }], rejection: null });
    event('sent', 'contractor', no);
  };
  const contractorAccepts = () => { const latest = current()!; latest.acceptances.push({ party_role: 'contractor', accepted_at: at(50) }); event('accepted', 'contractor', latest.version_no); if (latest.acceptances.length === 2) { latest.status = 'agreed'; state.agreed = latest.id; event('agreed', 'contractor', latest.version_no); } };
  const requests: any[] = [];
  const handler = async (route: Route) => {
    const request = route.request();
    const ok = (data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
    const fail = (status: number, code: string) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: code, code }) });
    if (request.method() === 'GET') return ok(view());
    const body = request.postDataJSON(); requests.push(body);
    const { action, input } = body;
    if (action === 'save_draft') { state.draft = { id: 'draft', version_no: (current()?.version_no ?? 0) + 1, content_hash: 'd'.repeat(64), author_role: 'client', status: 'draft', created_at: at(20), terms: input.terms, acceptances: [], rejection: null }; event('draft_saved', 'client', null); return ok(view()); }
    if (action === 'send') { const base = current(); if (base) base.status = 'superseded'; const sent = { ...state.draft!, id: `v${state.draft!.version_no}`, status: 'sent', content_hash: `client${state.draft!.version_no}`.padEnd(64, '0'), acceptances: [{ party_role: 'client', accepted_at: at(25) }] }; state.versions.push(sent); state.draft = null; event('sent', 'client', sent.version_no); return ok(view()); }
    if (action === 'accept') {
      if (state.conflictOnce) { state.conflictOnce = false; contractorSends({ duration_days: 21 }); return fail(409, 'version_conflict'); }
      const latest = current()!; if (input.version_id !== latest.id || input.content_hash !== latest.content_hash) return fail(409, 'version_conflict');
      latest.acceptances.push({ party_role: 'client', accepted_at: at(40) }); event('accepted', 'client', latest.version_no);
      if (latest.acceptances.length === 2) { latest.status = 'agreed'; state.agreed = latest.id; event('agreed', 'client', latest.version_no); }
      return ok(view());
    }
    return fail(403, 'forbidden');
  };
  return { state, contractorSends, contractorAccepts, requests, handler };
}

const noHorizontalScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

test('Accord avant contrat #346 : proposer, contre-proposition, accord commun sur la même version', async ({ page, e2eClient }, info) => {
  test.skip(!e2eClient, 'E2E Supabase credentials are not available');
  await page.setViewportSize(info.project.name === 'mobile' ? { width: 375, height: 812 } : { width: 1440, height: 900 });
  await login(page, e2eClient!);

  // Backend not deployed: explained, inactive state — no action is offered.
  await page.goto(`/app/awards/${awardId}/conditions`);
  const soon = page.getByRole('heading', { name: 'Accord sur les conditions bientôt disponible' });
  await expect(soon).toBeVisible();
  await expect(soon.locator('xpath=../..').getByRole('button')).toHaveText(['Vérifier à nouveau']);

  // Third party / non-awarded artisan: refused with a clear message.
  await page.route('**/api/precontract**', (route) => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'forbidden', code: 'forbidden' }) }));
  await page.reload();
  await expect(page.getByRole('alert').filter({ hasText: 'Seuls le Client et l’Artisan attributaire' })).toBeVisible();
  await page.unroute('**/api/precontract**');

  const server = mockServer();
  await page.route('**/api/precontract**', server.handler);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Conditions et calendrier' })).toBeVisible();
  await expect(page.getByText('Non signé — aucun effet juridique.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Proposer des conditions' }).click();
  await page.getByLabel('Date de début souhaitée').fill('2026-11-02');
  await page.getByLabel('Durée des travaux (jours)').fill('0');
  await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'entre 1 et 3650' })).toBeVisible();
  await page.getByLabel('Durée des travaux (jours)').fill('15');
  await page.getByLabel('Modalité de paiement de référence').selectOption('milestone');
  // Advanced options stay hidden until asked for; keyboard reachable.
  const advanced = page.getByRole('button', { name: 'Options avancées' });
  await expect(advanced).toHaveAttribute('aria-expanded', 'false');
  await advanced.focus(); await page.keyboard.press('Enter');
  await expect(page.getByLabel('Début — Pose des cadres')).toBeVisible();
  await page.getByLabel('Début — Pose des cadres').fill('2026-11-02');
  await page.getByLabel('Fin — Pose des cadres').fill('2026-11-06');
  await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Brouillon enregistré' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Votre brouillon — non envoyé' })).toBeVisible();
  await page.getByRole('button', { name: 'Envoyer à l’Artisan' }).dblclick();
  await expect(page.getByRole('status').filter({ hasText: 'Proposition envoyée à l’Artisan' })).toBeVisible();
  expect(server.requests.filter(request => request.action === 'send')).toHaveLength(1);
  await expect(page.getByText('En attente de la réponse de l’Artisan', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Accepter/ })).toHaveCount(0);

  // Artisan counter-proposes: the exact difference is shown, then a stale accept is refused.
  server.contractorSends({ start_date: '2026-11-09' });
  server.state.conflictOnce = true;
  await page.reload();
  await expect(page.getByText('Artisan vous propose la version 2', { exact: true })).toBeVisible();
  const diff = page.getByRole('region', { name: 'Ce qui change par rapport à la version 1' });
  await expect(diff).toContainText('Date de début');
  await expect(diff).toContainText('Dates ou modalités modifiées');
  await page.getByRole('button', { name: 'Accepter la version 2' }).click();
  await page.getByRole('button', { name: 'Confirmer mon accord' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'n’est plus la dernière' })).toBeVisible();
  await expect(page.getByText('Artisan vous propose la version 3', { exact: true })).toBeVisible();

  // Accept the same (latest) version, then the Artisan accepts: common agreement, still not signed.
  await page.getByRole('button', { name: 'Accepter la version 3' }).click();
  await expect(page.getByRole('group', { name: 'Confirmer votre accord' })).toContainText('Ce n’est pas une signature');
  await page.getByRole('button', { name: 'Confirmer mon accord' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'version 3 est enregistré' })).toBeVisible();
  const accepted = server.requests.filter(request => request.action === 'accept').pop();
  expect(accepted.input).toMatchObject({ award_id: awardId, version_id: 'v3', content_hash: server.state.versions[2].content_hash });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Le Client et l’Artisan ont accepté la version 3' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Accepter|^Refuser|Proposer/ })).toHaveCount(0);
  await page.getByText(/^Historique/).click();
  await expect(page.getByText('Accord commun atteint · version 3')).toBeVisible();
  await noHorizontalScroll(page);
});
