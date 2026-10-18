import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

test('notifications S2: personal preferences and bounded bulk read (PGlite, not real JWT)', async () => {
  const db = new PGlite(); test.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;
    create schema storage;create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated;
    grant select,insert,update,delete on storage.objects to anon,authenticated;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
  const directory = resolve('supabase/migrations');
  for (const file of readdirSync(directory).filter(x => x.endsWith('.sql')).sort())
    await db.exec(readFileSync(resolve(directory,file),'utf8'));
  async function insert(table:string,input:Record<string,unknown>) {
    const keys=Object.keys(input);
    return (await db.query<any>(`insert into public.${table}(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')}) returning *`,Object.values(input))).rows[0];
  }
  async function as<T>(id:string|null,fn:()=>Promise<T>) {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id??'']);
    await db.exec(id?'set role authenticated':'set role anon');
    try{return await fn();}finally{await db.exec("reset role;select set_config('request.jwt.claim.sub','',false)");}
  }
  const client=randomUUID(),other=randomUUID(),staff=randomUUID();
  for(const [id,name,role] of [[client,'client','client'],[other,'other','client'],[staff,'staff','dao_reviewer']] as const){
    await db.query('insert into auth.users values($1,$2,now())',[id,name+'@example.invalid']);
    await insert('profiles',{user_id:id,display_name:name});await insert('user_roles',{user_id:id,role});
  }
  await test('defaults are workspace-scoped, writes stay RPC-only and actors remain isolated',async()=>{
    await as(null,()=>assert.rejects(db.query('select public.my_notification_preferences()'),{code:'42501'}));
    await as(staff,()=>assert.rejects(db.query('select public.my_notification_preferences()'),{code:'42501'}));
    assert.deepEqual((await as(client,async()=>(await db.query<any>('select public.my_notification_preferences() data')).rows[0].data)),
      {workspace:'client',invitation_expiring:true});
    assert.deepEqual((await as(client,async()=>(await db.query<any>('select public.update_my_notification_preferences(false) data')).rows[0].data)),
      {workspace:'client',invitation_expiring:false});
    assert.equal((await as(other,async()=>(await db.query<any>('select public.my_notification_preferences() data')).rows[0].data)).invitation_expiring,true);
    await as(client,async()=>{
      for(const sql of ['select * from public.notification_preferences',
        `insert into public.notification_preferences(user_id,workspace) values('${other}','client')`,
        'update public.notification_preferences set invitation_expiring=true'])
        await assert.rejects(db.query(sql),{code:'42501'});
      await assert.rejects(db.query('select public.update_my_notification_preferences(null)'),{code:'22023'});
    });
  });
  await test('double-role preferences remain independent and suspension is checked live',async()=>{
    await insert('user_roles',{user_id:client,role:'contractor'});
    await insert('contractor_profiles',{user_id:client,business_name:'Synthetic',verification_status:'verified'});
    await as(client,()=>db.query("select public.set_my_workspace('contractor')"));
    assert.equal((await as(client,async()=>(await db.query<any>('select public.my_notification_preferences() data')).rows[0].data)).invitation_expiring,true);
    await as(client,()=>db.query('select public.update_my_notification_preferences(true)'));
    await as(client,()=>db.query("select public.set_my_workspace('client')"));
    assert.equal((await as(client,async()=>(await db.query<any>('select public.my_notification_preferences() data')).rows[0].data)).invitation_expiring,false);
    await insert('account_states',{user_id:client,status:'suspended'});
    await as(client,()=>assert.rejects(db.query('select public.my_notification_preferences()'),{code:'42501'}));
    await db.query("update public.account_states set status='active' where user_id=$1",[client]);
  });
  await test('bulk marking is bounded, visible-only and idempotent',async()=>{
    const gov=await insert('governorates',{code:'S2_TEST',name_fr:'Synthetic',name_ar:'اختبار'});
    const project=await insert('projects',{client_id:client});
    const version=await insert('project_versions',{project_id:project.id,version_no:1,title:'PRIVATE',description:'PRIVATE',governorate_id:gov.id,status:'approved'});
    for(let i=0;i<3;i++)await insert('notifications',{user_id:client,kind:'review_approved',event_key:'s2:'+i,
      payload:{project_id:project.id,version_id:version.id,workspace:'client'}});
    await insert('notifications',{user_id:other,kind:'review_approved',event_key:'foreign',
      payload:{project_id:project.id,version_id:version.id,workspace:'client'}});
    const first=await as(client,async()=>(await db.query<any>('select public.mark_my_visible_notifications_read(2) data')).rows[0].data);
    assert.deepEqual(first,{marked:2,has_more:true});
    const second=await as(client,async()=>(await db.query<any>('select public.mark_my_visible_notifications_read(2) data')).rows[0].data);
    assert.deepEqual(second,{marked:1,has_more:false});
    assert.deepEqual(await as(client,async()=>(await db.query<any>('select public.mark_my_visible_notifications_read(2) data')).rows[0].data),
      {marked:0,has_more:false});
    assert.equal(Number((await db.query<any>('select count(*) n from public.notifications where user_id=$1 and read_at is null',[other])).rows[0].n),1);
    await as(client,async()=>{for(const n of [0,501])await assert.rejects(db.query('select public.mark_my_visible_notifications_read($1)',[n]),{code:'22023'});});
  });
});
