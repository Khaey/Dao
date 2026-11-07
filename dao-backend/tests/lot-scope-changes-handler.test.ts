import test from 'node:test';
import assert from 'node:assert/strict';
import { createLotScopeChangesHandler, normalizeScopeChangeCommand, scopeChangeErrorMessage } from '../src/server/lotScopeChangesHandler.js';

const P = '0f9fd432-1111-4222-8333-444455556666';
const A = '1a2b3c4d-1111-4222-8333-444455556666';
const S = '2a2b3c4d-1111-4222-8333-444455556666';
const W = '3a2b3c4d-1111-4222-8333-444455556666';
const C = '4a2b3c4d-1111-4222-8333-444455556666';

test('scope change commands: strict shape, lower-cased ids, no price or quantity accepted', () => {
  assert.deepEqual(normalizeScopeChangeCommand({ action: 'propose', idempotencyKey: 'sc-key-0001', awardItemId: A.toUpperCase(), reason: '  Terrasse demandée  ', items: [{ workId: W.toUpperCase(), subLotId: S }, { label: ' Pergola ' }] }),
    { action: 'propose', key: 'sc-key-0001', input: { awardItemId: A, reason: 'Terrasse demandée', items: [{ subLotId: S, workId: W }, { subLotId: null, label: 'Pergola' }] } });
  assert.deepEqual(normalizeScopeChangeCommand({ action: 'accept', idempotencyKey: 'sc-key-0002', changeId: C }), { action: 'accept', key: 'sc-key-0002', input: { changeId: C } });
  assert.deepEqual(normalizeScopeChangeCommand({ action: 'reject', idempotencyKey: 'sc-key-0003', changeId: C, reason: 'Hors périmètre' }), { action: 'reject', key: 'sc-key-0003', input: { changeId: C, reason: 'Hors périmètre' } });
  for (const bad of [
    { action: 'propose', idempotencyKey: 'sc-key-0001', awardItemId: A, reason: 'Terrasse', items: [{ workId: W, priceMillimes: 1000 }] },
    { action: 'propose', idempotencyKey: 'sc-key-0001', awardItemId: A, reason: 'Terrasse', amountMillimes: 1000, items: [{ workId: W }] },
    { action: 'propose', idempotencyKey: 'sc-key-0001', awardItemId: A, reason: 'Terrasse', items: [{ workId: W, quantity: 3 }] },
    { action: 'propose', idempotencyKey: 'sc-key-0001', awardItemId: A, reason: 'Terrasse', items: [{ workId: W, label: 'Forgé' }] },
    { action: 'propose', idempotencyKey: 'sc-key-0001', awardItemId: A, reason: 'x', items: [{ workId: W }] },
    { action: 'propose', idempotencyKey: 'sc-key-0001', awardItemId: A, reason: 'Terrasse', items: [] },
    { action: 'accept', idempotencyKey: 'sc-key-0001', changeId: C, reason: 'Accord' },
    { action: 'reject', idempotencyKey: 'sc-key-0001', changeId: C },
    { action: 'delete', idempotencyKey: 'sc-key-0001', changeId: C },
    { action: 'accept', idempotencyKey: 'short', changeId: C },
  ]) assert.equal(normalizeScopeChangeCommand(bad), null, JSON.stringify(bad));
});

test('scope change errors: readable, no SQL leak', () => {
  assert.equal(scopeChangeErrorMessage({ code: '23514', hint: 'scope_change_pending' }).code, 'PENDING');
  assert.equal(scopeChangeErrorMessage({ code: '42501', hint: 'scope_change_other_party' }).code, 'OTHER_PARTY');
  assert.equal(scopeChangeErrorMessage({ code: '40001' }).status, 409);
  assert.equal(scopeChangeErrorMessage({ code: 'XX000', message: 'relation secrète' }).message.includes('secrète'), false);
});

test('scope change handler: JWT required, allowlisted RPCs, private no-store responses', async () => {
  const calls: Array<{ name: string; args: any }> = [];
  const db = { rpc: async (name: string, args: any) => { calls.push({ name, args }); return { data: { projectId: P, lots: [] }, error: null }; } };
  const api = createLotScopeChangesHandler(db, async auth => auth === 'Bearer valid' ? { id: 'actor' } : null);
  assert.equal((await api(new Request(`https://dao.test/api/projects/scope-changes?project_id=${P}`))).status, 401);
  const auth = { authorization: 'Bearer valid' };
  const read = await api(new Request(`https://dao.test/api/projects/scope-changes?project_id=${P}`, { headers: auth }));
  assert.equal(read.status, 200); assert.equal(read.headers.get('cache-control'), 'private, no-store');
  assert.equal((await api(new Request(`https://dao.test/api/projects/scope-changes?project_id=${P}&x=1`, { headers: auth }))).status, 400);
  const posted = await api(new Request('https://dao.test/api/projects/scope-changes', { method: 'POST', headers: auth, body: JSON.stringify({ action: 'accept', idempotencyKey: 'sc-key-0009', changeId: C }) }));
  assert.equal(posted.status, 200);
  assert.deepEqual(calls.map(c => c.name), ['lot_scope_changes_snapshot_v1', 'lot_scope_change_command_v1']);
  assert.deepEqual(calls[1].args, { p_action: 'accept', p_input: { changeId: C }, p_idempotency_key: 'sc-key-0009' });
  assert.equal((await api(new Request('https://dao.test/api/projects/scope-changes', { method: 'DELETE', headers: auth }))).status, 405);
});
