import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

test('settings S2: Admin overrides, resolution order, audit and server enforcement (PGlite, not real JWT)', async () => {
  const db = new PGlite(); test.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;
    create schema storage;create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated;
    grant select,insert,update,delete on storage.objects to anon,authenticated;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
  const migrations = resolve('supabase/migrations');
  for (const file of readdirSync(migrations).filter(x => x.endsWith('.sql') && !x.startsWith('20261028000000_provider_secret_vault_bridge') && !x.startsWith('20261028100000_provider_connection_secret_binding')).sort())
    await db.exec(readFileSync(resolve(migrations, file), 'utf8'));
  const insert = async (table: string, input: Record<string, unknown>) => {
    const keys = Object.keys(input);
    return (await db.query<any>(`insert into public.${table}(${keys.join(',')}) values(${keys.map((_, i) => '$' + (i + 1)).join(',')}) returning *`, Object.values(input))).rows[0];
  };
  const as = async <T>(id: string | null, fn: () => Promise<T>) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id ?? '']);
    await db.exec(id ? 'set role authenticated' : 'set role anon');
    try { return await fn(); } finally { await db.exec("reset role;select set_config('request.jwt.claim.sub','',false)"); }
  };
  const U = Object.fromEntries(['admin', 'reviewer', 'clientA', 'clientB', 'pro'].map(n => [n, randomUUID()])) as Record<string, string>;
  const roles: Record<string, string> = { admin: 'dao_admin', reviewer: 'dao_reviewer', clientA: 'client', clientB: 'client', pro: 'contractor' };
  for (const [name, id] of Object.entries(U)) {
    await db.query('insert into auth.users values($1,$2,now())', [id, `${name}@example.invalid`]);
    await insert('profiles', { user_id: id, display_name: name });
    await insert('user_roles', { user_id: id, role: roles[name] });
  }
  await insert('contractor_profiles', { user_id: U.pro, business_name: 'pro', verification_status: 'verified' });
  const projectA = (await insert('projects', { client_id: U.clientA })).id, projectB = (await insert('projects', { client_id: U.clientB })).id;
  const command = (actor: string, action: string, input: Record<string, unknown>) =>
    as(actor, async () => (await db.query<any>('select public.admin_setting_command($1,$2::jsonb) r', [action, JSON.stringify(input)])).rows[0].r);
  const rejects = (actor: string, action: string, input: Record<string, unknown>, code: string) =>
    as(actor, () => assert.rejects(db.query('select public.admin_setting_command($1,$2::jsonb)', [action, JSON.stringify(input)]), { code }));
  const self = async (id: string, ws: string, project: string | null = null) =>
    (await as(id, async () => (await db.query<any>('select public.my_effective_settings($1,$2) d', [ws, project])).rows[0].d)).settings;
  const preview = async (user: string, ws: string, project: string | null = null) =>
    (await as(U.admin, async () => (await db.query<any>('select public.admin_preview_settings($1,$2,$3) d', [user, ws, project])).rows[0].d)).settings;
  const active = async (key: string, scope: string, extra = '') =>
    (await db.query<any>(`select id from dao_private.setting_overrides where key=$1 and scope_type=$2 and superseded_at is null ${extra}`, [key, scope])).rows[0]?.id ?? null;
  const reason = 'Décision Admin de test';

  await test('only an active dao_admin writes; reviewer without mandate and Clients are refused', async () => {
    for (const id of [U.reviewer, U.clientA, U.pro]) {
      await rejects(id, 'set', { key: 'bids.rfi', scope: 'global', value: false, reason }, '42501');
      await as(id, () => assert.rejects(db.query('select public.admin_settings_overview()'), { code: '42501' }));
      await as(id, () => assert.rejects(db.query('select public.admin_settings_history()'), { code: '42501' }));
      await as(id, () => assert.rejects(db.query("select public.admin_preview_settings($1,'client')", [U.clientA]), { code: '42501' }));
      await as(id, () => assert.rejects(db.query('select * from dao_private.setting_overrides'), { code: '42501' }));
    }
  });

  await test('validation: catalogue keys, types, bounds (A6), scopes, reason, lock, A3 positive exceptions', async () => {
    const base = { scope: 'global', reason };
    await rejects(U.admin, 'set', { ...base, key: 'unknown.key', value: true }, '22023');
    await rejects(U.admin, 'set', { ...base, key: 'pref.contractor.counter_offers_optin', value: true }, '22023');
    await rejects(U.admin, 'set', { ...base, key: 'catalog.trades.active', value: true }, '22023');
    await rejects(U.admin, 'set', { ...base, key: 'uploads.max_file_mb', value: 21 }, '22023');
    await rejects(U.admin, 'set', { ...base, key: 'uploads.max_file_mb', value: 2.5 }, '22023');
    await rejects(U.admin, 'set', { ...base, key: 'invitations.ttl_days', value: '7' }, '22023');
    await rejects(U.admin, 'set', { ...base, key: 'publication.visibility_modes', value: [] }, '22023');
    await rejects(U.admin, 'set', { ...base, key: 'publication.visibility_modes', value: ['public', 'public'] }, '22023');
    await rejects(U.admin, 'set', { ...base, key: 'publication.visibility_modes', value: ['private'] }, '22023');
    await rejects(U.admin, 'set', { ...base, key: 'bids.rfi', value: false, reason: 'no' }, '22023');
    await rejects(U.admin, 'set', { key: 'bids.rfi', scope: 'account', user_id: U.pro, value: false, reason }, '22023');
    await rejects(U.admin, 'set', { key: 'invitations.ttl_days', scope: 'project', project_id: projectA, value: 3, reason }, '22023');
    await rejects(U.admin, 'set', { key: 'bids.quote_pdf', scope: 'account', user_id: U.clientA, value: false, reason }, '22023');
    await rejects(U.admin, 'set', { key: 'bids.quote_pdf', scope: 'account', user_id: U.pro, value: false, locked: true, reason }, '22023');
    await rejects(U.admin, 'set', { key: 'bids.rfi', scope: 'global', value: false, valid_until: '2099-01-01T00:00:00Z', reason }, '22023');
    await rejects(U.admin, 'set', { key: 'bids.quote_pdf', scope: 'account', user_id: U.pro, value: false, valid_until: '2000-01-01T00:00:00Z', reason }, '22023');
    await rejects(U.admin, 'set', { key: 'bids.quote_pdf', scope: 'account', user_id: U.pro, value: true, reason }, '23514');
    await rejects(U.admin, 'set', { key: 'invitations.ttl_days', scope: 'global', value: 1, reason }, '23514');
    assert.equal((await db.query<any>('select count(*)::int n from dao_private.setting_events')).rows[0].n, 0, 'refused writes leave no trace');
  });

  await test('global restriction: neutral for the Client, detailed for Admin preview; one live version', async () => {
    const before = (await as(U.clientA, async () => (await db.query<any>("select public.my_effective_settings('client') d")).rows[0].d)).version;
    const r = await command(U.admin, 'set', { key: 'bids.rfi', scope: 'global', value: false, reason, expected_override_id: null });
    assert.ok(r.override_id); assert.equal(Number(r.version), Number(before) + 1);
    assert.deepEqual((await self(U.clientA, 'client'))['bids.rfi'], { value: false, state: 'unavailable', source: 'platform', reason: 'restricted' });
    assert.deepEqual((await preview(U.clientA, 'client'))['bids.rfi'], { value: false, state: 'unavailable', source: 'global', reason: 'restricted' });
    await rejects(U.admin, 'set', { key: 'bids.rfi', scope: 'global', value: true, reason, expected_override_id: null }, '40001');
  });

  await test('precedence: role over global, account restriction wins, positive exception lifts only a default', async () => {
    const K = 'bids.counter_proposals';
    await command(U.admin, 'set', { key: K, scope: 'global', value: false, reason });
    await command(U.admin, 'set', { key: K, scope: 'role', workspace: 'contractor', value: true, reason });
    assert.equal((await preview(U.pro, 'contractor'))[K].source, 'role');
    assert.equal((await preview(U.clientA, 'client'))[K].state, 'unavailable');
    // Global OFF (not locked) + Admin positive exception on one Client's chantier, temporary (A3).
    await command(U.admin, 'set', { key: K, scope: 'project', project_id: projectA, value: true, valid_until: '2099-01-01T00:00:00Z', reason });
    assert.deepEqual((await preview(U.clientA, 'client', projectA))[K], { value: true, state: 'available', source: 'project' });
    assert.equal((await preview(U.clientB, 'client', projectB))[K].state, 'unavailable');
    // An account restriction is not lifted by the project exception.
    await command(U.admin, 'set', { key: K, scope: 'account', user_id: U.clientA, value: false, reason });
    assert.deepEqual((await preview(U.clientA, 'client', projectA))[K], { value: false, state: 'unavailable', source: 'account', reason: 'restricted' });
    // Lock: every exception ignored at once, new exceptions refused.
    await command(U.admin, 'set', { key: K, scope: 'global', value: true, locked: true, reason, expected_override_id: await active(K, 'global') });
    assert.deepEqual((await preview(U.clientA, 'client', projectA))[K], { value: true, state: 'available', source: 'global_locked' });
    await rejects(U.admin, 'set', { key: K, scope: 'account', user_id: U.clientB, value: false, reason }, '23514');
    // Expired exceptions are ignored without any scheduled job.
    await db.query("update dao_private.setting_overrides set valid_from=now()-interval '2 days', valid_until=now()-interval '1 day' where key=$1 and scope_type='project'", [K]);
    for (const scope of ['global', 'role', 'account'])
      await command(U.admin, 'clear', { key: K, scope, workspace: scope === 'role' ? 'contractor' : undefined,
        user_id: scope === 'account' ? U.clientA : undefined, reason, expected_override_id: await active(K, scope) });
    assert.deepEqual((await preview(U.clientA, 'client', projectA))[K], { value: true, state: 'available', source: 'default' });
    await rejects(U.admin, 'clear', { key: K, scope: 'global', reason }, '22023');
  });

  await test('enum_set exceptions only narrow; values are clamped and global', async () => {
    await command(U.admin, 'set', { key: 'publication.visibility_modes', scope: 'account', user_id: U.clientB, value: ['public', 'invite_only'], reason });
    assert.deepEqual((await preview(U.clientB, 'client'))['publication.visibility_modes'].value, ['public', 'invite_only']);
    await command(U.admin, 'set', { key: 'publication.visibility_modes', scope: 'global', value: ['public'], reason });
    assert.deepEqual((await preview(U.clientB, 'client'))['publication.visibility_modes'], { value: ['public'], state: 'available', source: 'global' });
    assert.deepEqual((await preview(U.clientA, 'client'))['publication.visibility_modes'].value, ['public']);
    await command(U.admin, 'clear', { key: 'publication.visibility_modes', scope: 'global', reason,
      expected_override_id: await active('publication.visibility_modes', 'global') });
  });

  await test('history is append-only and paginated; overview lists live overrides and trades', async () => {
    const history = await as(U.admin, async () => (await db.query<any>("select public.admin_settings_history('bids.counter_proposals',2) h")).rows[0].h);
    assert.equal(history.length, 2); assert.equal(history[0].actor, 'admin');
    const next = await as(U.admin, async () => (await db.query<any>("select public.admin_settings_history('bids.counter_proposals',100,$1,$2) h",
      [history[1].created_at, history[1].id])).rows[0].h);
    assert.ok(next.length >= 1 && !next.some((e: any) => e.id === history[0].id || e.id === history[1].id));
    await assert.rejects(db.query('update dao_private.setting_events set reason=$1', ['rewrite']), { code: '42501' });
    await assert.rejects(db.query('delete from dao_private.setting_events'), { code: '42501' });
    const overview = await as(U.admin, async () => (await db.query<any>('select public.admin_settings_overview() o')).rows[0].o);
    assert.equal(overview.definitions.length, 24);
    assert.equal(overview.definitions.find((d: any) => d.key === 'invitations.ttl_days').global_value, 7);
    assert.ok(overview.overrides.some((o: any) => o.key === 'publication.visibility_modes' && o.target_label === 'clientB'));
    assert.ok(overview.trades.length > 0);
  });

  await test('trades referential: audited activation toggle, idempotent', async () => {
    const trade = (await db.query<any>("select id,code from public.trades where active order by code limit 1")).rows[0];
    await as(U.reviewer, () => assert.rejects(db.query('select public.admin_set_trade_active($1,false,$2)', [trade.id, reason]), { code: '42501' }));
    const r = await as(U.admin, async () => (await db.query<any>('select public.admin_set_trade_active($1,false,$2) r', [trade.id, reason])).rows[0].r);
    assert.equal(r.changed, true);
    assert.equal((await as(U.admin, async () => (await db.query<any>('select public.admin_set_trade_active($1,false,$2) r', [trade.id, reason])).rows[0].r)).changed, false);
    const event = (await db.query<any>("select target_ref,old_value,new_value from dao_private.setting_events where action='trade_active'")).rows[0];
    assert.deepEqual(event, { target_ref: trade.code, old_value: true, new_value: false });
    await as(U.admin, () => db.query('select public.admin_set_trade_active($1,true,$2)', [trade.id, reason]));
  });

  await test('trades referential (#465): admin add/rename audited, duplicates refused, proposals reviewed', async () => {
    const save = (actor: string, id: string | null, name: string) =>
      as(actor, async () => (await db.query<any>('select public.admin_save_trade($1,$2,null,$3) r', [id, name, reason])).rows[0].r);
    assert.ok((await db.query<any>('select count(*)::int n from public.trades where active')).rows[0].n >= 25);
    await assert.rejects(save(U.reviewer, null, 'Staff métier'), { code: '42501' });
    await assert.rejects(save(U.admin, null, '  peinture '), { code: '23505' });
    const created = await save(U.admin, null, 'Géomètre topographe');
    assert.match(created.code, /^trade_/);
    const renamed = await save(U.admin, created.trade_id, 'Géomètre');
    assert.equal(renamed.changed, true);
    assert.equal((await db.query<any>('select code from public.trades where id=$1', [created.trade_id])).rows[0].code, created.code);
    const events = (await db.query<any>("select action from dao_private.setting_events where target_ref=$1 order by created_at", [created.code])).rows.map(r => r.action);
    assert.deepEqual(events, ['trade_create', 'trade_rename']);
    const propose = (actor: string, label: string) =>
      as(actor, async () => (await db.query<any>("select public.propose_trade($1,'project') r", [label])).rows[0].r);
    assert.equal((await propose(U.clientA, 'Carrelage et faience')).status, 'exists');
    const pending = await propose(U.clientA, 'Pisciniste');
    assert.equal(pending.status, 'pending');
    assert.equal((await propose(U.clientA, 'pisciniste')).proposal_id, pending.proposal_id);
    await assert.rejects(propose(U.pro, '<script>'), { code: '22023' });
    assert.equal((await db.query<any>("select count(*)::int n from public.trades where name_fr='Pisciniste'")).rows[0].n, 0);
    assert.equal((await as(U.clientB, () => db.query('select id from public.trade_proposals'))).rows.length, 0);
    await assert.rejects(as(U.clientA, () => db.query('select public.admin_trade_proposals()')), { code: '42501' });
    const queue = await as(U.admin, async () => (await db.query<any>('select public.admin_trade_proposals() r')).rows[0].r);
    assert.equal(queue.length, 1);
    const accepted = await as(U.admin, async () => (await db.query<any>("select public.admin_review_trade_proposal($1,'accept',null,'Piscine et spa',$2) r", [pending.proposal_id, reason])).rows[0].r);
    assert.equal(accepted.status, 'accepted');
    assert.equal((await db.query<any>('select name_fr,active from public.trades where id=$1', [accepted.trade_id])).rows[0].name_fr, 'Piscine et spa');
    await assert.rejects(as(U.admin, () => db.query("select public.admin_review_trade_proposal($1,'reject',null,null,$2)", [pending.proposal_id, reason])), { code: '22023' });
  });

  await test('moderation (#463): published réalisation edits stay published only when the Admin turns the prior review off', async () => {
    const cp = (await db.query<any>('select id from public.contractor_profiles where user_id=$1', [U.pro])).rows[0].id;
    await db.query("update public.contractor_profiles set public_identity_status='approved', verification_status='verified' where id=$1", [cp]);
    const published = (await insert('portfolio_projects', { contractor_id: cp, title: 'Villa', description: 'Avant', publication_consent: true, status: 'published' })).id;
    const save = (id: string | null, consent = true) => as(U.pro, () => db.query("select public.professional_command('portfolio_save',$1::jsonb)",
      [JSON.stringify({ ...(id ? { id } : {}), title: 'Villa', description: 'Après', publication_consent: consent })]));
    const status = async (id: string) => (await db.query<any>('select status from public.portfolio_projects where id=$1', [id])).rows[0].status;
    await save(published);
    assert.equal(await status(published), 'draft'); // default ON: current behaviour
    await db.query("update public.portfolio_projects set status='published' where id=$1", [published]);
    await command(U.admin, 'set', { key: 'moderation.portfolio_edit_review', scope: 'global', value: false, reason, expected_override_id: null });
    await save(published);
    assert.equal(await status(published), 'published');
    assert.equal((await db.query<any>('select description from public.portfolio_projects where id=$1', [published])).rows[0].description, 'Après');
    await save(published, false);
    assert.equal(await status(published), 'draft'); // consent withdrawn: never published
    await db.query("update public.portfolio_projects set status='published', publication_consent=true where id=$1", [published]);
    const fresh = (await as(U.pro, async () => (await db.query<any>("select public.professional_command('portfolio_save',$1::jsonb) r",
      [JSON.stringify({ title: 'Nouvelle', description: 'Jamais revue', publication_consent: true })])).rows[0].r)).id;
    assert.equal(await status(fresh), 'draft'); // a new réalisation is always reviewed
    await db.query("update public.contractor_profiles set public_identity_status='draft' where id=$1", [cp]);
    await save(published);
    assert.equal(await status(published), 'draft'); // identity no longer approved: gated
    await db.query("update public.contractor_profiles set public_identity_status='approved' where id=$1", [cp]);
    const live = (await db.query<any>("select id from dao_private.setting_overrides where key='moderation.portfolio_edit_review' and superseded_at is null")).rows[0].id;
    await command(U.admin, 'clear', { key: 'moderation.portfolio_edit_review', scope: 'global', reason, expected_override_id: live });
  });

  await test('server enforcement: restricted new actions refused, values applied prospectively', async () => {
    const invite = (by: string, project: string) => insert('project_invitations', { project_id: project, created_by: by,
      expected_role: 'client', token_hash: randomUUID().replace(/-/g, '').padEnd(64, 'a'), expires_at: new Date(Date.now() + 86400e3).toISOString() });
    // Default TTL replacement happens only for the coded now()+7 days value.
    await db.exec('begin');
    try {
      await command(U.admin, 'set', { key: 'invitations.ttl_days', scope: 'global', value: 3, reason });
      const ttl = (await db.query<any>(`insert into public.project_invitations(project_id,created_by,expected_role,token_hash,expires_at)
        values($1,$2,'client',$3,now()+interval '7 days') returning expires_at-now() as ttl`, [projectA, U.clientA, 'b'.repeat(64)])).rows[0].ttl;
      assert.match(String(ttl.days ?? ttl), /3/);
    } finally { await db.exec('rollback'); }
    await invite(U.clientA, projectA);
    await command(U.admin, 'set', { key: 'client.invite_professionals', scope: 'account', user_id: U.clientA, value: false, reason });
    await assert.rejects(invite(U.clientA, projectA), (e: any) => e.code === '42501' && /Option non disponible/.test(e.message));
    await invite(U.clientB, projectB);
    // Contract option: enabling is refused when restricted; turning OFF stays possible.
    await db.query('insert into public.project_contract_settings(project_id,enabled,updated_by) values($1,false,$2)', [projectB, U.clientB]);
    await command(U.admin, 'set', { key: 'contract.preparation_after_award', scope: 'account', user_id: U.clientB, value: false, reason });
    await assert.rejects(db.query('update public.project_contract_settings set enabled=true where project_id=$1', [projectB]), { code: '42501' });
    // Upload ceiling: lower configured limit applies to new files only.
    await command(U.admin, 'set', { key: 'uploads.max_file_mb', scope: 'global', value: 1, reason });
    await assert.rejects(insert('documents', { project_id: projectA, owner_id: U.clientA, object_path: `project/${projectA}/${randomUUID()}`,
      original_name: 'a.pdf', mime_type: 'application/pdf', size_bytes: 2 * 1048576 }), { code: '22023' });
    await insert('documents', { project_id: projectA, owner_id: U.clientA, object_path: `project/${projectA}/${randomUUID()}`,
      original_name: 'a.pdf', mime_type: 'application/pdf', size_bytes: 1048576 });
    const guarded = (await db.query<any>(`select c.relname from pg_trigger t join pg_class c on c.oid=t.tgrelid
      where t.tgname in ('settings_guard','settings_upload_size') order by 1`)).rows.map(r => r.relname);
    for (const table of ['bid_counter_proposals', 'bid_documents', 'bid_groups', 'bid_items', 'bid_quote_lines', 'bid_sub_lots', 'bid_versions',
      'contractor_files', 'documents', 'portfolio_assets', 'precontract_agreements', 'project_contract_settings', 'project_invitations',
      'publications', 'technical_questions', 'technical_rfi_documents']) assert.ok(guarded.includes(table), table);
    assert.ok(!guarded.includes('contract_archives'));
    const patched = (await db.query<any>(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='dao_private' and p.prosrc like '%setting_global_int(%' order by 1`)).rows.map(r => r.proname);
    for (const fn of ['dry_run_invitation_expiry_reminders', 'generate_invitation_expiry_reminders', 'invitation_expiry_reminder_allowed',
      'my_received_reviews', 'respond_to_contractor_review', 'send_conversation_message']) assert.ok(patched.includes(fn), fn);
  });
});
