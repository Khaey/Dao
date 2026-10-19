import test from 'node:test';
import assert from 'node:assert/strict';
import { SiteExecutionService } from '../src/services/SiteExecutionService.js';
import { createDaoApi } from '../src/server/nextHandlers.js';

function database() {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  return {
    calls,
    db: {
      async rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args });
        return { data: { name, ...args }, error: null };
      },
    },
  };
}

test('site execution service maps only server-approved RPC parameters', async () => {
  const fake = database();
  const service = new SiteExecutionService(fake.db);
  const award = '11111111-1111-4111-8111-111111111111';
  const document = '22222222-2222-4222-8222-222222222222';
  await service.progress({
    award_item_id: award, status: 'in_progress', percent: 35, reason: 'Pose en cours',
    document_ids: [document], idempotency_key: 'progress-123',
    actor_id: 'forged', project_id: 'forged', contractor_id: 'forged',
  });
  await service.intervention({
    award_item_id: award, work_date: '2026-10-19', note: 'Pose terminée', percent: 50,
    idempotency_key: 'intervention-123',
  });
  assert.deepEqual(fake.calls, [
    { name: 'record_site_progress', args: {
      p_award_item_id: award, p_status: 'in_progress', p_percent: 35,
      p_reason: 'Pose en cours', p_document_ids: [document], p_idempotency_key: 'progress-123',
    } },
    { name: 'record_site_intervention', args: {
      p_award_item_id: award, p_work_date: '2026-10-19', p_note: 'Pose terminée',
      p_percent: 50, p_document_ids: [], p_idempotency_key: 'intervention-123',
    } },
  ]);
});

test('site execution handler requires JWT authentication', async () => {
  const anonymous = createDaoApi({ siteExecution: new SiteExecutionService(database().db) } as any, async () => null);
  const response = await anonymous.siteExecutionSnapshot(new Request('http://dao.test/api/projects/execution?project_id=project'));
  assert.equal(response.status, 401);
});

test('site execution handler rejects an unknown mutation kind', async () => {
  const authenticated = createDaoApi({ siteExecution: new SiteExecutionService(database().db) } as any, async () => ({ id: 'actor' }));
  const response = await authenticated.recordSiteExecution(new Request('http://dao.test/api/projects/execution', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'receipt' }),
  }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'BAD_REQUEST');
});

test('site execution service validates cursor and document list before RPC', async () => {
  const service = new SiteExecutionService(database().db);
  await assert.rejects(() => service.snapshot('11111111-1111-4111-8111-111111111111', 'not-a-date', 30), /Invalid cursor/);
  await assert.rejects(() => service.progress({
    award_item_id: '11111111-1111-4111-8111-111111111111', status: 'in_progress', percent: 1, reason: 'Motif',
    document_ids: 'forged', idempotency_key: 'progress-123',
  }), /document_ids must be an array/);
});
