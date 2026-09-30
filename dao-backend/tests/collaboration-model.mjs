import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

// This suite deliberately inserts legacy records BEFORE the collaboration
// migration. The existing local suite still exercises every old invariant.
const db = new PGlite();
let passed = 0;
async function check(name, fn) {
  try { await fn(); passed++; }
  catch (error) { console.error(name, error.code ?? '', error.message); throw error; }
}
async function rejected(sql, params, code) {
  await assert.rejects(db.query(sql, params), error => error.code === code);
}
async function as(user, fn) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec('set role authenticated');
  try { return await fn(); }
  finally { await db.exec("reset role; select set_config('request.jwt.claim.sub','',false)"); }
}
async function visible(table, id) {
  return (await db.query(`select id from public.${table} where id=$1`, [id])).rows.length;
}
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
  $$;
  grant usage on schema public,auth to anon,authenticated,service_role;
  grant execute on function auth.uid() to anon,authenticated,service_role;
  create schema storage;
  create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon,authenticated;
  grant select,insert,update,delete on storage.objects to anon,authenticated;
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
`);
const migrations = readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter(f => f.endsWith('.sql')).sort();
const modelMigration = '20260930163650_project_collaboration.sql';
for (const file of migrations.filter(f => f < modelMigration)) {
  await db.exec(readFileSync(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8'));
}
const client = randomUUID(), other = randomUUID(), contractor = randomUUID();
for (const [user, role] of [[client,'client'],[other,'client'],[contractor,'contractor']]) {
  await db.query('insert into auth.users(id) values($1)', [user]);
  await db.query('insert into public.user_roles(user_id,role) values($1,$2)', [user,role]);
}
await db.query("insert into public.contractor_profiles(user_id,business_name,verification_status) values($1,'Model fixture','pending')", [contractor]);
const legacy = (await db.query('insert into public.projects(client_id) values($1) returning *', [client])).rows[0];
const doc = (await db.query(`insert into public.documents(project_id,owner_id,object_path,original_name,mime_type,size_bytes,status)
  values($1,$2,$3,'legacy.pdf','application/pdf',4,'approved') returning id`, [legacy.id,client,`project/${legacy.id}/legacy.pdf`])).rows[0].id;
await check('migration applies to existing projects and documents without data loss', async () => {
  await db.exec(readFileSync(new URL('../supabase/migrations/' + modelMigration, import.meta.url), 'utf8'));
  const row = (await db.query('select * from public.projects where id=$1', [legacy.id])).rows[0];
  assert.equal(row.client_id,client); assert.equal(row.initiator_id,client);
  assert.equal(row.confirmed_by,client); assert.equal(row.confirmed_at.getTime(),legacy.created_at.getTime());
  assert.equal(row.status,legacy.status); assert.equal(row.project_origin,'client_marketplace');
  assert.equal(row.project_stage,'not_started'); assert.equal(row.payment_status,'not_set');
  const member = (await db.query('select * from public.project_members where project_id=$1', [legacy.id])).rows[0];
  assert.equal(member.user_id,client); assert.equal(member.participation_role,'client');
  assert.equal(member.can_view_private_details,true);
  assert.equal((await db.query('select share_scope from public.documents where id=$1', [doc])).rows[0].share_scope,'owner_only');
});
// Future command migrations are included when this suite runs after checkpoint 2.
for (const file of migrations.filter(f => f > modelMigration)) {
  await db.exec(readFileSync(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8'));
}
await db.exec('create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key)');
for (const file of migrations) await db.query('insert into supabase_migrations.schema_migrations values($1)', [file.split('_')[0]]);
await db.exec(readFileSync(new URL('../supabase/seed.sql', import.meta.url), 'utf8'));
await check('shared schema contract after fresh reconstruction', () => db.exec(readFileSync(new URL('./schema-contract.sql', import.meta.url),'utf8')));
await check('unconfirmed projects are restricted to contractor origin', () => rejected(
  'insert into public.projects(initiator_id) values($1)', [contractor], '23514'));
await check('contractor cannot be their own fake client', () => rejected(
  "insert into public.projects(initiator_id,client_id,project_origin) values($1,$1,'contractor_existing_client')", [contractor], '23514'));
const direct = (await db.query("insert into public.projects(initiator_id,project_origin) values($1,'contractor_existing_client') returning *", [contractor])).rows[0];
await check('contractor initiator is a contractor participant before client confirmation', async () => {
  assert.equal(direct.client_id,null); assert.equal(direct.confirmed_by,null); assert.equal(direct.confirmed_at,null);
  const member = (await db.query('select * from public.project_members where project_id=$1', [direct.id])).rows[0];
  assert.equal(member.participation_role,'contractor'); assert.equal(member.can_view_private_details,true);
  await as(contractor, async () => {
    assert.equal(await visible('projects',direct.id),1);
    const rights = (await db.query('select dao_private.owner($1) as owner,dao_private.can_prepare_project($1) as prepare',[direct.id])).rows[0];
    assert.equal(rights.owner,false); assert.equal(rights.prepare,true);
  });
});
await check('third-party client sees no direct project', () => as(other,async () => assert.equal(await visible('projects',direct.id),0)));
const member = (await db.query("insert into public.project_members(project_id,user_id,participation_role) values($1,$2,'contractor') returning id", [legacy.id,contractor])).rows[0].id;
const privateId = (await db.query("insert into public.project_private_details(project_id,exact_address) values($1,'Private fixture') returning id", [legacy.id])).rows[0].id;
await check('ordinary contractor member has workspace reads but no owner or private permission', () => as(contractor,async () => {
  assert.equal(await visible('projects',legacy.id),1); assert.equal(await visible('project_private_details',privateId),0);
  assert.equal((await db.query('select dao_private.owner($1) as owner,dao_private.can_prepare_project($1) as prepare',[legacy.id])).rows[0].prepare,false);
  assert.equal(await visible('documents',doc),0);
}));
await db.query("update public.documents set share_scope='project_members' where id=$1",[doc]);
await check('approved shared document is visible to an accepted member', () => as(contractor,async () => assert.equal(await visible('documents',doc),1)));
await db.query("update public.documents set status='quarantined' where id=$1",[doc]);
await check('membership does not bypass document validation', () => as(contractor,async () => assert.equal(await visible('documents',doc),0)));
await db.query("update public.documents set status='approved' where id=$1",[doc]);
await db.query('update public.project_members set can_view_private_details=true where id=$1',[member]);
await check('private access requires an explicit permission', () => as(contractor,async () => assert.equal(await visible('project_private_details',privateId),1)));
await db.query("update public.project_members set status='revoked',revoked_at=now() where id=$1",[member]);
await check('revocation removes workspace, shared document and private access', () => as(contractor,async () => {
  assert.equal(await visible('projects',legacy.id),0); assert.equal(await visible('documents',doc),0);
  assert.equal(await visible('project_private_details',privateId),0);
}));
await check('browser cannot insert or modify membership', () => as(contractor,async () => {
  await rejected('update public.project_members set can_view_private_details=true where id=$1',[member],'42501');
  await rejected("insert into public.project_members(project_id,user_id,participation_role) values($1,$2,'client')",[direct.id,contractor],'42501');
}));
await check('document scope, work stage and payment state accept only defined values', async () => {
  await rejected("update public.documents set share_scope='public' where id=$1",[doc],'23514');
  await rejected("update public.projects set project_stage='paid' where id=$1",[direct.id],'23514');
  await rejected("update public.projects set payment_status='in_progress' where id=$1",[direct.id],'23514');
  await db.query("update public.projects set project_stage='in_progress',payment_status='paid' where id=$1",[direct.id]);
  assert.equal((await db.query('select status from public.projects where id=$1',[direct.id])).rows[0].status,'draft');
});
await check('historical ownership and project origin cannot be rewritten', async () => {
  await rejected('update public.projects set client_id=$1,confirmed_by=$1 where id=$2',[other,legacy.id],'23514');
  await rejected("update public.projects set project_origin='client_existing_team' where id=$1",[legacy.id],'23514');
});
await check('no plaintext token column or browser access to token hashes', async () => {
  assert.equal((await db.query("select count(*)::int as n from information_schema.columns where table_schema='public' and table_name='project_invitations' and column_name in ('token','plain_token')")).rows[0].n,0);
  await as(client,() => rejected('select token_hash from public.project_invitations',[],'42501'));
});
console.log(JSON.stringify({suite:'collaboration model and legacy backfill',passed,failed:0}));
await db.close();
