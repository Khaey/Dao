import test from 'node:test';
import assert from 'node:assert/strict';
import { ContractConfigurationService } from '../src/services/ContractConfigurationService.js';

test('contract configuration facade sends only typed server commands', async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const service = new ContractConfigurationService({
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: { ok: true }, error: null };
    },
  });

  await service.project('project-id');
  await service.setProject({ project_id: 'project-id', enabled: true, idempotency_key: 'project-key' });
  await service.configureRuntime({
    dao_user_id: 'dao-user', dao_legal_name: 'LogicLab Tunisie', enabled: true,
    idempotency_key: 'runtime-key', ignored_actor_id: 'forged',
  });

  assert.deepEqual(calls, [
    { name: 'project_contract_configuration', args: { p_project_id: 'project-id' } },
    { name: 'set_project_contract_enabled', args: {
      p_project_id: 'project-id', p_enabled: true, p_idempotency_key: 'project-key',
    } },
    { name: 'configure_contract_runtime', args: {
      p_dao_user_id: 'dao-user', p_dao_legal_name: 'LogicLab Tunisie',
      p_enabled: true, p_idempotency_key: 'runtime-key',
    } },
  ]);
});

test('contract configuration facade propagates database authorization failures', async () => {
  const denied = Object.assign(new Error('denied'), { code: '42501' });
  const service = new ContractConfigurationService({
    rpc: async () => ({ data: null, error: denied }),
  });
  await assert.rejects(() => service.setProject({}), (error: any) => error.code === '42501');
});
