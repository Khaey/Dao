import test from 'node:test';
import assert from 'node:assert/strict';
import { SiteWorkSituationService } from '../src/services/SiteWorkSituationService.js';
import { createNativeWorkSituationHandler } from '../src/server/nativeWorkSituationHandler.js';

const P = '11111111-1111-4111-8111-111111111111';
const S = '22222222-2222-4222-8222-222222222222';
const CP = '33333333-3333-4333-8333-333333333333';
const AI = '44444444-4444-4444-8444-444444444444';
const LI = '55555555-5555-4555-8555-555555555555';
function fake(data: unknown = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const db = { async rpc(name: string, args: Record<string, unknown>) { calls.push({ name, args }); return { data, error: null }; } };
  return { db, calls };
}
const line = { line_id: LI, award_item_id: AI, quote_line_id: null, label: 'Canalisation',
  quantity_unit: 'm', quantity_reported_milli: '1250', source_event_ids: [], evidence_document_ids: [] };

test('situation service maps exact quantities, bounded references and optimistic commands to JWT RPCs', async () => {
  const f = fake({ situationId: S, status: 'draft', revision: 1 });
  const service = new SiteWorkSituationService(f.db);
  await service.command({ action: 'create', project_id: P, contractor_id: CP, period_start: '2026-10-01',
    period_end: '2026-10-31', lines: [line], idempotency_key: 'situation-create-01' });
  assert.equal(f.calls[0].name, 'native_work_situation_command_v1');
  assert.equal(f.calls[0].args.p_lines instanceof Array, true);
  assert.equal((f.calls[0].args.p_lines as any[])[0].quantityReportedMilli, '1250');
  await service.command({ action: 'validate_technical', situation_id: S, expected_revision: 2,
    validated_lines: [{ line_id: LI, quantity_milli: '1000' }], idempotency_key: 'situation-valid-01' });
  assert.deepEqual(f.calls[1].args.p_validated_lines, [{ lineId: LI, quantityValidatedMilli: '1000' }]);
  await assert.rejects(() => service.command({ action: 'save_draft', situation_id: S, expected_revision: 2,
    lines: [{ ...line, quantity_reported_milli: '1.25' }], idempotency_key: 'situation-invalid-1' }), /exact integer string/);
  await assert.rejects(() => service.command({ action: 'submit', situation_id: S, expected_revision: 2,
    amount_approved: '1000', idempotency_key: 'situation-invalid-2' }), /Unsupported situation command fields/);
  assert.equal(f.calls.length, 2);
});

test('situation API requires a JWT, uses private cache headers, and returns RPC DTOs', async () => {
  const f = fake({ projectId: P, items: [], hasMore: false });
  const api = createNativeWorkSituationHandler(new SiteWorkSituationService(f.db), async auth => auth === 'Bearer valid' ? { id: 'actor' } : null);
  const url = 'https://dao.test/api/projects/native-execution/work-situations?project_id=' + P;
  const denied = await api(new Request(url));
  assert.equal(denied.status, 401);
  const listed = await api(new Request(url, { headers: { authorization: 'Bearer valid' } }));
  assert.equal(listed.status, 200);
  assert.equal(listed.headers.get('cache-control'), 'private, no-store');
  assert.equal((await listed.json() as any).data.projectId, P);
});

test('period dates are calendar-valid and line quantity strings are exact', async () => {
  const f = fake();
  const service = new SiteWorkSituationService(f.db);
  await assert.rejects(() => service.command({ action: 'create', project_id: P, contractor_id: CP,
    period_start: '2026-02-30', period_end: '2026-03-01', lines: [line], idempotency_key: 'situation-date-01' }));
  await assert.rejects(() => service.command({ action: 'create', project_id: P, contractor_id: CP,
    period_start: '2026-03-01', period_end: '2026-03-02', lines: [{ ...line, quantity_reported_milli: 0 }],
    idempotency_key: 'situation-date-02' }));
  assert.equal(f.calls.length, 0);
});
