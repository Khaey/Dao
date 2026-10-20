import test from 'node:test';
import assert from 'node:assert/strict';
import { PrecontractAgreementService } from '../src/services/PrecontractAgreementService.js';
import { createDaoApi } from '../src/server/nextHandlers.js';

const award = '11111111-1111-4111-8111-111111111111';
const agreement = '22222222-2222-4222-8222-222222222222';
const version = '33333333-3333-4333-8333-333333333333';
const key = '44444444-4444-4444-8444-444444444444';

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

test('precontract service maps only the stable DTO to authenticated RPCs', async () => {
  const fake = database();
  const service = new PrecontractAgreementService(fake.db);
  await service.propose({
    award_id: award,
    base_version_id: null,
    terms: { payment_mode: 'weekly', installments: [] },
    idempotency_key: key,
    actor_id: 'forged',
    total_millimes: 1,
    legal_effect_enabled: true,
  });
  await service.accept({
    agreement_id: agreement,
    version_id: version,
    idempotency_key: key,
    accepted_by: 'forged',
  });
  assert.deepEqual(fake.calls, [
    {
      name: 'propose_precontract_agreement',
      args: {
        p_award_id: award,
        p_base_version_id: null,
        p_terms: { payment_mode: 'weekly', installments: [] },
        p_idempotency_key: key,
      },
    },
    {
      name: 'accept_precontract_agreement',
      args: {
        p_agreement_id: agreement,
        p_version_id: version,
        p_idempotency_key: key,
      },
    },
  ]);
});

test('precontract handler requires JWT and rejects unknown actions', async () => {
  const anonymous = createDaoApi({
    precontractAgreements: new PrecontractAgreementService(database().db),
  } as any, async () => null);
  const unauthenticated = await anonymous.precontractAgreementSnapshot(
    new Request('http://dao.test/api/contracts/agreements?award_id=' + award),
  );
  assert.equal(unauthenticated.status, 401);

  const authenticated = createDaoApi({
    precontractAgreements: new PrecontractAgreementService(database().db),
  } as any, async () => ({ id: award }));
  const response = await authenticated.mutatePrecontractAgreement(new Request(
    'http://dao.test/api/contracts/agreements',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sign', agreement_id: agreement }),
    },
  ));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'BAD_REQUEST');
});

test('precontract service rejects unsupported fields before the RPC', async () => {
  const fake = database();
  const service = new PrecontractAgreementService(fake.db);
  await assert.rejects(() => service.propose({
    award_id: award,
    terms: { payment_mode: 'weekly', paid: true },
    idempotency_key: key,
  }), /unsupported field/);
  assert.equal(fake.calls.length, 0);
});
