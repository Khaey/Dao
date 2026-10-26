import { test, expect } from './support/fixtures';
import { login } from './support/flow';
import type { Page, Route } from '@playwright/test';

// UI contract of the P12 work situations panel. The server rules (roles, states, revisions)
// are covered by dao-backend/tests/site-work-situations.test.ts; here the plan and situation APIs are stubbed.
const PROJECT = '00000000-0000-4000-8000-0000000000e1';
const CONTRACTOR = '00000000-0000-4000-9000-0000000000c1';
const ITEM_A = '00000000-0000-4000-a000-0000000000a1';
const ITEM_B = '00000000-0000-4000-a000-0000000000a2';
const SITUATION = '00000000-0000-4000-b000-0000000000b1';
const LINE_A = '00000000-0000-4000-c000-0000000000d1';
const LINE_B = '00000000-0000-4000-c000-0000000000d2';
const EVENT_1 = '00000000-0000-4000-e000-0000000000e1';
const EVENT_2 = '00000000-0000-4000-e000-0000000000e2';
const DOC = '00000000-0000-4000-d000-0000000000d9';
// Carnet : deux interventions en m² dans la période, une hors période, une sans quantité, une sur l’autre lot en ml.
const journal = { project_id: PROJECT, can_observe: false, lots: [], next_cursor: null, events: [
  { id: EVENT_1, kind: 'intervention', award_item_id: ITEM_A, work_date: '2026-10-03', created_at: '2026-10-03T09:00:00Z', quantity: { executed_quantity_milli: 5000, unit: 'm²' } },
  { id: EVENT_2, kind: 'intervention', award_item_id: ITEM_A, work_date: '2026-10-10', created_at: '2026-10-10T09:00:00Z', quantity: { executed_quantity_milli: 7500, unit: 'm²' } },
  { id: '00000000-0000-4000-e000-0000000000e3', kind: 'intervention', award_item_id: ITEM_A, work_date: '2026-10-20', created_at: '2026-10-20T09:00:00Z', quantity: { executed_quantity_milli: 9000, unit: 'm²' } },
  { id: '00000000-0000-4000-e000-0000000000e4', kind: 'intervention', award_item_id: ITEM_A, work_date: '2026-10-05', created_at: '2026-10-05T09:00:00Z', quantity: null },
  { id: '00000000-0000-4000-e000-0000000000e5', kind: 'intervention', award_item_id: ITEM_B, work_date: '2026-10-06', created_at: '2026-10-06T09:00:00Z', quantity: { executed_quantity_milli: 2000, unit: 'ml' } },
] };

type Workspace = 'client' | 'contractor' | 'dao_manager';
const lot = (requestId: string, awardItemId: string, title: string, declare: boolean) => ({
  requestId, requestVersionId: null, title, scope: null, status: 'awarded',
  award: { awardId: awardItemId.replace('a000', 'f000'), awardItemId, contractorId: CONTRACTOR, contractorName: 'Artisan fictif A' },
  permissions: { canRead: true, canPrepareChange: false, canDeclareProgress: declare, canReviewProgress: !declare, canAcceptEngagingChange: false, canEditActivities: false },
  dates: { proposed: null, agreed: null, plan: null, observed: null }, progress: null, quantities: [],
  officialSubLots: [], executionSubLots: [], milestones: [], dependencies: [], modalities: null,
});
const plan = (workspace: Workspace) => ({
  schemaVersion: 1, projectId: PROJECT, generatedAt: '2026-10-25T10:00:00Z', viewer: { workspace },
  sourceRevisions: { plan: 1, executionCursor: null }, page: { limit: 50, nextCursor: null },
  lots: [lot('00000000-0000-4000-8000-0000000000f1', ITEM_A, 'Lot maçonnerie', workspace === 'contractor'),
    lot('00000000-0000-4000-8000-0000000000f2', ITEM_B, 'Lot carrelage', workspace === 'contractor')],
  agreementsByAward: [], activities: { supported: false, items: [], truncated: false }, dependencies: [],
  changeProposals: [], changeProposalsTruncated: false, forecast: null,
});
const summary = (status: string, revision: number) => ({ id: SITUATION, createdAt: '2026-10-20T08:00:00Z', updatedAt: '2026-10-20T08:00:00Z', projectId: PROJECT,
  contractorId: CONTRACTOR, periodStart: '2026-10-01', periodEnd: '2026-10-15', status, revision, lineCount: 2 });
const detail = (status: string, revision: number, validated: [string | null, string | null] = [null, null]) => ({
  ...summary(status, revision),
  lines: [
    { lineId: LINE_A, awardItemId: ITEM_A, requestId: null, quoteLineId: null, label: 'Murs porteurs', quantityUnit: 'm²', quantityReportedMilli: '12500', quantityValidatedMilli: validated[0], sourceEventIds: [], evidenceDocumentIds: [] },
    { lineId: LINE_B, awardItemId: ITEM_B, requestId: null, quoteLineId: null, label: 'Faïence', quantityUnit: 'm²', quantityReportedMilli: '3000', quantityValidatedMilli: validated[1], sourceEventIds: [], evidenceDocumentIds: [] },
  ],
  technicalStatement: [
    { lineId: LINE_A, awardItemId: ITEM_A, quoteLineId: null, quantityUnit: 'm²', previouslyValidatedMilli: '4000', currentValidatedMilli: validated[0], cumulativeValidatedMilli: validated[0] ? String(4000 + Number(validated[0])) : null },
    { lineId: LINE_B, awardItemId: ITEM_B, quoteLineId: null, quantityUnit: 'm²', previouslyValidatedMilli: '0', currentValidatedMilli: validated[1], cumulativeValidatedMilli: validated[1] },
  ],
});
const events = { situationId: SITUATION, items: [{ id: '00000000-0000-4000-e000-0000000000e9', createdAt: '2026-10-20T08:00:00Z', actorId: CONTRACTOR, actorRole: 'contractor', revision: 1, kind: 'created', statusAfter: 'draft', note: null, payload: {} }], hasMore: false };

type State = { list: unknown[]; detail: unknown; listStatus?: number; posts: any[]; respond: (body: any) => { status: number; data?: unknown } };
async function stub(page: Page, workspace: Workspace, state: State) {
  const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route(/\/api\/projects\/native-execution\?/, route => json(route, 200, { data: plan(workspace) }));
  await page.route(/\/api\/projects\/execution\?/, route => json(route, 200, { data: journal }));
  await page.route(/\/rest\/v1\/documents\?/, route => route.request().method() === 'GET'
    ? json(route, 200, [{ id: DOC, original_name: 'photo-murs.jpg', owner_id: CONTRACTOR, share_scope: 'project_members', status: 'approved' }]) : route.continue());
  await page.route(/\/api\/projects\/native-execution\/work-situations\/events\?/, route => json(route, 200, { data: events }));
  await page.route(/\/api\/projects\/native-execution\/work-situations(\?|$)/, async route => {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = request.postDataJSON(); state.posts.push(body);
      const result = state.respond(body);
      return json(route, result.status, result.status === 200 ? { data: result.data } : { error: 'stub', code: 'STUB' });
    }
    const url = new URL(request.url());
    if (state.listStatus && url.searchParams.has('project_id')) return json(route, state.listStatus, { error: 'stub', code: 'STUB' });
    return json(route, 200, { data: url.searchParams.has('situation_id') ? state.detail : { projectId: PROJECT, items: state.list, hasMore: false } });
  });
}
const panel = (page: Page) => page.getByRole('region', { name: 'Situations de travaux' });
async function openTracking(page: Page) {
  await page.goto(`/app/native-execution/${PROJECT}`);
  await expect(panel(page).getByRole('heading', { name: 'Situations de travaux' })).toBeVisible();
}

test('Situations de travaux : l’Artisan crée un brouillon multi-lots en quantités exactes', async ({ page, e2eArtisan }) => {
  const state: State = { list: [], detail: null, posts: [], respond: () => {
    state.list = [summary('draft', 1)]; state.detail = detail('draft', 1);
    return { status: 200, data: { situationId: SITUATION, status: 'draft', revision: 1 } };
  } };
  await stub(page, 'contractor', state);
  await login(page, e2eArtisan!);
  await openTracking(page);
  const situations = panel(page);
  await expect(situations.getByText('Aucune situation de travaux sur ce chantier pour l’instant.', { exact: false })).toBeVisible();
  await expect(situations.getByText('Une intervention du carnet ne crée pas de situation', { exact: false })).toBeVisible();
  await situations.getByRole('button', { name: 'Nouvelle situation de travaux' }).click();
  const form = situations.getByRole('form', { name: 'Nouvelle situation de travaux' });
  await form.getByLabel('Début de période').fill('2026-10-01');
  await form.getByLabel('Fin de période').fill('2026-10-15');
  await form.getByLabel('Intitulé').fill('Murs porteurs');
  await form.getByLabel('Unité').fill('m²');
  // Optional link to the journal: only the two in-period m² interventions of the lot are offered; the quantity becomes their sum.
  await form.getByText('Interventions et justificatifs — facultatif').first().click();
  const sources = form.getByRole('group', { name: 'Interventions du carnet' }).first();
  await expect(sources.getByRole('checkbox')).toHaveCount(2);
  await sources.getByRole('checkbox').nth(0).check();
  await sources.getByRole('checkbox').nth(1).check();
  await expect(form.getByLabel('Quantité déclarée').first()).toHaveValue('12,5');
  await form.getByRole('group', { name: 'Justificatifs' }).first().getByRole('checkbox', { name: 'photo-murs.jpg' }).check();
  await form.getByRole('button', { name: 'Ajouter une ligne' }).click();
  await form.getByLabel('Lot').nth(1).selectOption({ label: 'Lot carrelage' });
  await form.getByLabel('Intitulé').nth(1).fill('Faïence');
  await form.getByLabel('Unité').nth(1).fill('m²');
  await form.getByLabel('Quantité déclarée').nth(1).fill('3');
  await form.getByRole('button', { name: 'Enregistrer le brouillon' }).click();
  await expect(situations.getByRole('status').filter({ hasText: 'Brouillon créé' })).toBeVisible();

  const [create] = state.posts;
  expect(create).toMatchObject({ action: 'create', project_id: PROJECT, contractor_id: CONTRACTOR, period_start: '2026-10-01', period_end: '2026-10-15' });
  expect(create.idempotency_key).toMatch(/^ws-/);
  expect(create.lines.map((line: any) => [line.award_item_id, line.quantity_reported_milli])).toEqual([[ITEM_A, '12500'], [ITEM_B, '3000']]);
  expect(create.lines[0]).toMatchObject({ evidence_document_ids: [DOC] });
  expect([...create.lines[0].source_event_ids].sort()).toEqual([EVENT_1, EVENT_2]);
  expect(create.lines[1]).toMatchObject({ source_event_ids: [], evidence_document_ids: [] });
  await expect(situations.getByRole('button', { name: 'Soumettre au Client' })).toBeVisible();
  await expect(situations.getByRole('button', { name: 'Modifier le brouillon' })).toBeVisible();
  await expect(situations.getByRole('button', { name: 'Valider techniquement les quantités' })).toHaveCount(0);
  await expect(situations.getByText('Artisan fictif A', { exact: true })).toBeVisible();
});

test('Situations de travaux : le Client démarre la revue, gère le conflit puis valide à 0 sans paiement', async ({ page, e2eClient }) => {
  let conflictOnce = true;
  const state: State = { list: [summary('submitted', 2)], detail: detail('submitted', 2), posts: [], respond: body => {
    if (body.action === 'start_review') { state.list = [summary('under_review', 3)]; state.detail = detail('under_review', 3); return { status: 200, data: { situationId: SITUATION, status: 'under_review', revision: 3 } }; }
    if (conflictOnce) { conflictOnce = false; return { status: 409 }; }
    state.list = [summary('validated_technical', 4)]; state.detail = detail('validated_technical', 4, ['12500', '0']);
    return { status: 200, data: { situationId: SITUATION, status: 'validated_technical', revision: 4 } };
  } };
  await stub(page, 'client', state);
  await login(page, e2eClient!);
  await openTracking(page);
  const situations = panel(page);
  await expect(situations.getByRole('button', { name: 'Nouvelle situation de travaux' })).toHaveCount(0);
  await situations.getByRole('button', { name: /Du .* au .*/ }).click();
  await expect(situations.getByRole('cell', { name: '12,5' })).toBeVisible();
  await situations.getByRole('button', { name: 'Démarrer la revue' }).click();
  await situations.getByRole('form', { name: 'Démarrer la revue' }).getByRole('button', { name: 'Confirmer' }).click();
  await expect.poll(() => state.posts[0]).toMatchObject({ action: 'start_review', situation_id: SITUATION, expected_revision: 2 });

  await situations.getByRole('button', { name: 'Valider techniquement les quantités' }).click();
  let decision = situations.getByRole('form', { name: 'Valider techniquement les quantités' });
  await expect(decision.getByText('ni une facture, ni un paiement', { exact: false })).toBeVisible();
  await situations.getByLabel('Quantité pour Faïence').fill('0');
  await decision.getByRole('button', { name: 'Confirmer' }).click();
  await expect(situations.getByRole('alert')).toContainText('La situation a changé');
  await expect(decision).toHaveCount(0);

  await situations.getByRole('button', { name: 'Valider techniquement les quantités' }).click();
  decision = situations.getByRole('form', { name: 'Valider techniquement les quantités' });
  await situations.getByLabel('Quantité pour Faïence').fill('0');
  await decision.getByRole('button', { name: 'Confirmer' }).click();
  await expect(situations.getByText('Quantités validées techniquement').first()).toBeVisible();
  const [, conflicted, validated] = state.posts;
  expect(conflicted.idempotency_key).not.toBe(validated.idempotency_key);
  expect(validated).toMatchObject({ action: 'validate_technical', expected_revision: 3, validated_lines: [{ line_id: LINE_A, quantity_milli: '12500' }, { line_id: LINE_B, quantity_milli: '0' }] });
  await expect(situations.getByRole('cell', { name: '16,5' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Payer|Facturer|Signer/ })).toHaveCount(0);
});

test('Situations de travaux : le Gestionnaire suggère seulement et un refus reste une erreur d’accès', async ({ page, e2eReviewer }) => {
  const state: State = { list: [summary('under_review', 3)], detail: detail('under_review', 3), posts: [], respond: () => ({ status: 200, data: { situationId: SITUATION, status: 'under_review', revision: 4 } }) };
  await stub(page, 'dao_manager', state);
  await login(page, e2eReviewer!);
  await openTracking(page);
  const situations = panel(page);
  await situations.getByRole('button', { name: /Du .* au .*/ }).click();
  await expect(situations.getByRole('button', { name: 'Suggérer des quantités' })).toBeVisible();
  for (const name of ['Valider techniquement les quantités', 'Démarrer la revue', 'Demander une correction', 'Soumettre au Client', 'Nouvelle situation de travaux'])
    await expect(situations.getByRole('button', { name })).toHaveCount(0);
  await situations.getByRole('button', { name: 'Suggérer des quantités' }).click();
  await situations.getByLabel('Quantité pour Murs porteurs').fill('12');
  await situations.getByRole('form', { name: 'Suggérer des quantités' }).getByRole('button', { name: 'Confirmer' }).click();
  await expect(situations.getByRole('status').filter({ hasText: 'Suggestion transmise' })).toBeVisible();
  await expect.poll(() => state.posts[0]).toMatchObject({ action: 'manager_suggestion', expected_revision: 3, validated_lines: [{ line_id: LINE_A, quantity_milli: '12000' }] });

  state.listStatus = 403;
  await page.reload();
  await expect(panel(page).getByRole('alert')).toContainText('non autorisée');
  await expect(panel(page).getByText('Aucune situation de travaux', { exact: false })).toHaveCount(0);
});
