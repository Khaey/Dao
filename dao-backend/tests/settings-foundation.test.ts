import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import {
  SETTINGS_CATALOG, SETTINGS_CATALOG_VERSION, assertCatalogConsistent, validateSettingValue, settingDefinition,
} from '../src/settings/catalog.js';
import { catalogHash } from '../src/settings/projection.js';
import { CATALOG_BLOCK, catalogBlock } from '../src/settings/sync-migration.js';

const migrations = resolve('supabase/migrations');
const catalogMigrations = () => readdirSync(migrations).filter(f => f.endsWith('.sql')).sort()
  .filter(f => CATALOG_BLOCK.test(readFileSync(resolve(migrations, f), 'utf8')));

test('settings catalogue: 23 typed tranche-1 entries, consistent and validated', () => {
  assertCatalogConsistent();
  assert.equal(SETTINGS_CATALOG.length, 23);
  const families = Object.fromEntries(['capability', 'value', 'catalog', 'federated']
    .map(f => [f, SETTINGS_CATALOG.filter(d => d.family === f).length]));
  assert.deepEqual(families, { capability: 11, value: 6, catalog: 1, federated: 5 });
  // A1: delegable capabilities are exactly 1,2,3,4,6,7,8,9 of the S0 table.
  assert.deepEqual(SETTINGS_CATALOG.filter(d => d.delegable).map(d => d.key).sort(), [
    'bids.counter_proposals', 'bids.proposed_sub_lots', 'bids.quote_lines', 'bids.quote_pdf', 'bids.rfi',
    'client.invite_professionals', 'client.offer_comparison', 'publication.visibility_modes']);
  // Defaults reproduce today's hard-coded behaviour.
  const defaults = Object.fromEntries(SETTINGS_CATALOG.filter(d => d.family === 'value').map(d => [d.key, d.default]));
  assert.deepEqual(defaults, { 'publication.default_submission_days': 30, 'invitations.ttl_days': 7,
    'invitations.reminder_hours_before': 24, 'messaging.max_per_minute': 20, 'uploads.max_file_mb': 20,
    'reviews.response_edit_days': 30 });
  const upload = settingDefinition('uploads.max_file_mb')!;
  assert.throws(() => validateSettingValue(upload, 21), /invalid_setting_value/); // A6: no blind increase
  assert.throws(() => validateSettingValue(upload, 2.5));
  const modes = settingDefinition('publication.visibility_modes')!;
  assert.deepEqual(validateSettingValue(modes, ['invite_only', 'public']), ['public', 'invite_only']);
  assert.throws(() => validateSettingValue(modes, []));
  assert.throws(() => validateSettingValue(modes, ['public', 'public']));
  assert.throws(() => assertCatalogConsistent([...SETTINGS_CATALOG, { ...SETTINGS_CATALOG[0] }]), /duplicate/);
  assert.throws(() => assertCatalogConsistent([{ ...SETTINGS_CATALOG[2], requires: ['bids.rfi'] }]), /unknown_dependency/);
});

test('settings catalogue: latest catalogue migration mirrors catalog.ts exactly (CI drift guard)', () => {
  const latest = catalogMigrations().at(-1)!;
  const block = readFileSync(resolve(migrations, latest), 'utf8').match(CATALOG_BLOCK)?.[0];
  assert.equal(block, catalogBlock(), `run: npm run settings:sync -- supabase/migrations/${latest}`);
});

test('settings S1 resolver: one JWT-scoped read, federated choices, refusals (PGlite, not real JWT)', async () => {
  const db = new PGlite(); test.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;
    create schema storage;create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated;
    grant select,insert,update,delete on storage.objects to anon,authenticated;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
  for (const file of readdirSync(migrations).filter(x => x.endsWith('.sql')).sort())
    await db.exec(readFileSync(resolve(migrations, file), 'utf8'));
  const insert = async (table: string, input: Record<string, unknown>) => {
    const keys = Object.keys(input);
    return (await db.query<any>(`insert into ${table.includes('.') ? table : 'public.' + table}(${keys.join(',')}) values(${keys.map((_, i) => '$' + (i + 1)).join(',')}) returning *`, Object.values(input))).rows[0];
  };
  const as = async <T>(id: string | null, fn: () => Promise<T>) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id ?? '']);
    await db.exec(id ? 'set role authenticated' : 'set role anon');
    try { return await fn(); } finally { await db.exec("reset role;select set_config('request.jwt.claim.sub','',false)"); }
  };
  const read = (id: string, ws: string | null = null, project: string | null = null) =>
    as(id, async () => (await db.query<any>('select public.my_effective_settings($1,$2) data', [ws, project])).rows[0].data);
  const denied = (id: string | null, sql: string, params: unknown[] = []) => as(id, () => assert.rejects(db.query(sql, params), { code: '42501' }));

  const U = Object.fromEntries(['clientA', 'clientB', 'proA', 'proB', 'dual', 'reviewer', 'admin', 'suspended']
    .map(n => [n, randomUUID()])) as Record<string, string>;
  const roles: Record<string, string[]> = { clientA: ['client'], clientB: ['client'], proA: ['contractor'], proB: ['contractor'],
    dual: ['client', 'contractor'], reviewer: ['dao_reviewer'], admin: ['dao_admin'], suspended: ['client'] };
  const pro: Record<string, string> = {};
  for (const [name, id] of Object.entries(U)) {
    await db.query('insert into auth.users values($1,$2,now())', [id, `${name}@example.invalid`]);
    await insert('profiles', { user_id: id, display_name: name });
    for (const role of roles[name]) await insert('user_roles', { user_id: id, role });
    if (roles[name].includes('contractor'))
      pro[name] = (await insert('contractor_profiles', { user_id: id, business_name: name, verification_status: 'verified' })).id;
  }
  await insert('account_states', { user_id: U.suspended, status: 'suspended' });
  const project = (await insert('projects', { client_id: U.clientA })).id;

  await test('the database mirror equals the code catalogue', async () => {
    const state = (await db.query<any>('select catalog_version,catalog_hash from dao_private.settings_state')).rows[0];
    assert.deepEqual(state, { catalog_version: SETTINGS_CATALOG_VERSION, catalog_hash: catalogHash() });
    const keys = (await db.query<any>('select key from dao_private.setting_definitions where not retired order by key')).rows.map(r => r.key);
    assert.deepEqual(keys, SETTINGS_CATALOG.map(d => d.key).sort());
  });

  await test('Client read: defaults equal current behaviour, neutral provenance, one call', async () => {
    const dto = await read(U.clientA, 'client');
    assert.equal(dto.workspace, 'client'); assert.equal(dto.catalog_version, 1);
    assert.ok(Number.isInteger(Number(dto.version)));
    assert.deepEqual(dto.settings['client.invite_professionals'], { value: true, state: 'available', source: 'default' });
    assert.deepEqual(dto.settings['publication.default_submission_days'], { value: 30, state: 'available', source: 'default' });
    assert.deepEqual(dto.settings['publication.visibility_modes'].value, ['public', 'targeted', 'invite_only']);
    // Contract option requires the D.A.O representative runtime configuration (off on a fresh base).
    assert.deepEqual(dto.settings['contract.preparation_after_award'],
      { value: true, state: 'unavailable', source: 'default', reason: 'not_configured' });
    assert.equal(dto.settings['bids.quote_pdf'], undefined, 'contractor-only keys are not exposed to the Client workspace');
    assert.equal(dto.settings['project.contract_enabled'], undefined);
    assert.equal(dto.settings['catalog.trades.active'], undefined);
    for (const entry of Object.values<any>(dto.settings)) {
      assert.ok(['available', 'unavailable', 'owner_choice'].includes(entry.state));
      assert.ok(['default', 'owner'].includes(entry.source));
      if (entry.reason) assert.ok(['not_configured', 'not_implemented', 'depends_on', 'restricted'].includes(entry.reason));
    }
  });

  await test('federated owner choices are read from their real tables, per workspace', async () => {
    await as(U.proA, () => db.query('select public.set_my_bid_counter_preference(true)'));
    await insert('contractor_profile_details', { contractor_id: pro.proA, show_phone: true });
    const a = await read(U.proA, 'contractor');
    assert.deepEqual(a.settings['bids.counter_proposals'], { value: true, state: 'available', source: 'default', owner_choice: true });
    assert.deepEqual(a.settings['pref.contractor.counter_offers_optin'], { value: true, state: 'owner_choice', source: 'owner' });
    assert.equal(a.settings['pref.contractor.contact_visibility'].value.phone, true);
    assert.equal(a.settings['pref.contractor.contact_visibility'].value.email, false);
    const b = await read(U.proB, 'contractor');
    assert.equal(b.settings['bids.counter_proposals'].owner_choice, false, 'Artisan default stays opt-out');
    assert.deepEqual(b.settings['pref.contractor.contact_visibility'].source, 'default');
    await as(U.clientA, () => db.query('select public.update_my_notification_preferences(false)'));
    assert.deepEqual((await read(U.clientA, 'client')).settings['pref.notify.invitation_expiring'],
      { value: false, state: 'owner_choice', source: 'owner' });
    const withProject = await read(U.clientA, 'client', project);
    assert.deepEqual(withProject.settings['project.contract_enabled'], { value: false, state: 'owner_choice', source: 'default' });
  });

  await test('double role resolves in the requested workspace only, never the union', async () => {
    const asClient = await read(U.dual, 'client'), asPro = await read(U.dual, 'contractor');
    assert.ok(asClient.settings['client.invite_professionals'] && !asClient.settings['bids.quote_pdf']);
    assert.ok(asPro.settings['bids.quote_pdf'] && !asPro.settings['client.invite_professionals']);
    assert.equal((await read(U.dual)).workspace, 'client', 'default workspace follows the existing workspace helper');
    await denied(U.dual, "select public.my_effective_settings('staff')");
    await denied(U.clientA, "select public.my_effective_settings('contractor')");
    await denied(U.proA, "select public.my_effective_settings('client')");
    await denied(U.clientA, "select public.my_effective_settings('admin')");
  });

  await test('project scope: only owner, participant or assigned staff; no existence oracle', async () => {
    const sql = 'select public.my_effective_settings($1,$2)';
    await denied(U.clientB, sql, ['client', project]);
    await denied(U.proA, sql, ['contractor', project]);
    await denied(U.reviewer, sql, ['staff', project]);
    await denied(U.clientA, sql, ['client', randomUUID()]);
    assert.equal((await read(U.admin, 'staff', project)).workspace, 'staff');
    await insert('review_assignments', { project_id: project, reviewer_id: U.reviewer, assigned_at: new Date().toISOString() });
    const staff = await read(U.reviewer, 'staff', project);
    assert.deepEqual(Object.keys(staff.settings).sort(), ['messaging.max_per_minute', 'uploads.max_file_mb']);
  });

  await test('reviewer without mandate, anon and suspended accounts get nothing more', async () => {
    await denied(null, 'select public.my_effective_settings()');
    await denied(U.suspended, 'select public.my_effective_settings()');
    await denied(U.suspended, "select public.my_effective_settings('client')");
    for (const id of [U.clientA, U.reviewer, U.admin]) {
      await denied(id, 'select * from dao_private.setting_definitions');
      await denied(id, 'select * from dao_private.settings_state');
      await denied(id, "select dao_private.resolve_setting('bids.rfi',$1,'client',null)", [U.clientB]);
      await denied(id, "select dao_private.sync_setting_definitions(2,repeat('a',64),'[]'::jsonb)");
      await denied(id, "select dao_private.setting_federated_value('pref.contractor.counter_offers_optin',$1,'contractor',null)", [U.proA]);
      await denied(id, "insert into dao_private.setting_definitions(key) values('x.y')");
    }
    // A suspended user resolved internally is never "available".
    const internal = (await db.query<any>("select dao_private.resolve_setting('bids.rfi',$1,'client',null) r", [U.suspended])).rows[0].r;
    assert.equal(internal.state, 'unavailable');
  });

  await test('explicit condition: the contract option follows the runtime representative configuration', async () => {
    await db.query(`insert into dao_private.contract_runtime_configuration(singleton,enabled,dao_user_id,dao_legal_name,updated_by)
      values(true,true,$1,'LogicLab Tunisie',$1)`, [U.admin]);
    assert.deepEqual((await read(U.clientA, 'client')).settings['contract.preparation_after_award'],
      { value: true, state: 'available', source: 'default' });
  });

  await test('catalogue sync: monotonic version, idempotent, removed keys retired not deleted', async () => {
    const before = (await db.query<any>('select version from dao_private.settings_state')).rows[0].version;
    await assert.rejects(db.query("select dao_private.sync_setting_definitions(0,repeat('a',64),'[]'::jsonb)"), { code: '22023' });
    await db.exec('begin');
    try {
      await db.query(`select dao_private.sync_setting_definitions(2,repeat('b',64),
        (select jsonb_agg(x) from jsonb_array_elements($1::jsonb) x where x->>'key'<>'bids.multi_lot'))`,
        [JSON.stringify((await import('../src/settings/catalog.js')).catalogProjection())]);
      const retired = (await db.query<any>("select retired,implemented from dao_private.setting_definitions where key='bids.multi_lot'")).rows[0];
      assert.deepEqual(retired, { retired: true, implemented: false });
      assert.equal(Number((await db.query<any>('select version from dao_private.settings_state')).rows[0].version), Number(before) + 1);
      await assert.rejects(db.query("select dao_private.sync_setting_definitions(1,repeat('a',64),'[]'::jsonb)"), { code: '23514' });
    } finally { await db.exec('rollback'); }
  });

  await test('performance baseline: one RPC per screen (PGlite, indicative only)', async () => {
    const runs = 50; const start = performance.now();
    for (let i = 0; i < runs; i++) await read(U.dual, 'contractor');
    const ms = (performance.now() - start) / runs;
    const keys = Object.keys((await read(U.dual, 'contractor')).settings).length;
    console.log(`settings-s1 PGlite: 1 call -> ${keys} keys, ${ms.toFixed(2)} ms/call avg over ${runs}`);
    assert.ok(ms < 250, `unexpectedly slow resolver: ${ms} ms`);
  });
});
