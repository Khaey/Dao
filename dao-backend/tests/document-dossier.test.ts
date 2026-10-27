import test from 'node:test';
import assert from 'node:assert/strict';
import { DocumentDossierService } from '../src/services/DocumentDossierService.js';
import { createDocumentDossierHandler } from '../src/server/documentDossierHandler.js';

const P = '11111111-1111-4111-8111-111111111111';
const F = '22222222-2222-4222-8222-222222222222';
const D = '33333333-3333-4333-8333-333333333333';
const R = '44444444-4444-4444-8444-444444444444';
const L = '55555555-5555-4555-8555-555555555555';
function fake(data: unknown = {}, error: any = null) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const db = { async rpc(name: string, args: Record<string, unknown>) { calls.push({ name, args }); return { data, error }; } };
  return { db, calls };
}

test('dossier service maps family, revision and review commands to JWT RPCs with strict fields', async () => {
  const f = fake({ familyId: F });
  const service = new DocumentDossierService(f.db);
  await service.command({ action: 'create_family', project_id: P, document_id: D, title: ' Plan RDC ', category: 'plan',
    visibility: 'lots', request_ids: [L], idempotency_key: 'dossier-create-1' });
  assert.equal(f.calls[0].name, 'document_dossier_command_v1');
  assert.equal(f.calls[0].args.p_title, 'Plan RDC');
  assert.deepEqual(f.calls[0].args.p_request_ids, [L]);
  await service.command({ action: 'add_revision', family_id: F, document_id: D, expected_revision_id: R, idempotency_key: 'dossier-rev-01' });
  assert.equal(f.calls[1].args.p_expected_revision_id, R);
  await service.command({ action: 'reviewed', revision_id: R, idempotency_key: 'dossier-visa-01' });
  assert.equal(f.calls[2].args.p_note, null);
  await service.command({ action: 'control_file', document_id: D, decision: 'approved', idempotency_key: 'dossier-ctrl-01' });
  assert.equal(f.calls[3].name, 'document_file_control_v1');
  await assert.rejects(() => service.command({ action: 'observations', revision_id: R, idempotency_key: 'dossier-obs-001' }), /note is invalid/);
  await assert.rejects(() => service.command({ action: 'control_file', document_id: D, decision: 'rejected', idempotency_key: 'dossier-ctrl-02' }), /note is invalid/);
  await assert.rejects(() => service.command({ action: 'reviewed', revision_id: R, legal_visa: true, idempotency_key: 'dossier-visa-02' }), /Unsupported/);
  await assert.rejects(() => service.command({ action: 'sign', revision_id: R, idempotency_key: 'dossier-sign-01' }), /Unsupported document dossier action/);
  await assert.rejects(() => service.command({ action: 'create_family', project_id: P, document_id: D, title: 'x', visibility: 'public', idempotency_key: 'dossier-vis-001' }), /visibility/);
  await assert.rejects(() => service.command({ action: 'update_family', family_id: F, title: 'x', visibility: 'lots', expected_version: 0, idempotency_key: 'dossier-ver-001' }), /expected_version/);
  await assert.rejects(() => service.command({ action: 'create_family', project_id: P, document_id: D, title: 'x', request_ids: [L, L], idempotency_key: 'dossier-dup-001' }), /duplicates/);
  assert.equal(f.calls.length, 4);
});

test('dossier API requires a JWT, keeps responses private and maps RPC refusals', async () => {
  const f = fake({ projectId: P, families: [] });
  const api = createDocumentDossierHandler(new DocumentDossierService(f.db), async auth => auth === 'Bearer valid' ? { id: 'actor' } : null);
  const url = `https://dao.test/api/documents/dossier?project_id=${P}&request_id=${L}`;
  assert.equal((await api(new Request(url))).status, 401);
  const listed = await api(new Request(url, { headers: { authorization: 'Bearer valid' } }));
  assert.equal(listed.status, 200);
  assert.equal(listed.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(f.calls[0].args, { p_project_id: P, p_request_id: L });
  const bad = await api(new Request('https://dao.test/api/documents/dossier?project_id=nope', { headers: { authorization: 'Bearer valid' } }));
  assert.equal(bad.status, 400);
  for (const [code, status] of [['42501', 403], ['40001', 409], ['23514', 409], ['XX000', 503]] as const) {
    const failing = createDocumentDossierHandler(new DocumentDossierService(fake(null, { code }).db), async () => ({ id: 'actor' }));
    const response = await failing(new Request('https://dao.test/api/documents/dossier', { method: 'POST', headers: { authorization: 'Bearer valid' },
      body: JSON.stringify({ action: 'reviewed', revision_id: R, idempotency_key: 'dossier-http-01' }) }));
    assert.equal(response.status, status);
  }
  const put = await api(new Request(url, { method: 'PUT', headers: { authorization: 'Bearer valid' } }));
  assert.equal(put.status, 405);
});
