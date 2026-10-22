import test from 'node:test';
import assert from 'node:assert/strict';
import { ContractPreparationService } from '../src/services/ContractPreparationService.js';

const actorId = '11111111-1111-4111-8111-111111111111';
const awardId = '22222222-2222-4222-8222-222222222222';
const daoAdminUserId = '33333333-3333-4333-8333-333333333333';
const idempotencyKey = '44444444-4444-4444-8444-444444444444';
const request = { contractEnabled: true, actorId, awardId, daoAdminUserId, idempotencyKey, daoLegalName: 'LogicLab Tunisie' };

test('contract disabled never invokes a privileged RPC', async () => {
  const service = new ContractPreparationService({ rpc: async () => { throw new Error('unexpected RPC'); } });
  assert.deepEqual(await service.prepareOnAward({ ...request, contractEnabled: false }), { prepared: false, reason: 'contract_disabled' });
});

test('enabled contract preparation calls only existing foundation RPC with supplied legal identity', async () => {
  const calls: Array<{ name: string; args: Record<string, string> }> = [];
  const service = new ContractPreparationService({ rpc: async (name, args) => { calls.push({ name, args }); return { data: { id: 'draft' }, error: null }; } });
  assert.deepEqual(await service.prepareOnAward(request), { prepared: true, result: { id: 'draft' }, legallySigned: false });
  assert.deepEqual(calls, [{ name: 'prepare_contract_foundation', args: {
    p_actor_id: actorId, p_award_id: awardId, p_dao_user_id: daoAdminUserId, p_dao_legal_name: 'LogicLab Tunisie', p_idempotency_key: idempotencyKey,
  } }]);
});

test('rejects invalid legal identity and IDs before privileged RPC', async () => {
  const service = new ContractPreparationService({ rpc: async () => { throw new Error('unexpected RPC'); } });
  await assert.rejects(() => service.prepareOnAward({ ...request, daoLegalName: '' }), /legal name/);
  await assert.rejects(() => service.prepareOnAward({ ...request, awardId: 'not-a-uuid' }), /Invalid UUID/);
});
