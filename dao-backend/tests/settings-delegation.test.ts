import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

test('settings S4: Gestionnaire mandates, portfolio and limits (PGlite, not real JWT)', async () => {
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
  for (const file of readdirSync(migrations).filter(x => x.endsWith('.sql')).sort())
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
  const U = Object.fromEntries(['admin', 'reviewer', 'reviewer2', 'clientA', 'clientB', 'pro'].map(n => [n, randomUUID()])) as Record<string, string>;
  const roles: Record<string, string> = { admin: 'dao_admin', reviewer: 'dao_reviewer', reviewer2: 'dao_reviewer', clientA: 'client', clientB: 'client', pro: 'contractor' };
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
  const reason = 'Délégation de test';
  const q = async (actor: string, sql: string, args: unknown[] = []) => as(actor, async () => (await db.query<any>(sql, args)).rows[0]?.r);
  const deleg = (actor: string, action: string, input: Record<string, unknown>) => q(actor, 'select public.admin_delegation_command($1,$2::jsonb) r', [action, JSON.stringify(input)]);
  const delegRejects = (actor: string, action: string, input: Record<string, unknown>, code: string) =>
    as(actor, () => assert.rejects(db.query('select public.admin_delegation_command($1,$2::jsonb)', [action, JSON.stringify(input)]), { code }));
  const manager = (actor: string, action: string, input: Record<string, unknown>) => q(actor, 'select public.manager_setting_command($1,$2::jsonb) r', [action, JSON.stringify(input)]);
  const managerRejects = (actor: string, action: string, input: Record<string, unknown>, code: string) =>
    as(actor, () => assert.rejects(db.query('select public.manager_setting_command($1,$2::jsonb)', [action, JSON.stringify(input)]), { code }));
  const days = (n: number) => new Date(Date.now() + n * 86400000).toISOString();
  await insert('review_assignments', { project_id: projectA, reviewer_id: U.reviewer, assigned_at: new Date().toISOString() });

  await test('A8: no mandate means no settings right; only Admin grants', async () => {
    assert.deepEqual(await q(U.reviewer, 'select public.my_settings_delegation() r'), { mandates: [] });
    await managerRejects(U.reviewer, 'set', { key: 'bids.rfi', scope: 'project', project_id: projectA, value: false, valid_until: days(10), reason }, '42501');
    for (const id of [U.reviewer, U.clientA, U.pro]) {
      await delegRejects(id, 'grant_mandate', { staff_user_id: U.reviewer, keys: ['bids.rfi'], actions: ['restrict'], scopes: ['project'], valid_until: days(30), reason }, '42501');
      await as(id, () => assert.rejects(db.query('select public.admin_settings_delegations()'), { code: '42501' }));
    }
    await as(U.clientA, () => assert.rejects(db.query('select public.my_settings_delegation()'), { code: '42501' }));
    await as(U.reviewer, () => assert.rejects(db.query('select * from dao_private.setting_mandates'), { code: '42501' }));
  });

  await test('grant validation: delegable keys only (A1), dated mandate, reviewer grantee', async () => {
    const base = { staff_user_id: U.reviewer, actions: ['restrict'], scopes: ['account'], valid_until: days(30), reason };
    await delegRejects(U.admin, 'grant_mandate', { ...base, keys: ['bids.multi_lot'] }, '22023');
    await delegRejects(U.admin, 'grant_mandate', { ...base, keys: ['invitations.ttl_days'] }, '22023');
    await delegRejects(U.admin, 'grant_mandate', { ...base, keys: ['bids.rfi'], valid_until: null }, '22023');
    await delegRejects(U.admin, 'grant_mandate', { ...base, keys: ['bids.rfi'], valid_until: days(400) }, '22023');
    await delegRejects(U.admin, 'grant_mandate', { ...base, keys: ['bids.rfi'], actions: ['grant'] }, '22023');
    await delegRejects(U.admin, 'grant_mandate', { ...base, keys: ['bids.rfi'], staff_user_id: U.clientA }, '22023');
    await delegRejects(U.admin, 'grant_mandate', { ...base, keys: ['bids.rfi'], staff_user_id: U.admin }, '22023');
    await delegRejects(U.admin, 'assign_account', { staff_user_id: U.reviewer, account_user_id: U.reviewer2, reason }, '22023');
  });

  let mandate = '';
  await test('Gestionnaire restricts within portfolio/assigned chantier, never itself, never positive, at most 90 days', async () => {
    mandate = (await deleg(U.admin, 'grant_mandate', { staff_user_id: U.reviewer, keys: ['client.offer_comparison', 'bids.quote_pdf', 'publication.visibility_modes', 'bids.rfi'],
      actions: ['restrict', 'lift_own_restriction'], scopes: ['account', 'project'], valid_until: days(60), reason })).id;
    await deleg(U.admin, 'assign_account', { staff_user_id: U.reviewer, account_user_id: U.clientA, reason });
    await delegRejects(U.admin, 'assign_account', { staff_user_id: U.reviewer, account_user_id: U.clientA, reason }, '22023');
    const me = await q(U.reviewer, 'select public.my_settings_delegation() r');
    assert.equal(me.mandates.length, 1); assert.deepEqual(me.accounts.map((a: any) => a.id), [U.clientA]); assert.deepEqual(me.projects.map((p: any) => p.id), [projectA]);
    const r = { key: 'client.offer_comparison', scope: 'account', user_id: U.clientA, value: false, valid_until: days(30), reason };
    await managerRejects(U.reviewer, 'set', { ...r, user_id: U.clientB }, '42501');
    await managerRejects(U.reviewer, 'set', { ...r, user_id: U.reviewer }, '42501');
    await managerRejects(U.reviewer, 'set', { ...r, value: true }, '42501');
    await managerRejects(U.reviewer, 'set', { ...r, valid_until: null }, '22023');
    await managerRejects(U.reviewer, 'set', { ...r, valid_until: days(91) }, '22023');
    await managerRejects(U.reviewer, 'set', { ...r, key: 'bids.counter_proposals' }, '42501');
    await managerRejects(U.reviewer2, 'set', r, '42501');
    await manager(U.reviewer, 'set', r);
    assert.equal((await self(U.clientA, 'client'))['client.offer_comparison'].state, 'unavailable');
    assert.equal((await self(U.clientA, 'client'))['client.offer_comparison'].source, 'platform');
    const ev = (await db.query<any>("select mandate_id, actor_id from dao_private.setting_events where key='client.offer_comparison' order by created_at desc limit 1")).rows[0];
    assert.equal(ev.mandate_id, mandate); assert.equal(ev.actor_id, U.reviewer);
    // enum_set: narrowing only
    const v = { key: 'publication.visibility_modes', scope: 'account', user_id: U.clientA, valid_until: days(10), reason };
    await managerRejects(U.reviewer, 'set', { ...v, value: ['public', 'targeted', 'invite_only'] }, '42501');
    await manager(U.reviewer, 'set', { ...v, value: ['invite_only'] });
    // chantier: assigned A yes, B no
    const p = { key: 'bids.rfi', scope: 'project', valid_until: days(10), reason, value: false };
    await manager(U.reviewer, 'set', { ...p, project_id: projectA });
    await managerRejects(U.reviewer, 'set', { ...p, project_id: projectB }, '42501');
    const preview = await q(U.reviewer, "select public.manager_preview_settings($1,'client',$2) r", [U.clientA, projectA]);
    assert.equal(preview.settings['bids.rfi'].source, 'project');
    await as(U.reviewer, () => assert.rejects(db.query("select public.manager_preview_settings($1,'client')", [U.clientB]), { code: '42501' }));
  });

  await test('Admin decisions are untouchable by a manager; lift own only', async () => {
    const id = await active('bids.quote_pdf', 'account', `and target_user='${U.pro}'`);
    assert.equal(id, null);
    await deleg(U.admin, 'assign_account', { staff_user_id: U.reviewer, account_user_id: U.pro, reason });
    await q(U.admin, 'select public.admin_setting_command($1,$2::jsonb) r', ['set', JSON.stringify({ key: 'bids.quote_pdf', scope: 'account', user_id: U.pro, value: false, reason, expected_override_id: null })]);
    const adminRow = await active('bids.quote_pdf', 'account');
    await managerRejects(U.reviewer, 'clear', { key: 'bids.quote_pdf', scope: 'account', user_id: U.pro, reason, expected_override_id: adminRow }, '42501');
    await managerRejects(U.reviewer, 'set', { key: 'bids.quote_pdf', scope: 'account', user_id: U.pro, value: false, valid_until: days(5), reason, expected_override_id: adminRow }, '42501');
    const own = await active('client.offer_comparison', 'account');
    await manager(U.reviewer, 'clear', { key: 'client.offer_comparison', scope: 'account', user_id: U.clientA, reason, expected_override_id: own });
    assert.equal((await self(U.clientA, 'client'))['client.offer_comparison'].state, 'available');
  });

  await test('revocation is immediate for new writes; grants are history (no delete/edit)', async () => {
    await deleg(U.admin, 'revoke_mandate', { id: mandate, reason });
    await managerRejects(U.reviewer, 'set', { key: 'client.offer_comparison', scope: 'account', user_id: U.clientA, value: false, valid_until: days(5), reason }, '42501');
    assert.deepEqual(await q(U.reviewer, 'select public.my_settings_delegation() r'), { mandates: [] });
    await delegRejects(U.admin, 'revoke_mandate', { id: mandate, reason }, '22023');
    await assert.rejects(db.query('delete from dao_private.setting_mandates'), { code: '42501' });
    await assert.rejects(db.query("update dao_private.setting_mandates set keys=array['bids.rfi']"), { code: '42501' });
    const overview = await q(U.admin, 'select public.admin_settings_delegations() r');
    assert.equal(overview.mandates[0].live, false); assert.equal(overview.portfolio.length, 2);
    assert.deepEqual(overview.managers.map((m: any) => m.id).sort(), [U.reviewer, U.reviewer2].sort());
    const pf = overview.portfolio.find((a: any) => a.account_user_id === U.pro).id;
    await deleg(U.admin, 'unassign_account', { id: pf, reason });
  });
});
