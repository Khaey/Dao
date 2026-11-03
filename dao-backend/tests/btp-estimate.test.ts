import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateLine, lineAmount, quantityMicro, verifyEstimateResult } from '../src/btp-estimate/engine.js';
import { createBtpEstimateHandler, createBtpPriceHandler } from '../src/server/btpEstimateHandler.js';
import { BtpEstimateService } from '../src/services/BtpEstimateService.js';

// Tous les montants sont FICTIFS (tests de calcul), en millimes TND.
const candidate = (o: any = {}) => ({ itemId: 'i', revision: 1, priceKind: 'observed', component: 'composite', zone: 'national', amountMinMinor: 25000, amountMaxMinor: 25000,
  taxBasis: 'HT', vatRateBp: 1900, includes: [], observedOn: '2024-01-01', validFrom: '2024-01-01', validTo: null, sourceLocator: 'T1', conditions: '',
  source: { id: 's', code: 'test', name: 'Fictif', publisher: 'Tests', uri: null, licenseNote: 'fictif', dataNature: 'fictitious_test' },
  totalHtMinMinor: null, totalHtMaxMinor: null, totalTtcMinMinor: null, totalTtcMaxMinor: null, ...o }) as any;

test('quantities are parsed exactly to micro-units and reject floats beyond 6 decimals', () => {
  assert.equal(quantityMicro('12.345'), BigInt(12_345_000));
  assert.equal(quantityMicro('0.000001'), BigInt(1));
  assert.equal(quantityMicro('1.0000001'), null);
  assert.equal(quantityMicro('-1'), null);
  assert.equal(quantityMicro('1e3'), null);
});

test('line amounts use exact integer half-up rounding and explicit VAT only', () => {
  assert.equal(lineAmount(quantityMicro('12.345')!, 25000, 'HT', 1900, 'HT'), 308625);
  assert.equal(lineAmount(quantityMicro('12.345')!, 25000, 'HT', 1900, 'TTC'), 367264); // 367 263,75 → 367 264
  assert.equal(lineAmount(quantityMicro('1')!, 119000, 'TTC', 1900, 'HT'), 100000);
  assert.equal(lineAmount(quantityMicro('0.5')!, 1, 'HT', null, 'HT'), 1); // 0,5 → 1 (demi supérieur)
  assert.equal(lineAmount(quantityMicro('0.4')!, 1, 'HT', null, 'HT'), 0);
  assert.equal(lineAmount(quantityMicro('3')!, 1000, 'HT', null, 'TTC'), null);
  assert.equal(lineAmount(quantityMicro('3')!, 1000, 'TTC', null, 'HT'), null);
  assert.throws(() => lineAmount(BigInt(1), 1.5, 'HT', null, 'HT'));
});

test('ex aequo sources make a range and components are summed', () => {
  const qty = quantityMicro('10')!;
  assert.deepEqual(aggregateLine([candidate({ amountMinMinor: 8000, amountMaxMinor: 8000 }), candidate({ amountMinMinor: 9000, amountMaxMinor: 9500 })], qty),
    { htMinMinor: 80000, htMaxMinor: 95000, ttcMinMinor: 95200, ttcMaxMinor: 113050 });
  assert.deepEqual(aggregateLine([candidate({ component: 'material', amountMinMinor: 1000, amountMaxMinor: 1000 }), candidate({ component: 'labour', amountMinMinor: 500, amountMaxMinor: 500, vatRateBp: null })], qty),
    { htMinMinor: 15000, htMaxMinor: 15000, ttcMinMinor: null, ttcMaxMinor: null });
});

function result(lines: any[], totals: any, coverage: string): any {
  return { mode: 'simulation', lines, totals: { scope: coverage === 'complete' ? 'complete' : coverage === 'partial' ? 'priced_lines_only' : 'none', ...totals }, coverage: { status: coverage } };
}

test('verifier accepts an exact estimate and catches tampered or misleading results', () => {
  const c = candidate({ totalHtMinMinor: 250000, totalHtMaxMinor: 250000, totalTtcMinMinor: 297500, totalTtcMaxMinor: 297500 });
  const priced = { workId: 'w', scopeKey: 'default', status: 'priced', quantity: { value: '10', unit: 'm2' }, candidates: [c], missing: [],
    totals: { htMinMinor: 250000, htMaxMinor: 250000, ttcMinMinor: 297500, ttcMaxMinor: 297500 } };
  const totals = { htMinMinor: 250000, htMaxMinor: 250000, ttcMinMinor: 297500, ttcMaxMinor: 297500 };
  assert.equal(verifyEstimateResult(result([priced], totals, 'complete')).ok, true);
  assert.equal(verifyEstimateResult(result([{ ...priced, totals: { ...priced.totals, htMinMinor: 250001 } }], totals, 'complete')).ok, false);
  const missing = { workId: 'm', scopeKey: 'default', status: 'missing', quantity: null, candidates: [], missing: ['quantity_missing'], totals: { htMinMinor: null, htMaxMinor: null, ttcMinMinor: null, ttcMaxMinor: null } };
  // Un total présenté comme complet alors qu'une ligne manque est refusé.
  assert.equal(verifyEstimateResult(result([priced, missing], totals, 'complete')).ok, false);
  assert.equal(verifyEstimateResult(result([priced, missing], totals, 'partial')).ok, true);
  assert.equal(verifyEstimateResult(result([missing], { htMinMinor: null, htMaxMinor: null, ttcMinMinor: null, ttcMaxMinor: null }, 'unavailable')).ok, true);
  // Une donnée réelle ne peut pas alimenter une simulation (et inversement).
  const realSource = { ...priced, candidates: [{ ...c, source: { ...c.source, dataNature: 'real' } }] };
  assert.equal(verifyEstimateResult(result([realSource], totals, 'complete')).ok, false);
});

const actor = { id: '55100000-0000-4000-8000-000000000001' };
const project = '55100000-0000-4000-8000-0000000000aa';
const auth = { authorization: 'Bearer test', 'content-type': 'application/json' };

test('estimate API requires a JWT, a project, allowlisted params and idempotency keys for writes', async () => {
  const calls: any[] = [];
  const db = { rpc: async (name: string, args: any) => { calls.push({ name, args }); return { data: name === 'btp_estimate_snapshot_v1' ? { estimates: [] } : { result: result([], { htMinMinor: null, htMaxMinor: null, ttcMinMinor: null, ttcMaxMinor: null }, 'unavailable') }, error: null }; } };
  const service = new BtpEstimateService(db);
  assert.equal((await createBtpEstimateHandler(service, async () => null)(new Request(`https://dao.test/api/btp/estimates?project_id=${project}`))).status, 401);
  const handler = createBtpEstimateHandler(service, async () => actor);
  assert.equal((await handler(new Request('https://dao.test/api/btp/estimates', { headers: auth }))).status, 400);
  assert.equal((await handler(new Request(`https://dao.test/api/btp/estimates?project_id=${project}&admin=1`, { headers: auth }))).status, 400);
  assert.equal((await handler(new Request(`https://dao.test/api/btp/estimates?project_id=not-a-uuid`, { headers: auth }))).status, 400);
  const ok = await handler(new Request(`https://dao.test/api/btp/estimates?project_id=${project}`, { headers: auth }));
  assert.equal(ok.status, 200); assert.equal(ok.headers.get('cache-control'), 'private, no-store');
  assert.equal((await handler(new Request('https://dao.test/api/btp/estimates', { method: 'POST', headers: auth, body: JSON.stringify({ action: 'calculate', projectId: project }) }))).status, 400);
  const preview = await handler(new Request('https://dao.test/api/btp/estimates', { method: 'POST', headers: auth, body: JSON.stringify({ action: 'preview', projectId: project }) }));
  assert.equal(preview.status, 200); assert.equal((await preview.json()).data.verification.ok, true);
  assert.equal((await handler(new Request('https://dao.test/api/btp/estimates', { method: 'POST', headers: auth, body: JSON.stringify({ action: 'drop', projectId: project }) }))).status, 400);
  assert.deepEqual(calls.map(c => c.name), ['btp_estimate_snapshot_v1', 'btp_estimate_command_v1']);
  assert.equal(calls[1].args.p_input.action, undefined);
});

test('price API maps database refusals to HTTP codes without leaking a total', async () => {
  const errors: Record<string, any> = { verify: { code: '42501', message: 'the author of a price cannot verify it' }, record: { code: '22023', message: 'work is not in the published catalogue' }, retire: { code: '40001' }, reject: { code: 'XX000' } };
  const db = { rpc: async (_: string, args: any) => ({ data: null, error: errors[args.p_action] ?? null }) };
  const handler = createBtpPriceHandler(new BtpEstimateService(db), async () => actor);
  const post = (body: any) => handler(new Request('https://dao.test/api/btp/prices', { method: 'POST', headers: auth, body: JSON.stringify(body) }));
  assert.equal((await post({ action: 'verify', itemId: 'x' })).status, 400); // clé idempotente manquante
  assert.equal((await post({ action: 'verify', idempotencyKey: 'key-00001' })).status, 403);
  assert.equal((await post({ action: 'record', idempotencyKey: 'key-00002' })).status, 400);
  assert.equal((await post({ action: 'retire', idempotencyKey: 'key-00003' })).status, 409);
  assert.equal((await post({ action: 'reject', idempotencyKey: 'key-00004' })).status, 503);
  assert.equal((await post({ action: 'publish_all', idempotencyKey: 'key-00005' })).status, 400);
  assert.equal((await handler(new Request('https://dao.test/api/btp/prices', { method: 'DELETE', headers: auth }))).status, 405);
});
