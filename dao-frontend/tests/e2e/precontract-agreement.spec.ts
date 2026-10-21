import type { Page, Route } from '@playwright/test';
import { test, expect } from './support/fixtures';
import { login } from './support/flow';

// #346 B1 — « Conditions et calendrier » UI against an EXPLICIT in-test mock of DEV 2's DTO
// (docs/product/precontract-agreement-v1.md, GET|POST /api/contracts/agreements). UI evidence only, never proof
// of integration: the real two-party flow is covered against the delivered backend.
const awardId = '00000000-0000-4000-8000-000000000346';
const agreementId = '00000000-0000-4000-8000-0000000003a6';
const at = (minute: number) => `2026-10-20T19:${String(minute).padStart(2, '0')}:00.000Z`;
const route = '**/api/contracts/agreements**';

function mockServer() {
  const state = {
    agreement: null as null | { id: string; award_id: string; project_id: string; status: string; current_version_id: string; agreed_at: string | null },
    versions: [] as any[], acceptances: [] as any[], events: [] as any[], staleNextAccept: false,
  };
  const reference = { award_id: awardId, project_id: 'p', currency: 'TND', total_millimes: 12_500_000, items: [{ award_item_id: 'ai1', request_id: 'r1', agreed_millimes: 12_500_000, title: 'Lot menuiserie démo', sub_lots: [{ node_key: '00000000-0000-4000-8000-00000000c0de', title: 'Pose des cadres' }] }] };
  const current = () => state.versions.find(version => version.id === state.agreement?.current_version_id) ?? null;
  const has = (versionId: string, role: string) => state.acceptances.some(row => row.version_id === versionId && row.party_role === role);
  const snapshot = () => {
    const negotiating = state.agreement?.status === 'negotiating';
    return {
      agreement: state.agreement, reference, current_version: current(), versions: [...state.versions].reverse(), acceptances: state.acceptances, events: state.events,
      permissions: { party_role: 'client', can_propose: true, can_accept: !!negotiating && !has(state.agreement!.current_version_id, 'client'), can_reject: !!negotiating },
      non_engaging: true, legal_effect_enabled: false, contract_signed: false,
    };
  };
  const proposeAs = (role: string, terms: any) => {
    const no = state.versions.length + 1;
    const version = { id: `00000000-0000-4000-8000-00000000000${no}`, version_no: no, content_hash: `${no}`.repeat(64).slice(0, 64), proposed_role: role, created_at: at(10 + no), terms };
    state.versions.push(version);
    state.agreement = { id: agreementId, award_id: awardId, project_id: 'p', status: 'negotiating', current_version_id: version.id, agreed_at: null };
    state.events.push({ id: `e${state.events.length}`, version_id: version.id, actor_role: role, event_type: no === 1 ? 'proposed' : 'counter_proposed', created_at: at(10 + no) });
  };
  const acceptAs = (role: string) => {
    const version = current()!;
    state.acceptances.push({ version_id: version.id, party_role: role, accepted_at: at(40 + state.acceptances.length) });
    state.events.push({ id: `e${state.events.length}`, version_id: version.id, actor_role: role, event_type: 'accepted', created_at: at(40) });
    if (has(version.id, 'client') && has(version.id, 'contractor')) { state.agreement!.status = 'agreed'; state.agreement!.agreed_at = at(45); state.events.push({ id: `e${state.events.length}`, version_id: version.id, actor_role: role, event_type: 'agreed', created_at: at(45) }); }
  };
  const requests: any[] = [];
  const handler = async (request: Route) => {
    const ok = (data: unknown) => request.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
    const conflict = (error: string) => request.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error, code: '23514' }) });
    if (request.request().method() === 'GET') return ok(snapshot());
    const body = request.request().postDataJSON(); requests.push(body);
    if (body.action === 'propose') {
      if ((body.base_version_id ?? null) !== (state.agreement?.current_version_id ?? null)) return conflict('La proposition repose sur une version obsolète');
      proposeAs('client', body.terms); return ok({ agreement_id: agreementId, status: 'negotiating' });
    }
    if (body.action === 'accept') {
      if (state.staleNextAccept) { state.staleNextAccept = false; proposeAs('contractor', { ...current()!.terms, duration_days: 21 }); return conflict('Cette version ne peut plus être acceptée'); }
      if (body.version_id !== state.agreement!.current_version_id) return conflict('Cette version ne peut plus être acceptée');
      acceptAs('client'); return ok({ agreement_id: agreementId, status: state.agreement!.status });
    }
    return request.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Partie active requise', code: '42501' }) });
  };
  return { state, proposeAs, acceptAs, requests, handler };
}

const noHorizontalScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

test('Accord avant contrat #346 : proposer, contre-proposition, accord commun sur la même version', async ({ page, e2eClient }, info) => {
  test.skip(!e2eClient, 'E2E Supabase credentials are not available');
  await page.setViewportSize(info.project.name === 'mobile' ? { width: 375, height: 812 } : { width: 1440, height: 900 });
  await login(page, e2eClient!);

  // Service not deployed: explained, inactive state — no action is offered.
  await page.route(route, (request) => request.fulfill({ status: 404, contentType: 'text/html', body: 'Not Found' }));
  await page.goto(`/app/awards/${awardId}/conditions`);
  const soon = page.getByRole('heading', { name: 'Accord sur les conditions bientôt disponible' });
  await expect(soon).toBeVisible();
  await expect(soon.locator('xpath=../..').getByRole('button')).toHaveText(['Vérifier à nouveau']);
  await page.unroute(route);

  // Third party / non-awarded artisan: refused with a clear message, conditions never shown.
  await page.route(route, (request) => request.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Attribution inaccessible', code: '42501' }) }));
  await page.reload();
  await expect(page.getByRole('alert').filter({ hasText: 'Seuls le Client et l’Artisan attributaire' })).toBeVisible();
  await page.unroute(route);

  const server = mockServer();
  await page.route(route, server.handler);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Conditions et calendrier' })).toBeVisible();
  await expect(page.getByText('Non signé — aucun effet juridique.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Proposer des conditions' }).click();
  await page.getByLabel('Date de début souhaitée').fill('2026-11-02');
  await page.getByLabel('Durée des travaux (jours)').fill('0');
  await page.getByRole('button', { name: 'Relire avant envoi' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'entre 1 et 3650' })).toBeVisible();
  await page.getByLabel('Durée des travaux (jours)').fill('15');
  await page.getByLabel('Modalité de paiement de référence').selectOption('milestone');
  // Optional installments in TND are normalized to integer millimes (exact awarded total).
  await page.getByRole('button', { name: 'Échéancier indicatif (optionnel)' }).click();
  await page.getByRole('button', { name: 'Ajouter une échéance' }).click();
  await page.getByLabel('Intitulé de l’échéance 1').fill('Jalon menuiserie');
  await page.getByLabel('Montant (TND) — échéance 1').fill('12500.000');
  // Advanced options stay folded until asked for; keyboard reachable.
  const advanced = page.getByRole('button', { name: 'Options avancées' });
  await expect(advanced).toHaveAttribute('aria-expanded', 'false');
  await advanced.focus(); await page.keyboard.press('Enter');
  await page.getByLabel('Début — Pose des cadres').fill('2026-11-02');
  await page.getByRole('button', { name: 'Relire avant envoi' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'le début et la fin' })).toBeVisible();
  await page.getByLabel('Fin — Pose des cadres').fill('2026-11-06');
  await page.getByRole('button', { name: 'Relire avant envoi' }).click();
  await expect(page.getByRole('heading', { name: 'Relisez votre proposition' })).toBeVisible();
  expect(server.requests).toHaveLength(0);
  await page.getByRole('button', { name: 'Envoyer à l’Artisan' }).dblclick();
  await expect(page.getByRole('status').filter({ hasText: 'Proposition envoyée à l’Artisan' })).toBeVisible();
  expect(server.requests.filter(request => request.action === 'propose')).toHaveLength(1);
  expect(server.requests[0]).toMatchObject({ award_id: awardId, base_version_id: null, terms: { planned_start_date: '2026-11-02', duration_days: 15, payment_mode: 'milestone', sub_lot_schedule: [{ node_key: '00000000-0000-4000-8000-00000000c0de', start_date: '2026-11-02', end_date: '2026-11-06' }] } });
  expect(server.requests[0].idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
  expect(server.requests[0].terms.installments).toMatchObject([{ label: 'Jalon menuiserie', amount_millimes: 12_500_000 }]);
  await expect(page.getByText('Confirmez votre accord sur votre proposition', { exact: true })).toBeVisible();

  // Artisan counter-proposes: the exact difference is shown, then a stale accept is refused and reloaded.
  server.proposeAs('contractor', { ...server.state.versions[0].terms, planned_start_date: '2026-11-09' });
  server.state.staleNextAccept = true;
  await page.reload();
  await expect(page.getByText('Artisan vous propose la version 2', { exact: true })).toBeVisible();
  const diff = page.getByRole('region', { name: 'Ce qui change par rapport à la version 1' });
  await expect(diff).toContainText('Date de début');
  await expect(diff).toContainText('Dates ou modalités modifiées');
  await page.getByRole('button', { name: 'Accepter la version 2' }).click();
  await page.getByRole('button', { name: 'Confirmer mon accord' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'ne peut plus être acceptée' })).toBeVisible();
  await expect(page.getByText('Artisan vous propose la version 3', { exact: true })).toBeVisible();

  // Both parties accept the same version: common agreement, still not signed.
  server.acceptAs('contractor');
  await page.reload();
  await page.getByRole('button', { name: 'Accepter la version 3' }).click();
  await expect(page.getByRole('group', { name: 'Confirmer votre accord' })).toContainText('Ce n’est pas une signature');
  await page.getByRole('button', { name: 'Confirmer mon accord' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'version 3 est enregistré' })).toBeVisible();
  const accepted = server.requests.filter(request => request.action === 'accept').pop();
  expect(accepted).toMatchObject({ agreement_id: agreementId, version_id: server.state.versions[2].id });
  await expect(page.getByRole('heading', { name: 'Le Client et l’Artisan ont accepté la version 3' })).toBeVisible();
  await expect(page.getByText(/Conditions convenues — contrat non signé/)).toBeVisible();
  // #346 B3: explicit API mock, no financial transfer; server permissions drive buttons.
  let installmentStatus: 'declared' | 'verified' | 'authorized' = 'declared';
  await page.route('**/api/contracts/installments**', async request => {
    if (request.request().method() === 'POST') {
      const command = request.request().postDataJSON();
      expect(command.agreement_id).toBe(agreementId);
      expect(command.installment_no).toBe(1);
      expect(command.version_id).toBe(server.state.versions[2].id);
      expect(command.event_type).toBe(installmentStatus === 'declared' ? 'verified' : 'authorized');
      installmentStatus = command.event_type;
      return request.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { status: installmentStatus, money_moved: false } }) });
    }
    return request.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: {
      agreement_id: agreementId, agreement_version_id: server.state.versions[2].id, version_no: 3,
      payment_mode: 'milestone', total_millimes: 12_500_000, currency: 'TND',
      installments: [{ installment_no: 1, label: 'Jalon menuiserie', amount_millimes: 12_500_000,
        status: installmentStatus, can_declare: false, can_verify: installmentStatus === 'declared',
        can_contest: installmentStatus !== 'authorized', can_authorize: installmentStatus === 'verified' }],
      events: [], permissions: { party_role: 'client' }, informational_only: true,
      money_moved: false, payment_recorded: false, debt_created: false,
    } }) });
  });
  await page.reload();
  const installments = page.getByRole('region', { name: 'Suivi informatif des échéances' });
  await expect(installments).toContainText('Aucun montant n’est transféré');
  await installments.getByRole('button', { name: 'Vérifier', exact: true }).click();
  await installments.getByRole('button', { name: 'Confirmer cette action' }).click();
  await expect(installments).toContainText('Vérifiée par le Client');
  await installments.getByRole('button', { name: 'Enregistrer une autorisation' }).click();
  await installments.getByRole('button', { name: 'Confirmer cette action' }).click();
  await expect(installments).toContainText('Autorisation enregistrée (sans paiement)');
  await expect(installments.getByRole('button', { name: 'Enregistrer une autorisation' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Accepter|^Refuser/ })).toHaveCount(0);
  await page.getByText(/^Historique/).click();
  await expect(page.getByText('Accord commun atteint · version 3')).toBeVisible();
  await noHorizontalScroll(page);
});
