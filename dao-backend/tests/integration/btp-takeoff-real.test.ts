import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const url=process.env.DAO_SUPABASE_URL!;
const key=process.env.DAO_SUPABASE_PUBLISHABLE_KEY!;
const serviceKey=process.env.DAO_SUPABASE_SECRET_KEY!;

test('real Supabase enforces deterministic takeoff RLS, idempotence and validated-history preservation',async()=>{
  assert.ok(url&&key&&serviceKey);
  const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const password='Takeoff!'+randomUUID();
  const users:Record<string,{id:string;db:any}>={};
  for(const name of ['owner','other','manager']) {
    const email=`takeoff-${name}-${randomUUID()}@example.invalid`;
    const created=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ifError(created.error);
    const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
    assert.ifError((await db.auth.signInWithPassword({email,password})).error);
    users[name]={id:created.data.user!.id,db};
    assert.ifError((await admin.from('profiles').insert({user_id:users[name].id,display_name:`Takeoff ${name}`})).error);
    assert.ifError((await admin.from('user_roles').insert({user_id:users[name].id,role:name==='manager'?'dao_reviewer':'client'})).error);
  }
  const project=(await admin.from('projects').insert({client_id:users.owner.id}).select('id').single());assert.ifError(project.error);
  const foreign=(await admin.from('projects').insert({client_id:users.other.id}).select('id').single());assert.ifError(foreign.error);
  assert.ifError((await admin.from('review_assignments').insert({project_id:project.data.id,reviewer_id:users.manager.id,assigned_at:new Date().toISOString()})).error);
  const published=(await admin.from('btp_catalog_versions').select('id').eq('country_code','TN').eq('status','published').order('effective_from',{ascending:false}).limit(1).single());assert.ifError(published.error);
  const work=await admin.from('btp_works').select('id').eq('catalog_version_id',published.data.id).eq('code','btp_work_terrace').single();assert.ifError(work.error);
  const source={kind:'manual',reference:'Mesure intégration confirmée'};
  const command=(who:string,action:string,input:any,idempotency:string)=>users[who].db.rpc('btp_takeoff_command_v1',{p_action:action,p_input:input,p_idempotency_key:idempotency});

  const incomplete=await command('owner','calculate',{projectId:project.data.id,workId:work.data.id,scopeKey:'terrace-real',label:'Terrasse réelle',canonicalInputs:{
    length_m:{value:'10',unit:'m',source,original:{value:'10',unit:'m'}}}},'takeoff-real-missing');
  assert.ifError(incomplete.error);assert.equal(incomplete.data.current.status,'insufficient_data');assert.equal(incomplete.data.current.justification.result,undefined);
  const takeoffId=incomplete.data.id;

  const foreignRead=await users.other.db.rpc('btp_takeoff_snapshot_v1',{p_project_id:project.data.id,p_takeoff_id:takeoffId});
  assert.equal(foreignRead.error?.code,'42501');
  const directWrite=await users.owner.db.from('btp_takeoffs').update({label:'forged'}).eq('id',takeoffId);
  assert.ok(directWrite.error);

  const input={projectId:project.data.id,workId:work.data.id,takeoffId,expectedRevision:1,scopeKey:'terrace-real',label:'Terrasse réelle',forgedResult:999999,canonicalInputs:{
    length_m:{value:'10',unit:'m',source,original:{value:'1000',unit:'cm'}},
    width_m:{value:'6',unit:'m',source:{kind:'survey',reference:'Relevé réel'},original:{value:'6000',unit:'mm'}}}};
  const calculated=await command('owner','calculate',input,'takeoff-real-calc');assert.ifError(calculated.error);
  assert.equal(Number(calculated.data.current.justification.result.value),60);
  const replay=await command('owner','calculate',input,'takeoff-real-calc');assert.ifError(replay.error);
  assert.equal(replay.data.current.resultSha256,calculated.data.current.resultSha256);
  const conflict=await command('owner','calculate',{...input,label:'different'},'takeoff-real-calc');assert.equal(conflict.error?.code,'22023');
  const forged=await command('owner','calculate',{...input,expectedRevision:2,label:'forged',canonicalInputs:{...input.canonicalInputs,
    length_m:{value:'999',unit:'m',source,original:{value:'1000',unit:'cm'}}}},'takeoff-real-forged');
  assert.equal(forged.error?.code,'22023');
  const duplicate=await command('owner','calculate',{projectId:project.data.id,workId:work.data.id,scopeKey:'terrace-real',label:'duplicate',canonicalInputs:{}},'takeoff-real-duplicate');
  assert.equal(duplicate.error?.code,'23505');

  const submitted=await command('owner','submit',{takeoffId,expectedRevision:2,note:'Soumis'},'takeoff-real-submit');assert.ifError(submitted.error);
  const ownerValidation=await command('owner','validate',{takeoffId,expectedRevision:2,note:'Forbidden'},'takeoff-real-owner-valid');assert.equal(ownerValidation.error?.code,'42501');
  const validated=await command('manager','validate',{takeoffId,expectedRevision:2,note:'Validé'},'takeoff-real-manager-valid');assert.ifError(validated.error);
  assert.equal(validated.data.validatedRevision,2);

  const recalculated=await command('owner','calculate',{...input,expectedRevision:2,label:'Terrasse révisée',canonicalInputs:{...input.canonicalInputs,
    length_m:{value:'11',unit:'m',source,original:{value:'11',unit:'m'}}}},'takeoff-real-recalc');assert.ifError(recalculated.error);
  assert.equal(recalculated.data.currentRevision,3);assert.equal(recalculated.data.validatedRevision,2);
  assert.equal(Number(recalculated.data.validated.justification.result.value),60);assert.equal(Number(recalculated.data.current.justification.result.value),66);
  const stored=await admin.from('btp_takeoff_revisions').select('revision').eq('takeoff_id',takeoffId).order('revision');assert.ifError(stored.error);assert.deepEqual(stored.data.map(x=>x.revision),[1,2,3]);

  const foreignProject=await command('owner','calculate',{projectId:foreign.data.id,workId:work.data.id,scopeKey:'x',label:'Interdit',canonicalInputs:{}},'takeoff-real-foreign');
  assert.equal(foreignProject.error?.code,'42501');
});
