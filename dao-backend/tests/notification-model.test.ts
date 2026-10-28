import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

test('notifications S1: SQL replay, live isolation and transactional events (PGlite, not real JWT)', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;
    create schema storage;create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated;
    grant select,insert,update,delete on storage.objects to anon,authenticated;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
  const directory = resolve('supabase/migrations');
  for (const file of readdirSync(directory).filter(x => x.endsWith('.sql') && !x.startsWith('20261028000000_provider_secret_vault_bridge')).sort()) await db.exec(readFileSync(resolve(directory,file),'utf8'));
  await db.exec(readFileSync(resolve('tests/notifications-s1-contract.sql'),'utf8'));
  async function insert(table: string, input: Record<string, unknown>) {
    const keys = Object.keys(input);
    return (await db.query<any>(`insert into public.${table}(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')}) returning *`,Object.values(input))).rows[0];
  }
  async function as<T>(id: string|null, fn: () => Promise<T>) {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id ?? '']);
    await db.exec(id ? 'set role authenticated' : 'set role anon');
    try { return await fn(); } finally { await db.exec("reset role;select set_config('request.jwt.claim.sub','',false)"); }
  }
  const users: Record<string,string> = {};
  for (const [name,role] of Object.entries({client:'client',other:'client',pro:'contractor',staff:'dao_reviewer'})) {
    const id=randomUUID(); users[name]=id;
    await db.query('insert into auth.users values($1,$2,now())',[id,name+'@example.invalid']);
    await insert('profiles',{user_id:id,display_name:name});await insert('user_roles',{user_id:id,role});
  }
  await insert('contractor_profiles',{user_id:users.pro,business_name:'Synthetic',verification_status:'verified'});
  // Professional-only suspension must not suppress this actor's Client events.
  await insert('user_roles',{user_id:users.client,role:'contractor'});
  await insert('contractor_profiles',{user_id:users.client,business_name:'Dual role',verification_status:'suspended'});
  const gov=await insert('governorates',{code:'NOTICE_TEST',name_fr:'Synthetic',name_ar:'اختبار'});
  const project=await insert('projects',{client_id:users.client});
  const version=await insert('project_versions',{project_id:project.id,version_no:1,title:'PRIVATE TITLE',description:'PRIVATE',governorate_id:gov.id,status:'client_review'});
  const list=(actor:string, args='') => as(users[actor],async()=>(await db.query<any>('select public.my_notifications('+args+') data')).rows[0].data);
  const count=(actor:string)=>as(users[actor],async()=>(await db.query<any>('select public.my_unread_notification_count() n')).rows[0].n);
  await t.test('empty and anonymous/forged commands, private emitters and outbox', async () => {
    assert.deepEqual((await list('client')).rows,[]);
    await as(null,()=>assert.rejects(db.query('select public.my_notifications()'),{code:'42501'}));
    await as(users.client,async()=>{
      for(const sql of ["select * from public.notification_outbox", "select dao_private.emit_internal_notification(null,null,null,null)",
        `insert into public.notifications(user_id,kind) values('${users.client}','review_approved')`,
        'update public.notifications set read_at=now()', 'delete from public.notifications']) await assert.rejects(db.query(sql),{code:'42501'});
      for(const sql of ['select public.my_notifications(51)',`select public.my_notifications(20,now(),null,false)`]) await assert.rejects(db.query(sql),{code:'22023'});
    });
  });
  await t.test('rejected business transition emits once and failed retry emits nothing', async () => {
    await as(users.staff,()=>db.query('select public.review_project($1,false,$2)',[project.id,'PRIVATE REASON']));
    const result=await list('client'); assert.equal(result.rows.length,1);assert.equal(result.unread_count,1);
    assert.equal(result.rows[0].kind,'review_rejected'); assert.equal(result.rows[0].target_id,project.id);
    assert.ok(!JSON.stringify(result).includes('PRIVATE'));
    await as(users.staff,()=>assert.rejects(db.query('select public.review_project($1,false,$2)',[project.id,'retry']),{code:'23514'}));
    assert.equal((await list('client')).rows.length,1);
    assert.equal((await list('other')).rows.length,0);assert.equal((await list('staff')).rows.length,0);
  });
  await t.test('uniform foreign marking, repeat read timestamp and direct revoked read isolation', async () => {
    const item=(await list('client')).rows[0];
    await as(users.other,()=>db.query('select public.mark_my_notification_read($1)',[item.id]));
    assert.equal(Number(await count('client')),1);
    await as(users.client,()=>db.query('select public.mark_my_notification_read($1)',[item.id]));
    const read=(await list('client')).rows[0].read_at;assert.ok(read);
    await as(users.client,()=>db.query('select public.mark_my_notification_read($1)',[item.id]));
    assert.equal((await list('client')).rows[0].read_at,read);assert.equal(Number(await count('client')),0);
  });
  await t.test('legacy/malformed payloads and unsupported kinds stay hidden without a cast error',async()=>{
    for(const input of [{kind:'future_private_kind',payload:{project_id:project.id,body:'PRIVATE'}},
      {kind:'review_rejected',payload:{project_id:'not-a-uuid',version_id:version.id,workspace:'client'}},
      {kind:'review_rejected',payload:{project_id:project.id,version_id:'not-a-uuid',workspace:'client'}}])
      await insert('notifications',{user_id:users.client,...input});
    assert.equal((await list('client')).rows.length,1);
    assert.equal(await as(users.client,async()=>(await db.query('select id from public.notifications')).rows.length),1);
  });
  const pending=await insert('projects',{client_id:null,initiator_id:users.pro,project_origin:'contractor_existing_client'});
  let invitation:any;
  await t.test('invitation creation/acceptance is transactional, idempotent and role scoped', async () => {
    invitation=await as(users.pro,async()=>(await db.query<any>('select public.issue_project_invitation($1,$2,$3,$4,$5,$6) data',
      [pending.id,'client','client@example.invalid',null,null,false])).rows[0].data);
    assert.equal((await list('client')).rows.filter((r:any)=>r.kind==='invitation_received').length,1);
    await as(users.client,()=>db.query('select public.respond_my_project_invitation($1,true)',[invitation.id]));
    assert.equal((await list('client')).rows.filter((r:any)=>r.kind==='invitation_received').length,0);
    assert.equal((await list('pro')).rows.filter((r:any)=>r.kind==='invitation_accepted').length,1);
    await as(users.client,()=>assert.rejects(db.query('select public.respond_my_project_invitation($1,true)',[invitation.id]),{code:'23514'}));
    assert.equal((await list('pro')).rows.length,1);
    await db.query("update public.project_members set status='revoked',revoked_at=now() where project_id=$1 and user_id=$2",[pending.id,users.pro]);
    assert.equal((await list('pro')).rows.length,0);
  });
  await t.test('100+ rows paginate by timestamp AND id, all/unread share count and authorization', async () => {
    for(let i=0;i<105;i++) await insert('notifications',{user_id:users.client,kind:'review_rejected',event_key:'fixture:'+i,
      created_at:'2026-10-18T00:00:00.123456Z',payload:{project_id:project.id,version_id:version.id,workspace:'client'}});
    const seen=new Set<string>();let before:any=null;
    do {
      const p=await as(users.client,async()=>(await db.query<any>('select public.my_notifications($1,$2,$3,$4) data',[20,before?.created_at??null,before?.id??null,false])).rows[0].data);
      for(const row of p.rows){assert.ok(!seen.has(row.id));seen.add(row.id);}
      before=p.has_more?p.rows.at(-1):null;assert.equal(p.unread_count,105);
    } while(before);
    assert.equal(seen.size,106);
    assert.equal((await list('client','20,null,null,true')).rows.every((r:any)=>r.read_at===null),true);
  });
  await t.test('suspension, removed roles, archived project and rollback remove all observable data', async () => {
    await insert('account_states',{user_id:users.client,status:'suspended'});
    await as(users.client,async()=>{await assert.rejects(db.query('select public.my_notifications()'),{code:'42501'});assert.equal((await db.query('select * from public.notifications')).rows.length,0);});
    await db.query("update public.account_states set status='active' where user_id=$1",[users.client]);
    await db.query("update public.contractor_profiles set verification_status='verified' where user_id=$1",[users.client]);
    await as(users.client,()=>db.query("select public.set_my_workspace('contractor')"));assert.equal((await list('client')).rows.length,0);
    await as(users.client,()=>db.query("select public.set_my_workspace('client')"));assert.equal((await list('client')).rows.length,20);
    const before=Number((await db.query<any>('select count(*) n from public.notifications')).rows[0].n);
    await db.exec('begin');await db.query("update public.project_versions set status='approved' where id=$1",[version.id]);await db.exec('rollback');
    assert.equal(Number((await db.query<any>('select count(*) n from public.notifications')).rows[0].n),before);
    await db.query("update public.projects set status='archived' where id=$1",[project.id]);assert.equal((await list('client')).rows.length,0);
  });
});
