import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

test('notifications S2: private invitation expiry reminder engine (PGlite, not real JWT)', async () => {
  const db=new PGlite(); test.after(()=>db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;
    create schema storage;create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated;
    grant select,insert,update,delete on storage.objects to anon,authenticated;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
  const directory=resolve('supabase/migrations');
  for(const file of readdirSync(directory).filter(x=>x.endsWith('.sql')).sort())
    await db.exec(readFileSync(resolve(directory,file),'utf8'));
  async function insert(table:string,input:Record<string,unknown>){
    const keys=Object.keys(input);return (await db.query<any>(`insert into public.${table}(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')}) returning *`,Object.values(input))).rows[0];
  }
  async function as<T>(id:string|null,fn:()=>Promise<T>){
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id??'']);await db.exec(id?'set role authenticated':'set role anon');
    try{return await fn();}finally{await db.exec("reset role;select set_config('request.jwt.claim.sub','',false)");}
  }
  const sender=randomUUID(),recipient=randomUUID(),suspended=randomUUID();
  for(const [id,name] of [[sender,'sender'],[recipient,'recipient'],[suspended,'suspended']] as const){
    await db.query('insert into auth.users values($1,$2,now())',[id,name+'@example.invalid']);
    await insert('profiles',{user_id:id,display_name:name});await insert('user_roles',{user_id:id,role:'client'});
  }
  await insert('account_states',{user_id:suspended,status:'suspended'});
  const now=new Date();const nowIso=now.toISOString();
  const expiry=(hours:number)=>new Date(now.getTime()+hours*3600000).toISOString();
  let sequence=0;
  async function invitation(email:string,hours:number){
    sequence++;const project=await insert('projects',{client_id:sender});
    return insert('project_invitations',{project_id:project.id,created_by:sender,expected_role:'client',recipient_email:email,
      token_hash:createHash('sha256').update('s2-'+sequence).digest('hex'),expires_at:expiry(hours)});
  }

  await test('engine is not browser callable and dry-run returns aggregates only',async()=>{
    for(const actor of [null,recipient]) await as(actor,()=>assert.rejects(
      db.query('select dao_private.dry_run_invitation_expiry_reminders(100,now())'),{code:'42501'}));
    for(const args of [[0,nowIso],[501,nowIso],[100,null]] as const)
      await assert.rejects(db.query('select dao_private.dry_run_invitation_expiry_reminders($1,$2)',[...args]),{code:'22023'});
  });

  const eligible=[];for(let i=0;i<103;i++)eligible.push(await invitation('recipient@example.invalid',12));
  await invitation('recipient@example.invalid',25);
  await invitation('suspended@example.invalid',12);
  await test('selection is bounded and generation is retry-safe beyond 100 rows',async()=>{
    const dry=(await db.query<any>('select dao_private.dry_run_invitation_expiry_reminders(100,$1) data',[nowIso])).rows[0].data;
    assert.deepEqual(dry,{eligible:100,limit:100});
    const first=(await db.query<any>('select dao_private.generate_invitation_expiry_reminders(100,$1) data',[nowIso])).rows[0].data;
    assert.deepEqual(first,{generated:100,has_more:true});
    const second=(await db.query<any>('select dao_private.generate_invitation_expiry_reminders(100,$1) data',[nowIso])).rows[0].data;
    assert.deepEqual(second,{generated:3,has_more:false});
    assert.deepEqual((await db.query<any>('select dao_private.generate_invitation_expiry_reminders(100,$1) data',[nowIso])).rows[0].data,
      {generated:0,has_more:false});
    assert.equal(Number((await db.query<any>("select count(*) n from public.notifications where kind='invitation_expiring'")).rows[0].n),103);
  });

  await test('payload is allowlisted and live state/preferences revoke visibility',async()=>{
    const row=(await db.query<any>("select * from public.notifications where event_key=$1",['invitation_expiring:'+eligible[0].id+':24h'])).rows[0];
    assert.deepEqual(Object.keys(row.payload).sort(),['expires_at','invitation_id','project_id','severity','workspace']);
    assert.equal(JSON.stringify(row.payload).includes('@'),false);
    assert.equal(await as(recipient,async()=>Number((await db.query<any>("select count(*) n from public.notifications where kind='invitation_expiring'")).rows[0].n)),103);
    await db.query("update public.project_invitations set status='revoked',revoked_at=now(),revoked_by=$1 where id=$2",[sender,eligible[0].id]);
    assert.equal(await as(recipient,async()=>Number((await db.query<any>("select count(*) n from public.notifications where kind='invitation_expiring'")).rows[0].n)),102);
    await as(recipient,()=>db.query('select public.update_my_notification_preferences(false)'));
    assert.equal(await as(recipient,async()=>Number((await db.query<any>("select count(*) n from public.notifications where kind='invitation_expiring'")).rows[0].n)),0);
  });

  await test('preference-off at insertion and concurrent retries produce no duplicate',async()=>{
    const one=await invitation('recipient@example.invalid',10);
    assert.deepEqual((await db.query<any>('select dao_private.generate_invitation_expiry_reminders(10,$1) data',[nowIso])).rows[0].data,
      {generated:0,has_more:false});
    await as(recipient,()=>db.query('select public.update_my_notification_preferences(true)'));
    const results=await Promise.all([
      db.query<any>('select dao_private.generate_invitation_expiry_reminders(10,$1) data',[nowIso]),
      db.query<any>('select dao_private.generate_invitation_expiry_reminders(10,$1) data',[nowIso])]);
    assert.equal(results.reduce((sum,r)=>sum+r.rows[0].data.generated,0),1);
    assert.equal(Number((await db.query<any>('select count(*) n from public.notifications where event_key=$1',['invitation_expiring:'+one.id+':24h'])).rows[0].n),1);
  });
});
