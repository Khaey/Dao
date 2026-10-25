import test from 'node:test';
import assert from 'node:assert/strict';
import { SiteTechnicalQualityService } from '../src/services/SiteTechnicalQualityService.js';
import { createDaoApi } from '../src/server/nextHandlers.js';

const project = '11111111-1111-4111-8111-111111111111';
const award = '22222222-2222-4222-8222-222222222222';
const inspection = '33333333-3333-4333-8333-333333333333';
const reserve = '44444444-4444-4444-8444-444444444444';
const document = '55555555-5555-4555-8555-555555555555';

function fakeDb(data: unknown = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return { calls, db: { async rpc(name: string, args: Record<string, unknown>) { calls.push({ name, args }); return { data, error: null }; } } };
}

test('technical inspection listing validates UUIDs and makes a stable keyset cursor', async () => {
  const fake = fakeDb({ projectId: project, items: [{ id: inspection, createdAt: '2026-10-25T10:00:00Z' }], hasMore: true });
  const service = new SiteTechnicalQualityService(fake.db);
  const result = await service.inspections(project, award, null, 60);
  assert.equal(fake.calls[0].name, 'native_technical_inspections_v1');
  assert.equal(fake.calls[0].args.p_limit, 50);
  assert.equal(fake.calls[0].args.p_award_item_id, award);
  assert.equal(JSON.parse(Buffer.from(result.nextCursor!, 'base64url').toString()).id, inspection);
  await assert.rejects(() => service.inspections('bad', null, null, 10), /project_id must be a UUID/);
});

test('technical commands map only bounded fields to the JWT RPCs', async () => {
  const fake = fakeDb({ reserveId: reserve });
  const service = new SiteTechnicalQualityService(fake.db);
  await service.requestInspection({ award_item_id: award, note: 'Vérification visuelle', document_ids: [document], idempotency_key: 'inspection-request-01' });
  await service.createReserve({
    award_item_id: award, inspection_id: inspection, title: 'Joint à reprendre', description: 'Le joint reste discontinu sur 20 cm.',
    category: 'workmanship', severity: 'moderate', location: 'Salle de bain, mur nord', bid_sub_lot_id: null,
    native_activity_id: null, due_date: '2026-11-02', document_ids: [], idempotency_key: 'reserve-create-001',
  });
  await service.updateReserve({ reserve_id: reserve, action: 'declare_correction', note: 'Joint repris et photo ajoutée',
    document_ids: [document], expected_revision: 1, idempotency_key: 'reserve-correct-001' });
  assert.deepEqual(fake.calls.map(c => c.name), [
    'request_native_technical_inspection_v1', 'create_native_technical_reserve_v1', 'record_native_technical_reserve_event_v1',
  ]);
  assert.equal(fake.calls[1].args.p_due_date, '2026-11-02');
  assert.equal(fake.calls[2].args.p_expected_revision, 1);
  assert.throws(() => service.createReserve({ award_item_id: award, title: 'A', description: 'short', category: 'other',
    severity: 'minor', idempotency_key: 'reserve-create-002', due_date: '2026-02-31' }), /due_date must be a valid date/);
  assert.throws(() => service.updateReserve({ reserve_id: reserve, action: 'accept', expected_revision: 1,
    idempotency_key: 'reserve-action-001' }), /Invalid reserve action/);
  assert.equal(fake.calls.length, 3);
});

test('technical quality API is JWT-gated and paginates inspection history', async () => {
  const calls: string[] = [];
  const service = {
    async inspections() { calls.push('inspections'); return { items: [], nextCursor: null }; },
    async inspectionEvents() { calls.push('inspectionEvents'); return { items: [], nextCursor: null }; },
  };
  const api = createDaoApi({ siteTechnicalQuality: service } as any, async auth => auth === 'Bearer test' ? { id: 'actor' } : null);
  const denied = await api.listTechnicalInspections(new Request(`http://dao.test/api/projects/native-execution/inspections?project_id=${project}`));
  assert.equal(denied.status, 401);
  const listed = await api.listTechnicalInspections(new Request(`http://dao.test/api/projects/native-execution/inspections?project_id=${project}&limit=20`, {
    headers: { authorization: 'Bearer test' },
  }));
  assert.equal(listed.status, 200);
  assert.equal(listed.headers.get('cache-control'), 'private, no-store');
  const history = await api.listTechnicalInspectionEvents(new Request(`http://dao.test/api/projects/native-execution/inspections/events?inspection_id=${inspection}`, {
    headers: { authorization: 'Bearer test' },
  }));
  assert.equal(history.status, 200);
  assert.deepEqual(calls, ['inspections', 'inspectionEvents']);
});
