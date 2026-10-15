import test from 'node:test';
import assert from 'node:assert/strict';
import { ContractReadService } from '../src/services/ContractReadService.js';
import { createDaoApi } from '../src/server/nextHandlers.js';

type Row = Record<string, any>;

function database(seed: Record<string, Row[]>) {
  return { from(table: string) {
    let rows = [...(seed[table] ?? [])];
    let columns: string[] | null = null;
    const resultRows = () => columns ? rows.map(row => Object.fromEntries(columns!.map(column => [column, row[column]]))) : rows;
    const query: any = {
      select(selection = '*') { columns = selection === '*' ? null : selection.split(',').map((column: string) => column.trim()); return query; },
      eq(column: string, value: unknown) { rows = rows.filter(row => row[column] === value); return query; },
      in(column: string, values: unknown[]) { rows = rows.filter(row => values.includes(row[column])); return query; },
      order() { return query; },
      async maybeSingle() { return { data: resultRows()[0] ?? null, error: null }; },
      then(resolve: (result: any) => unknown) { return Promise.resolve({ data: resultRows(), error: null }).then(resolve); },
    };
    return query;
  }};
}

const contractId = '11111111-1111-4111-8111-111111111111';
const versionId = '22222222-2222-4222-8222-222222222222';
const amendmentId = '33333333-3333-4333-8333-333333333333';
const seed = {
  contracts: [{ id: contractId, award_id: 'award', project_id: 'project', status: 'ready', total_millimes: 1250000, current_version_id: versionId, signature_mode: 'trusted_simple', legal_effect_enabled: false, validated_at: '2026-10-14T00:00:00Z', created_at: '2026-10-13T00:00:00Z', updated_at: '2026-10-14T00:00:00Z' }],
  contract_versions: [{ id: versionId, contract_id: contractId, version_no: 1, content_hash: 'a'.repeat(64), created_at: '2026-10-13T00:00:00Z', content: { secret: 'must-not-leak' } }],
  contract_items: [{ id: 'item', contract_id: contractId, request_id: 'request', agreed_millimes: 1250000, title: 'Électricité', scope: 'Pose', duration_days: 4, inclusions: 'Main-d’œuvre', exclusions: null, created_at: '2026-10-13T00:00:00Z' }],
  contract_parties: [{ contract_id: contractId, role: 'client', legal_name: 'Client test' }, { contract_id: contractId, role: 'contractor', legal_name: 'Atelier test' }],
  contract_acceptances: [{ contract_id: contractId, party_role: 'client', method: 'trusted_simple', accepted_at: '2026-10-13T12:00:00Z', evidence_hash: 'private', provider_reference: 'private' }],
  contract_events: [{ id: 'event', contract_id: contractId, event_type: 'status_changed', from_status: 'review', to_status: 'ready', reason: 'Contrôle', metadata: { private: true }, created_at: '2026-10-14T00:00:00Z' }],
  contract_archives: [{ id: 'archive', contract_id: contractId, original_name: 'contrat.pdf', mime_type: 'application/pdf', size_bytes: 100, content_hash: 'b'.repeat(64), object_path: 'private/path', created_at: '2026-10-14T00:00:00Z' }],
  contract_amendments: [{ id: amendmentId, contract_id: contractId, base_contract_version_id: versionId, status: 'accepted', legal_effect_enabled: false, created_at: '2026-10-14T00:00:00Z' }],
  contract_amendment_versions: [{ id: 'amendment-version', amendment_id: amendmentId, version_no: 1, content_hash: 'c'.repeat(64), created_at: '2026-10-14T00:00:00Z', content: { reason: 'Évolution', scope_clarification: 'Sans nouveau lot', amount_delta_millimes: 50000, base_total_millimes: 1250000, proposed_total_millimes: 1300000, planned_start_date: '2027-01-01', duration_days: 5, non_engaging: true, internal: 'must-not-leak' } }],
  contract_amendment_acceptances: [{ amendment_id: amendmentId, party_role: 'client', method: 'trusted_simple', accepted_at: '2026-10-14T01:00:00Z', evidence_hash: 'private' }],
  contract_amendment_events: [{ id: 'amendment-event', amendment_id: amendmentId, event_type: 'accepted', from_status: 'awaiting_acceptances', to_status: 'accepted', reason: 'Contrôle', metadata: { private: true }, created_at: '2026-10-14T02:00:00Z' }],
};

test('contract reader returns an explicit read-only projection without proof secrets or storage paths', async () => {
  const service = new ContractReadService(database(seed));
  const list = await service.list();
  assert.equal(list.length, 1); assert.equal(list[0].amendment_count, 1); assert.equal(list[0].non_engaging, true);
  const detail: any = await service.detail(contractId);
  assert.equal(detail.contract.total_millimes, 1250000);
  assert.equal(detail.amendments[0].proposal.proposed_total_millimes, 1300000);
  assert.equal(detail.amendments[0].proposal.non_engaging, true);
  const serialized = JSON.stringify(detail);
  for (const forbidden of ['must-not-leak', 'private/path', 'provider_reference', 'evidence_hash', '"metadata"']) assert.equal(serialized.includes(forbidden), false, forbidden);
});

test('contract API requires authentication and hides inaccessible identifiers as not found', async () => {
  const anonymous = createDaoApi({ contracts: new ContractReadService(database(seed)) } as any, async () => null);
  assert.equal((await anonymous.listContracts(new Request('http://localhost/api/contracts'))).status, 401);
  const authenticated = createDaoApi({ contracts: new ContractReadService(database({ ...seed, contracts: [] })) } as any, async () => ({ id: 'actor' }));
  const response = await authenticated.contractDetail(new Request(`http://localhost/api/contracts/${contractId}`, { headers: { authorization: 'Bearer jwt' } }), contractId);
  assert.equal(response.status, 404);
  const payload = await response.json(); assert.match(payload.error, /introuvable ou inaccessible/);
});

test('contract detail rejects malformed object identifiers before any query', async () => {
  const service = new ContractReadService(database(seed));
  await assert.rejects(() => service.detail('../contracts'), (error: any) => error.code === 'BAD_REQUEST');
});
