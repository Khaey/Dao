import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

test('precontract agreement: real JWT, bilateral version and non-engaging isolation', async () => {
  const url = process.env.DAO_SUPABASE_URL!;
  assert.equal(url, 'http://127.0.0.1:54321');
  const publishable = process.env.DAO_SUPABASE_PUBLISHABLE_KEY!;
  const secret = process.env.DAO_SUPABASE_SECRET_KEY!;
  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const password = 'P9-A1-' + randomUUID();

  async function actor(label: string, roles: string[]) {
    const email = 'p9-' + label + '-' + randomUUID() + '@example.invalid';
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.ifError(created.error);
    const id = created.data.user!.id;
    assert.ifError((await admin.from('profiles').insert({
      user_id: id,
      display_name: label,
      last_workspace: roles[0] === 'contractor' ? 'contractor' : 'client',
    })).error);
    for (const role of roles) {
      assert.ifError((await admin.from('user_roles').insert({ user_id: id, role })).error);
    }
    const auth = createClient(url, publishable, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signed = await auth.auth.signInWithPassword({ email, password });
    assert.ifError(signed.error);
    return {
      id,
      db: createClient(url, publishable, {
        global: { headers: { Authorization: 'Bearer ' + signed.data.session!.access_token } },
        auth: { persistSession: false, autoRefreshToken: false },
      }),
    };
  }

  async function denied(
    db: any,
    name: string,
    args: Record<string, unknown>,
    code = '42501',
  ) {
    const result = await db.rpc(name, args);
    assert.ok(result.error, name + ' must be denied');
    assert.equal(result.error.code, code);
  }

  const owner = await actor('client', ['client']);
  const otherClient = await actor('other-client', ['client']);
  const contractor = await actor('artisan', ['contractor']);
  const competitor = await actor('competitor', ['contractor']);
  const staff = await actor('staff', ['dao_reviewer']);

  const contractorProfile = await admin.from('contractor_profiles').insert({
    user_id: contractor.id,
    business_name: 'Atelier P9',
    verification_status: 'verified',
    contractor_type: 'artisan',
    public_identity_status: 'approved',
  }).select('id').single();
  assert.ifError(contractorProfile.error);
  const competitorProfile = await admin.from('contractor_profiles').insert({
    user_id: competitor.id,
    business_name: 'Concurrent P9',
    verification_status: 'verified',
    contractor_type: 'artisan',
    public_identity_status: 'approved',
  }).select('id').single();
  assert.ifError(competitorProfile.error);

  const project = await admin.from('projects').insert({
    client_id: owner.id,
    initiator_id: owner.id,
    project_origin: 'client_marketplace',
  }).select('id').single();
  assert.ifError(project.error);
  const governorate = await admin.from('governorates').select('id').limit(1).single();
  const trade = await admin.from('trades').select('id').limit(1).single();
  assert.ifError(governorate.error);
  assert.ifError(trade.error);
  assert.ifError((await admin.from('project_versions').insert({
    project_id: project.data!.id,
    version_no: 1,
    title: 'Accord précontractuel réel',
    description: 'Conditions avant contrat',
    governorate_id: governorate.data!.id,
  })).error);
  const request = await admin.from('project_requests').insert({
    project_id: project.data!.id,
    status: 'awarded',
  }).select('id').single();
  assert.ifError(request.error);
  const requestVersion = await admin.from('project_request_versions').insert({
    project_id: project.data!.id,
    request_id: request.data!.id,
    version_no: 1,
    trade_id: trade.data!.id,
    title: 'Lot électricité attribué',
    scope: 'Installation attribuée',
    budget_millimes: 100000,
  }).select('id').single();
  assert.ifError(requestVersion.error);
  const bid = await admin.from('bids').insert({
    project_id: project.data!.id,
    contractor_id: contractorProfile.data!.id,
  }).select('id').single();
  assert.ifError(bid.error);
  const bidVersion = await admin.from('bid_versions').insert({
    bid_id: bid.data!.id,
    project_id: project.data!.id,
    contractor_id: contractorProfile.data!.id,
    version_no: 1,
    status: 'draft',
    validity: 'current',
    expires_at: '2099-01-01',
  }).select('id').single();
  assert.ifError(bidVersion.error);
  const bidItem = await admin.from('bid_items').insert({
    bid_version_id: bidVersion.data!.id,
    project_id: project.data!.id,
    contractor_id: contractorProfile.data!.id,
    request_version_id: requestVersion.data!.id,
    request_id: request.data!.id,
    price_millimes: 100000,
    duration_days: 5,
    inclusions: 'Pose et essais',
    exclusions: null,
  }).select('id').single();
  assert.ifError(bidItem.error);
  const nodeKey = randomUUID();
  assert.ifError((await admin.from('bid_sub_lots').insert({
    bid_version_id: bidVersion.data!.id,
    bid_item_id: bidItem.data!.id,
    project_id: project.data!.id,
    request_id: request.data!.id,
    contractor_id: contractorProfile.data!.id,
    node_key: nodeKey,
    position: 1,
    title: 'Pose du tableau',
    duration_days: 2,
    budget_millimes: 100000,
  })).error);
  assert.ifError((await admin.from('bid_versions').update({
    status: 'submitted',
    submitted_at: new Date().toISOString(),
  }).eq('id', bidVersion.data!.id)).error);

  const award = await admin.from('awards').insert({
    project_id: project.data!.id,
    contractor_id: contractorProfile.data!.id,
    status: 'confirmed',
  }).select('id').single();
  assert.ifError(award.error);
  assert.ifError((await admin.from('award_items').insert({
    award_id: award.data!.id,
    project_id: project.data!.id,
    contractor_id: contractorProfile.data!.id,
    request_id: request.data!.id,
    bid_item_id: bidItem.data!.id,
    agreed_millimes: 100000,
    active: true,
  })).error);

  const snapshotArgs = { p_award_id: award.data!.id };
  for (const outsider of [otherClient, competitor, staff]) {
    await denied(outsider.db, 'precontract_agreement_snapshot', snapshotArgs);
  }

  const firstKey = randomUUID();
  const firstArgs = {
    p_award_id: award.data!.id,
    p_base_version_id: null,
    p_terms: {
      planned_start_date: '2026-11-02',
      duration_days: 5,
      execution_terms: 'Accès au chantier à 08:00',
      payment_mode: 'weekly',
      installments: [{ label: 'Fin de semaine', amount_millimes: 100000 }],
      sub_lot_schedule: [{
        node_key: nodeKey,
        start_date: '2026-11-02',
        end_date: '2026-11-03',
        duration_days: 2,
      }],
    },
    p_idempotency_key: firstKey,
  };
  const first = await owner.db.rpc('propose_precontract_agreement', firstArgs);
  assert.ifError(first.error);
  assert.equal(first.data.status, 'negotiating');
  assert.equal(first.data.non_engaging, true);
  assert.equal(first.data.legal_effect_enabled, false);
  const replay = await owner.db.rpc('propose_precontract_agreement', firstArgs);
  assert.ifError(replay.error);
  assert.equal(replay.data.version_id, first.data.version_id);

  await denied(contractor.db, 'propose_precontract_agreement', {
    ...firstArgs,
    p_base_version_id: randomUUID(),
    p_idempotency_key: randomUUID(),
  }, '23514');

  const second = await contractor.db.rpc('propose_precontract_agreement', {
    p_award_id: award.data!.id,
    p_base_version_id: first.data.version_id,
    p_terms: {
      planned_start_date: '2026-11-03',
      duration_days: 5,
      execution_terms: 'Accès confirmé',
      payment_mode: 'weekly',
      installments: [{
        label: 'Présentation de fin de semaine',
        due_date: '2026-11-08',
        amount_millimes: 100000,
      }],
      sub_lot_schedule: [],
    },
    p_idempotency_key: randomUUID(),
  });
  assert.ifError(second.error);
  assert.equal(second.data.version_no, 2);

  await denied(owner.db, 'accept_precontract_agreement', {
    p_agreement_id: second.data.agreement_id,
    p_version_id: first.data.version_id,
    p_idempotency_key: randomUUID(),
  }, '23514');

  const clientAcceptance = await owner.db.rpc('accept_precontract_agreement', {
    p_agreement_id: second.data.agreement_id,
    p_version_id: second.data.version_id,
    p_idempotency_key: randomUUID(),
  });
  assert.ifError(clientAcceptance.error);
  assert.equal(clientAcceptance.data.status, 'negotiating');
  const contractorAcceptance = await contractor.db.rpc('accept_precontract_agreement', {
    p_agreement_id: second.data.agreement_id,
    p_version_id: second.data.version_id,
    p_idempotency_key: randomUUID(),
  });
  assert.ifError(contractorAcceptance.error);
  assert.equal(contractorAcceptance.data.status, 'agreed');
  assert.equal(contractorAcceptance.data.contract_signed, false);

  const snapshot = await owner.db.rpc('precontract_agreement_snapshot', snapshotArgs);
  assert.ifError(snapshot.error);
  assert.equal(snapshot.data.agreement.status, 'agreed');
  assert.equal(snapshot.data.current_version.version_no, 2);
  assert.equal(snapshot.data.reference.total_millimes, 100000);
  assert.equal(snapshot.data.reference.items[0].sub_lots[0].node_key, nodeKey);
  assert.equal(snapshot.data.acceptances.length, 2);
  assert.equal(snapshot.data.legal_effect_enabled, false);

  const initialSchedule = await contractor.db.rpc('precontract_installment_snapshot', snapshotArgs);
  assert.ifError(initialSchedule.error);
  assert.equal(initialSchedule.data.agreement_version_id, second.data.version_id);
  assert.equal(initialSchedule.data.installments[0].status, 'pending');
  assert.equal(initialSchedule.data.installments[0].can_declare, true);
  assert.equal(initialSchedule.data.informational_only, true);
  assert.equal(initialSchedule.data.money_moved, false);
  await denied(competitor.db, 'precontract_installment_snapshot', snapshotArgs);

  const declarationKey = randomUUID();
  const declarationArgs = {
    p_agreement_id: second.data.agreement_id,
    p_version_id: second.data.version_id,
    p_installment_no: 1,
    p_event_type: 'declared',
    p_reason: null,
    p_idempotency_key: declarationKey,
  };
  const declaration = await contractor.db.rpc(
    'record_precontract_installment_event', declarationArgs,
  );
  assert.ifError(declaration.error);
  assert.equal(declaration.data.status, 'declared');
  assert.equal(declaration.data.payment_recorded, false);
  const declarationReplay = await contractor.db.rpc(
    'record_precontract_installment_event', declarationArgs,
  );
  assert.ifError(declarationReplay.error);
  assert.equal(declarationReplay.data.event_id, declaration.data.event_id);
  await denied(contractor.db, 'record_precontract_installment_event', {
    ...declarationArgs,
    p_event_type: 'authorized',
    p_idempotency_key: randomUUID(),
  }, '23514');
  await denied(competitor.db, 'record_precontract_installment_event', {
    ...declarationArgs,
    p_idempotency_key: randomUUID(),
  });

  const verified = await owner.db.rpc('record_precontract_installment_event', {
    ...declarationArgs,
    p_event_type: 'verified',
    p_idempotency_key: randomUUID(),
  });
  assert.ifError(verified.error);
  const authorized = await owner.db.rpc('record_precontract_installment_event', {
    ...declarationArgs,
    p_event_type: 'authorized',
    p_reason: 'Autorisation informative, aucun paiement',
    p_idempotency_key: randomUUID(),
  });
  assert.ifError(authorized.error);
  assert.equal(authorized.data.status, 'authorized');
  assert.equal(authorized.data.money_moved, false);
  assert.equal(authorized.data.debt_created, false);

  const authorizedSchedule = await owner.db.rpc(
    'precontract_installment_snapshot', snapshotArgs,
  );
  assert.ifError(authorizedSchedule.error);
  assert.equal(authorizedSchedule.data.installments[0].status, 'authorized');
  assert.equal(authorizedSchedule.data.installments[0].can_authorize, false);
  assert.equal(authorizedSchedule.data.events.length, 3);
  // #397: server-assigned sequence is monotone; UUID order is not event order.
  const history = await admin.from('precontract_installment_events')
    .select('event_seq,event_type')
    .eq('agreement_version_id', second.data.version_id)
    .order('event_seq', { ascending: true });
  assert.ifError(history.error);
  assert.deepEqual(history.data!.map(event => event.event_type),
    ['declared', 'verified', 'authorized']);
  assert.equal(new Set(history.data!.map(event => event.event_seq)).size, 3);
  assert.ok(history.data![0].event_seq < history.data![1].event_seq);
  assert.ok(history.data![1].event_seq < history.data![2].event_seq);

  assert.ok((await admin.from('precontract_agreement_versions')
    .update({ content_hash: '0'.repeat(64) })
    .eq('id', second.data.version_id)).error);
  assert.ok((await admin.from('precontract_agreement_acceptances')
    .delete()
    .eq('agreement_id', second.data.agreement_id)).error);
  assert.ok((await admin.from('precontract_installment_events')
    .update({ event_type: 'verified' })
    .eq('id', authorized.data.event_id)).error);

  const third = await owner.db.rpc('propose_precontract_agreement', {
    p_award_id: award.data!.id,
    p_base_version_id: second.data.version_id,
    p_terms: { payment_mode: 'project_end', installments: [] },
    p_idempotency_key: randomUUID(),
  });
  assert.ifError(third.error);
  assert.equal(third.data.status, 'negotiating');
  const rejected = await contractor.db.rpc('reject_precontract_agreement', {
    p_agreement_id: third.data.agreement_id,
    p_version_id: third.data.version_id,
    p_reason: 'Date à revoir',
    p_idempotency_key: randomUUID(),
  });
  assert.ifError(rejected.error);
  assert.equal(rejected.data.status, 'rejected');

  await denied(owner.db, 'propose_precontract_agreement', {
    p_award_id: award.data!.id,
    p_base_version_id: third.data.version_id,
    p_terms: {
      payment_mode: 'monthly',
      installments: [{ label: 'Montant incohérent', amount_millimes: 99999 }],
    },
    p_idempotency_key: randomUUID(),
  }, '23514');

  assert.ifError((await admin.from('account_states').insert({
    user_id: contractor.id,
    status: 'suspended',
  })).error);
  await denied(contractor.db, 'precontract_agreement_snapshot', snapshotArgs);
});
