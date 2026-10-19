import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// #301 — lot plan input, access rules and sync state: real JWTs against the disposable Supabase stack.
const annotate=(name:string,fn:()=>Promise<void>)=>async()=>{try{await fn();}catch(error:any){console.log(`::error title=oce-lot-plan-real ${name}::${String(error?.message??error).replace(/\r?\n/g,' ').slice(0,900)}`);throw error;}};
test('oce lot plan: explicit dates, owner/management access, service-only sync read, derived sync state',async t0=>{
  const t={test:(name:string,fn:()=>Promise<void>)=>t0.test(name,annotate(name,fn))};
  const url=process.env.DAO_SUPABASE_URL!,key=process.env.DAO_SUPABASE_PUBLISHABLE_KEY!,secret=process.env.DAO_SUPABASE_SECRET_KEY!;
  assert.equal(url,'http://127.0.0.1:54321','Only disposable Supabase is authorized');assert.ok(key);assert.ok(secret);
  const opts={auth:{persistSession:false,autoRefreshToken:false}};
  const admin=createClient(url,secret,opts);const anon=createClient(url,key,opts);
  const password='Oce!'+randomUUID();const users:any={};
  let project:any,request:any,withdrawn:any;
  const save=(who:string,s:any,e:any,ready:boolean,r=request)=>users[who].db.rpc('oce_save_lot_plan',{p_project_id:project.id,p_request_id:r.id,p_start:s,p_end:e,p_ready:ready});
  const get=async(who:string)=>{const r=await users[who].db.rpc('oce_get_lot_plan',{p_project_id:project.id,p_request_id:request.id});assert.ifError(r.error);return r.data;};
  await annotate('setup',async()=>{
    const roles:Record<string,string>={owner:'client',stranger:'client',pro:'contractor',reviewer:'dao_reviewer',assigned:'dao_reviewer',boss:'dao_admin'};
    for(const [name,role] of Object.entries(roles)){
      const email=`oce301-${name}-${randomUUID()}@example.invalid`;const created=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ifError(created.error);
      const id=created.data.user!.id;assert.ifError((await admin.from('profiles').insert({user_id:id,display_name:'Synth '+name})).error);assert.ifError((await admin.from('user_roles').insert({user_id:id,role})).error);
      const db=createClient(url,key,opts);assert.ifError((await db.auth.signInWithPassword({email,password})).error);users[name]={id,db};
    }
    const gov=(await admin.from('governorates').select('id').eq('code','E2E_TEST').single()).data!.id;
    const trade=(await admin.from('trades').select('id').eq('code','plumbing').single()).data!.id;
    const p=await admin.from('projects').insert({client_id:users.owner.id,initiator_id:users.owner.id,project_origin:'client_existing_team'}).select('*').single();assert.ifError(p.error);project=p.data;
    assert.ifError((await admin.from('project_versions').insert({project_id:project.id,version_no:1,title:'Synth '+randomUUID(),description:'safe',governorate_id:gov,status:'approved'})).error);
    const lot=async()=>{const r=await admin.from('project_requests').insert({project_id:project.id}).select('*').single();assert.ifError(r.error);
      assert.ifError((await admin.from('project_request_versions').insert({project_id:project.id,request_id:r.data.id,version_no:1,title:'Gros œuvre',scope:'safe',trade_id:trade})).error);return r.data;};
    request=await lot();withdrawn=await lot();
    assert.ifError((await admin.from('project_members').insert({project_id:project.id,user_id:users.pro.id,participation_role:'contractor'})).error);
    assert.ifError((await admin.from('review_assignments').insert({project_id:project.id,reviewer_id:users.assigned.id,assigned_at:new Date().toISOString()})).error);
  })();

  await t.test('anon and direct table access are denied',async()=>{
    const r=await anon.rpc('oce_get_lot_plan',{p_project_id:project.id,p_request_id:request.id});assert.ok(r.error);assert.equal(r.error.code,'42501');
    const d=await users.owner.db.from('oce_lot_plans').select('*');assert.ok(d.error||(d.data??[]).length===0);
    const s=await users.owner.db.rpc('oce_lot_plan_for_sync',{p_project_id:project.id,p_request_id:request.id});assert.ok(s.error);assert.equal(s.error.code,'42501');
  });

  await t.test('only the owner and D.A.O management of the project may read or write the plan',async()=>{
    for(const who of ['stranger','pro','reviewer']){const r=await save(who,'2026-11-02','2026-12-18',false);assert.equal(r.error?.code,'42501',who);}
    for(const who of ['owner','assigned','boss']){const r=await save(who,'2026-11-02','2026-12-18',false);assert.ifError(r.error);assert.equal(r.data.status,'draft');}
    const g=await users.stranger.db.rpc('oce_get_lot_plan',{p_project_id:project.id,p_request_id:request.id});assert.equal(g.error?.code,'42501');
  });

  await t.test('no invented dates: ready needs both explicit, consistent dates',async()=>{
    for(const [s,e,ready] of [[null,null,true],['2026-11-02',null,false],[null,'2026-12-18',false],['2026-12-18','2026-11-02',false]] as any){
      const r=await save('owner',s,e,ready);assert.equal(r.error?.code,'22023',JSON.stringify([s,e,ready]));
    }
    const c=await admin.from('oce_lot_plans').update({planned_start:null,planned_end:null,status:'ready'}).eq('project_id',project.id).eq('request_id',request.id);
    assert.ok(c.error,'DB constraint must refuse ready without dates');
  });

  await t.test('sync read is null until ready, then exposes only lot title, region and dates (service only)',async()=>{
    const read=async()=>{const r=await admin.rpc('oce_lot_plan_for_sync',{p_project_id:project.id,p_request_id:request.id});assert.ifError(r.error);return r.data;};
    assert.equal(await read(),null);
    const r=await save('owner','2026-11-02','2026-12-18',true);assert.ifError(r.error);assert.equal(r.data.status,'ready');
    const data=await read();assert.deepEqual(Object.keys(data).sort(),['lot_title','planned_end','planned_start','region']);
    assert.equal(data.lot_title,'Gros œuvre');assert.equal(data.planned_start,'2026-11-02');assert.equal(data.planned_end,'2026-12-18');
  });

  await t.test('revision only moves when the plan content changes',async()=>{
    const a=await save('owner','2026-11-02','2026-12-18',true);const b=await save('owner','2026-11-02','2026-12-18',true);assert.equal(a.data.revision,b.data.revision);
    const c=await save('owner','2026-11-03','2026-12-18',true);assert.equal(c.data.revision,a.data.revision+1);
  });

  await t.test('sync state is derived from the durable mapping: pending, failed, synced',async()=>{
    assert.equal((await get('owner')).sync.state,'pending');
    const m=await admin.rpc('oce_request_mapping',{p_project_id:project.id,p_request_id:request.id});assert.ifError(m.error);
    const begin=async(op:string)=>{const b=await admin.rpc('oce_begin_sync',{p_mapping_id:m.data,p_operation:op,p_key:op+':'+randomUUID(),p_payload_hash:'a'.repeat(64)});assert.ifError(b.error);return b.data.id;};
    assert.ifError((await admin.rpc('oce_finish_sync',{p_journal_id:await begin('ensure-project'),p_ok:false,p_error_kind:'transient',p_error_code:'unavailable'})).error);
    const failed=await get('owner');assert.equal(failed.sync.state,'failed');assert.equal(failed.sync.error_code,'unavailable');
    assert.ifError((await admin.rpc('oce_finish_sync',{p_journal_id:await begin('ensure-wbs'),p_ok:true})).error);
    const ok=await get('assigned');assert.equal(ok.sync.state,'synced');assert.equal(ok.sync.error_code,null);
    const same=await save('owner','2026-11-03','2026-12-18',true);assert.ifError(same.error);
    assert.equal((await get('owner')).sync.state,'synced','replaying an identical plan keeps the synchronised state');
    await save('owner','2026-11-04','2026-12-18',true);
    assert.equal((await get('owner')).sync.state,'pending','a changed plan is pending again');
  });

  await t.test('relaunch is reserved to D.A.O management, never the Client',async()=>{
    const can=async(who:string)=>{const r=await users[who].db.rpc('oce_resync_access',{p_project_id:project.id,p_request_id:request.id});assert.ifError(r.error);return r.data;};
    assert.equal(await can('owner'),false);assert.equal(await can('assigned'),true);assert.equal(await can('boss'),true);
    assert.equal(await can('stranger'),false);assert.equal(await can('reviewer'),false);
  });

  await t.test('withdrawn lots and archived projects are closed',async()=>{
    assert.ifError((await admin.from('project_requests').update({status:'withdrawn'}).eq('id',withdrawn.id)).error);
    const r=await save('owner','2026-11-02','2026-12-18',true,withdrawn);assert.equal(r.error?.code,'42501');
    const other=await save('owner','2026-11-02','2026-12-18',true,{id:randomUUID()});assert.equal(other.error?.code,'42501');
  });
});
