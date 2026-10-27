import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

test('contract setting prepares non-engaging drafts atomically after awards', async () => {
  const url = process.env.DAO_SUPABASE_URL!;
  assert.equal(url, 'http://127.0.0.1:54321', 'contract preparation requires disposable Supabase');
  const key = process.env.DAO_SUPABASE_PUBLISHABLE_KEY!;
  const secret = process.env.DAO_SUPABASE_SECRET_KEY!;
  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

  async function user(role: 'client' | 'contractor', name: string) {
    const email = `contract-auto-${name}-${randomUUID()}@example.invalid`;
    const password = `P2!${randomUUID()}`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.ifError(created.error);
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    assert.ifError((await db.auth.signInWithPassword({ email, password })).error);
    const initialized = await db.rpc('initialize_my_account', {
      p_display_name: name,
      p_phone_e164: null,
      p_account_type: role,
      p_business_name: role === 'contractor' ? name : null,
    });
    assert.ifError(initialized.error);
    if (role === 'contractor') {
      assert.ifError((await admin.from('contractor_profiles')
        .update({ verification_status: 'verified' })
        .eq('user_id', created.data.user!.id)).error);
    }
    return { id: created.data.user!.id, db };
  }

  const client = await user('client', 'client');
  const other = await user('client', 'other');
  const pro = await user('contractor', 'pro');
  const competitor = await user('contractor', 'competitor');
  const dao = await user('client', 'dao');
  assert.ifError((await admin.from('user_roles').insert({ user_id: dao.id, role: 'dao_admin' })).error);

  const configured = await dao.db.rpc('configure_contract_runtime', {
    p_dao_user_id: dao.id,
    p_dao_legal_name: 'LogicLab Tunisie',
    p_enabled: true,
    p_idempotency_key: randomUUID(),
  });
  assert.ifError(configured.error);
  assert.equal(configured.data.dao_legal_name, 'LogicLab Tunisie');
  const badCarrier = await dao.db.rpc('configure_contract_runtime', {
    p_dao_user_id: dao.id,
    p_dao_legal_name: 'Entité inventée',
    p_enabled: true,
    p_idempotency_key: randomUUID(),
  });
  assert.equal(badCarrier.error?.code, '22023');

  const governorate = (await admin.from('governorates').select('id').eq('code', 'E2E_TEST').single()).data!.id;
  const trade = (await admin.from('trades').select('id').eq('code', 'plumbing').single()).data!.id;
  async function insert(table: string, values: Record<string, unknown>) {
    const result = await admin.from(table).insert(values).select('*').single();
    assert.ifError(result.error);
    return result.data;
  }
  async function fixture(lots = 1) {
    const project = await insert('projects', { client_id: client.id });
    const version = await insert('project_versions', {
      project_id: project.id, version_no: 1, title: `Auto contract ${randomUUID()}`,
      description: 'safe', governorate_id: governorate, status: 'approved',
    });
    const publication = await insert('publications', {
      project_id: project.id, project_version_id: version.id, visibility: 'public',
      safe_title: version.title, safe_description: 'safe', governorate_id: governorate,
      project_type: 'renovation', published_at: new Date().toISOString(),
    });
    const requests = [];
    for (let index = 0; index < lots; index += 1) {
      const request = await insert('project_requests', { project_id: project.id });
      const requestVersion = await insert('project_request_versions', {
        project_id: project.id, request_id: request.id, version_no: 1,
        title: `Lot ${index}`, scope: 'safe', trade_id: trade,
      });
      const published = await insert('publication_requests', {
        publication_id: publication.id, request_version_id: requestVersion.id,
        safe_title: requestVersion.title, safe_scope: 'safe', trade_id: trade,
      });
      requests.push({ id: request.id, publicationRequestId: published.id });
    }
    const draft = await pro.db.rpc('create_bid_draft', { p_publication_id: publication.id });
    assert.ifError(draft.error);
    const items = [];
    for (const request of requests) {
      const item = await pro.db.rpc('upsert_bid_item', {
        p_publication_id: publication.id,
        p_version_id: draft.data.id,
        p_publication_request_id: request.publicationRequestId,
        p_price_millimes: 1500,
        p_duration_days: 3,
        p_inclusions: 'Pose',
        p_exclusions: null,
      });
      assert.ifError(item.error);
      items.push(item.data);
    }
    assert.ifError((await pro.db.rpc('submit_bid_version', { p_version_id: draft.data.id })).error);
    return { project, items };
  }

  const disabled = await fixture();
  const disabledAward = await client.db.rpc('award_bid_item_atomic', {
    p_idempotency_key: randomUUID(), p_bid_item_id: disabled.items[0].id,
  });
  assert.ifError(disabledAward.error);
  assert.equal((await admin.from('contracts').select('id').eq('award_id', disabledAward.data.award_id)).data!.length, 0);
  const disabledSnapshot = await client.db.rpc('project_contract_configuration', { p_project_id: disabled.project.id });
  assert.ifError(disabledSnapshot.error);
  assert.equal(disabledSnapshot.data.enabled, false);
  assert.equal((await other.db.rpc('project_contract_configuration', { p_project_id: disabled.project.id })).error?.code, '42501');

  const enabled = await fixture(2);
  assert.equal((await pro.db.rpc('set_project_contract_enabled', {
    p_project_id: enabled.project.id, p_enabled: true, p_idempotency_key: randomUUID(),
  })).error?.code, '42501');
  const settingKey = randomUUID();
  const setting = await client.db.rpc('set_project_contract_enabled', {
    p_project_id: enabled.project.id, p_enabled: true, p_idempotency_key: settingKey,
  });
  assert.ifError(setting.error);
  const settingReplay = await client.db.rpc('set_project_contract_enabled', {
    p_project_id: enabled.project.id, p_enabled: true, p_idempotency_key: settingKey,
  });
  assert.ifError(settingReplay.error);
  assert.deepEqual(settingReplay.data, setting.data);

  const firstKey = randomUUID();
  const first = await client.db.rpc('award_bid_item_atomic', {
    p_idempotency_key: firstKey, p_bid_item_id: enabled.items[0].id,
  });
  assert.ifError(first.error);
  const firstReplay = await client.db.rpc('award_bid_item_atomic', {
    p_idempotency_key: firstKey, p_bid_item_id: enabled.items[0].id,
  });
  assert.ifError(firstReplay.error);
  assert.deepEqual(firstReplay.data, first.data);
  const firstContracts = await admin.from('contracts').select('id,status,total_millimes').eq('award_id', first.data.award_id);
  assert.ifError(firstContracts.error);
  assert.equal(firstContracts.data!.length, 1);
  assert.equal(firstContracts.data![0].status, 'draft');
  assert.equal(firstContracts.data![0].total_millimes, 1500);

  const second = await client.db.rpc('award_bid_item_atomic', {
    p_idempotency_key: randomUUID(), p_bid_item_id: enabled.items[1].id,
  });
  assert.ifError(second.error);
  assert.notEqual(second.data.award_id, first.data.award_id, 'canonical contracts remain one per award');
  const projectContracts = await admin.from('contracts').select('id,award_id').eq('project_id', enabled.project.id);
  assert.ifError(projectContracts.error);
  assert.equal(projectContracts.data!.length, 2);

  for (const actor of [client, pro, dao]) {
    const visible = await actor.db.from('contracts').select('id,status').eq('project_id', enabled.project.id);
    assert.ifError(visible.error);
    assert.equal(visible.data!.length, 2);
  }
  for (const actor of [other, competitor]) {
    const hidden = await actor.db.from('contracts').select('id').eq('project_id', enabled.project.id);
    assert.ifError(hidden.error);
    assert.equal(hidden.data!.length, 0);
  }
  const parties = await admin.from('contract_parties').select('role,legal_name').in('contract_id', projectContracts.data!.map(row => row.id));
  assert.ifError(parties.error);
  assert.equal(parties.data!.filter(row => row.role === 'dao').every(row => row.legal_name === 'LogicLab Tunisie'), true);
  assert.equal((await client.db.rpc('cancel_award_item_atomic', {
    p_idempotency_key: randomUUID(), p_award_item_id: first.data.award_item_id,
    p_reason: 'withdrawal', p_comment: null,
  })).error?.code, '23514');
  assert.equal((await client.db.rpc('set_project_contract_enabled', {
    p_project_id: enabled.project.id, p_enabled: false, p_idempotency_key: randomUUID(),
  })).error?.code, '23514');
});
