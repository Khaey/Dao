import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// #58 lot 2 — durable OCE mapping and sync journal against the disposable Supabase stack.
const annotate=(name:string,fn:()=>Promise<void>)=>async()=>{try{await fn();}catch(error:any){console.log(`::error title=oce-sync-real ${name}::${String(error?.message??error).replace(/\r?\n/g,' ').slice(0,900)}`);throw error;}};
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
test('oce sync: closed tables, server-only RPCs, idempotent journal, replay, revocation',async t0=>{
  const t={test:(name:string,fn:()=>Promise<void>)=>t0.test(name,annotate(name,fn))};
  const url=process.env.DAO_SUPABASE_URL!,key=process.env.DAO_SUPABASE_PUBLISHABLE_KEY!,secret=process.env.DAO_SUPABASE_SECRET_KEY!;
  assert.equal(url,'http://127.0.0.1:54321','Only disposable Supabase is authorized');assert.ok(key);assert.ok(secret);
  const opts={auth:{persistSession:false,autoRefreshToken:false}};
  const admin=createClient(url,secret,opts);const anon=createClient(url,key,opts);
  const password='Oce!'+randomUUID();let user:any,project:any,request:any,otherProject:any,mapping='';
  const rpc=async(fn:string,args:any)=>{const r=await admin.rpc(fn,args);assert.ifError(r.error);return r.data;};
  const fails=async(fn:string,args:any,code?:string)=>{const r=await admin.rpc(fn,args);assert.ok(r.error,`${fn} must fail`);if(code)assert.equal(r.error.code,code,`${fn}: ${r.error.message}`);};
  await annotate('setup',async()=>{
    const email=`oce58-${randomUUID()}@example.invalid`;const created=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ifError(created.error);
    const id=created.data.user!.id;assert.ifError((await admin.from('profiles').insert({user_id:id,display_name:'Client OCE'})).error);assert.ifError((await admin.from('user_roles').insert({user_id:id,role:'client'})).error);
    const db=createClient(url,key,opts);assert.ifError((await db.auth.signInWithPassword({email,password})).error);user={id,db};
    const mk=async()=>{const r=await admin.from('projects').insert({client_id:id,initiator_id:id,project_origin:'client_existing_team'}).select('*').single();assert.ifError(r.error);return r.data;};
    project=await mk();otherProject=await mk();
    const q=await admin.from('project_requests').insert({project_id:project.id}).select('*').single();assert.ifError(q.error);request=q.data;
  })();
  const key1=()=>'ensure-project:'+randomUUID();

  await t.test('tables are closed and RPCs are not callable by anon or authenticated',async()=>{
    for(const table of ['oce_sync_mappings','oce_sync_wbs','oce_sync_activities','oce_sync_dependencies','oce_sync_journal']){
      for(const [name,db] of [['anon',anon],['authenticated',user.db]] as const){
        const r=await db.from(table).select('*');assert.ok(r.error||(r.data??[]).length===0,`${name} read ${table}`);
        const w=await db.from(table).insert({}).select();assert.ok(w.error,`${name} write ${table}`);
      }
    }
    const args:Record<string,any>={oce_request_mapping:{p_project_id:project.id,p_request_id:request.id},oce_set_admission:{p_mapping_id:randomUUID(),p_admitted:true},
      oce_begin_sync:{p_mapping_id:randomUUID(),p_operation:'ensure-project',p_key:'abcdefgh',p_payload_hash:sha('x')},oce_finish_sync:{p_journal_id:randomUUID(),p_ok:true},
      oce_object_changed:{p_mapping_id:randomUUID(),p_kind:'wbs',p_code:'A',p_code2:null,p_hash:sha('x')},oce_record_object:{p_mapping_id:randomUUID(),p_kind:'wbs',p_code:'A',p_code2:null,p_hash:sha('x')}};
    for(const [fn,a] of Object.entries(args)){
      for(const db of [anon,user.db]){const r=await db.rpc(fn,a);assert.ok(r.error,`${fn} must be denied`);assert.equal(r.error.code,'42501',`${fn}: ${r.error.message}`);}
    }
  });

  await t.test('mapping is idempotent and bound to the real (project, lot) pair',async()=>{
    mapping=await rpc('oce_request_mapping',{p_project_id:project.id,p_request_id:request.id});assert.ok(mapping);
    assert.equal(await rpc('oce_request_mapping',{p_project_id:project.id,p_request_id:request.id}),mapping);
    await fails('oce_request_mapping',{p_project_id:otherProject.id,p_request_id:request.id},'22023');
    await fails('oce_request_mapping',{p_project_id:project.id,p_request_id:randomUUID()},'22023');
    assert.ifError((await admin.from('oce_sync_mappings').insert({project_id:otherProject.id,request_id:request.id})).error===null?new Error('FK must reject wrong pair'):undefined);
    const w=await admin.from('project_requests').insert({project_id:project.id,status:'withdrawn'}).select('id').single();assert.ifError(w.error);
    await fails('oce_request_mapping',{p_project_id:project.id,p_request_id:w.data!.id},'22023');
  });

  await t.test('journal: run, replay, hash conflict, retry after failure, in progress',async()=>{
    const k=key1(),h=sha('body-1');
    const a=await rpc('oce_begin_sync',{p_mapping_id:mapping,p_operation:'ensure-project',p_key:k,p_payload_hash:h});assert.equal(a.state,'run');
    const again=await rpc('oce_begin_sync',{p_mapping_id:mapping,p_operation:'ensure-project',p_key:k,p_payload_hash:h});assert.equal(again.state,'in_progress');assert.equal(again.id,a.id);
    await fails('oce_begin_sync',{p_mapping_id:mapping,p_operation:'ensure-project',p_key:k,p_payload_hash:sha('other')},'22023');
    await rpc('oce_finish_sync',{p_journal_id:a.id,p_ok:false,p_error_kind:'unavailable',p_error_code:'gateway_down'});
    let m=(await admin.from('oce_sync_mappings').select('*').eq('id',mapping).single()).data!;assert.equal(m.last_error_kind,'unavailable');assert.equal(m.project_ensured_at,null);
    const retry=await rpc('oce_begin_sync',{p_mapping_id:mapping,p_operation:'ensure-project',p_key:k,p_payload_hash:h});assert.equal(retry.state,'run');assert.equal(retry.id,a.id);
    assert.equal((await admin.from('oce_sync_journal').select('attempts').eq('id',a.id).single()).data!.attempts,2);
    await rpc('oce_finish_sync',{p_journal_id:a.id,p_ok:true});
    m=(await admin.from('oce_sync_mappings').select('*').eq('id',mapping).single()).data!;
    assert.ok(m.project_ensured_at);assert.equal(m.last_error_kind,null);assert.equal(m.status,'admitted');
    assert.equal((await rpc('oce_begin_sync',{p_mapping_id:mapping,p_operation:'ensure-project',p_key:k,p_payload_hash:h})).state,'replay');
    await fails('oce_finish_sync',{p_journal_id:a.id,p_ok:true},'22023');
  });

  await t.test('object hashes drive writes; stable codes only',async()=>{
    const h1=sha('act-1'),h2=sha('act-2');
    assert.equal(await rpc('oce_object_changed',{p_mapping_id:mapping,p_kind:'activity',p_code:'ACT-1',p_code2:null,p_hash:h1}),true);
    await rpc('oce_record_object',{p_mapping_id:mapping,p_kind:'activity',p_code:'ACT-1',p_code2:null,p_hash:h1});
    assert.equal(await rpc('oce_object_changed',{p_mapping_id:mapping,p_kind:'activity',p_code:'ACT-1',p_code2:null,p_hash:h1}),false);
    assert.equal(await rpc('oce_object_changed',{p_mapping_id:mapping,p_kind:'activity',p_code:'ACT-1',p_code2:null,p_hash:h2}),true);
    await rpc('oce_record_object',{p_mapping_id:mapping,p_kind:'wbs',p_code:'WBS-1',p_code2:null,p_hash:h1});
    await rpc('oce_record_object',{p_mapping_id:mapping,p_kind:'dependency',p_code:'ACT-1',p_code2:'ACT-2',p_hash:h1});
    await fails('oce_record_object',{p_mapping_id:mapping,p_kind:'dependency',p_code:'ACT-1',p_code2:'ACT-1',p_hash:h1});
    await fails('oce_record_object',{p_mapping_id:mapping,p_kind:'activity',p_code:'bad code!',p_code2:null,p_hash:h1});
    await fails('oce_record_object',{p_mapping_id:mapping,p_kind:'nope',p_code:'A',p_code2:null,p_hash:h1},'22023');
    await fails('oce_record_object',{p_mapping_id:mapping,p_kind:'wbs',p_code:'W',p_code2:null,p_hash:'not-a-hash'});
  });

  await t.test('journal is append-only and revocation blocks new work',async()=>{
    const row=(await admin.from('oce_sync_journal').select('id').eq('mapping_id',mapping).limit(1).single()).data!;
    assert.ok((await admin.from('oce_sync_journal').delete().eq('id',row.id)).error,'delete must fail');
    assert.ok((await admin.from('oce_sync_journal').update({payload_hash:sha('tamper')}).eq('id',row.id)).error,'identity immutable');
    assert.ok((await admin.from('oce_sync_journal').update({status:'pending',finished_at:null}).eq('id',row.id)).error,'succeeded cannot reopen');
    await rpc('oce_set_admission',{p_mapping_id:mapping,p_admitted:false});
    await fails('oce_begin_sync',{p_mapping_id:mapping,p_operation:'ensure-wbs',p_key:key1(),p_payload_hash:sha('z')},'42501');
    await rpc('oce_set_admission',{p_mapping_id:mapping,p_admitted:true});
    assert.equal((await rpc('oce_begin_sync',{p_mapping_id:mapping,p_operation:'ensure-wbs',p_key:key1(),p_payload_hash:sha('z')})).state,'run');
  });
});
