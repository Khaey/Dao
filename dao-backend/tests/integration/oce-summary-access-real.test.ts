import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// #58 — who may read a lot's OCE technical summary: real JWTs against the disposable Supabase stack.
const annotate=(name:string,fn:()=>Promise<void>)=>async()=>{try{await fn();}catch(error:any){console.log(`::error title=oce-summary-access-real ${name}::${String(error?.message??error).replace(/\r?\n/g,' ').slice(0,900)}`);throw error;}};
test('oce summary access: owner and project management only, admitted lots only',async t0=>{
  const t={test:(name:string,fn:()=>Promise<void>)=>t0.test(name,annotate(name,fn))};
  const url=process.env.DAO_SUPABASE_URL!,key=process.env.DAO_SUPABASE_PUBLISHABLE_KEY!,secret=process.env.DAO_SUPABASE_SECRET_KEY!;
  assert.equal(url,'http://127.0.0.1:54321','Only disposable Supabase is authorized');assert.ok(key);assert.ok(secret);
  const opts={auth:{persistSession:false,autoRefreshToken:false}};
  const admin=createClient(url,secret,opts);const anon=createClient(url,key,opts);
  const password='Oce!'+randomUUID();const users:any={};
  const mapped=async(fn:string,args:any)=>{const r=await admin.rpc(fn,args);assert.ifError(r.error);return r.data;};
  const access=async(who:string,p:string,l:string)=>{const r=await users[who].db.rpc('oce_summary_access',{p_project_id:p,p_request_id:l});assert.ifError(r.error);return r.data;};
  let project:any,request:any,other:any,otherRequest:any,mapping='';
  await annotate('setup',async()=>{
    const roles:Record<string,string>={owner:'client',stranger:'client',pro:'contractor',reviewer:'dao_reviewer',assigned:'dao_reviewer',boss:'dao_admin'};
    for(const [name,role] of Object.entries(roles)){
      const email=`oce58s-${name}-${randomUUID()}@example.invalid`;const created=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ifError(created.error);
      const id=created.data.user!.id;assert.ifError((await admin.from('profiles').insert({user_id:id,display_name:'Synth '+name})).error);assert.ifError((await admin.from('user_roles').insert({user_id:id,role})).error);
      const db=createClient(url,key,opts);assert.ifError((await db.auth.signInWithPassword({email,password})).error);users[name]={id,db};
    }
    const mk=async()=>{const r=await admin.from('projects').insert({client_id:users.owner.id,initiator_id:users.owner.id,project_origin:'client_existing_team'}).select('*').single();assert.ifError(r.error);return r.data;};
    project=await mk();other=await mk();
    const q=async(p:any)=>{const r=await admin.from('project_requests').insert({project_id:p.id}).select('*').single();assert.ifError(r.error);return r.data;};
    request=await q(project);otherRequest=await q(other);
    assert.ifError((await admin.from('project_members').insert({project_id:project.id,user_id:users.pro.id,participation_role:'contractor'})).error);
    assert.ifError((await admin.from('review_assignments').insert({project_id:project.id,reviewer_id:users.assigned.id,assigned_at:new Date().toISOString()})).error);
    mapping=await mapped('oce_request_mapping',{p_project_id:project.id,p_request_id:request.id});
  })();

  await t.test('anon is denied at the privilege level',async()=>{
    const r=await anon.rpc('oce_summary_access',{p_project_id:project.id,p_request_id:request.id});
    assert.ok(r.error);assert.equal(r.error.code,'42501');
  });

  await t.test('a mapping that is not admitted is closed to everyone',async()=>{
    for(const who of ['owner','assigned','boss'])assert.equal(await access(who,project.id,request.id),false,who);
  });

  await t.test('once admitted: owner, assigned reviewer and admin only',async()=>{
    await mapped('oce_set_admission',{p_mapping_id:mapping,p_admitted:true});
    for(const who of ['owner','assigned','boss'])assert.equal(await access(who,project.id,request.id),true,who);
    for(const who of ['stranger','pro','reviewer'])assert.equal(await access(who,project.id,request.id),false,who);
  });

  await t.test('wrong pairs, unknown ids and other projects never leak',async()=>{
    assert.equal(await access('owner',project.id,otherRequest.id),false);
    assert.equal(await access('owner',other.id,request.id),false);
    assert.equal(await access('owner',project.id,randomUUID()),false);
    assert.equal(await access('boss',randomUUID(),randomUUID()),false);
    // The other project's lot has no mapping at all: still false for its owner and the admin.
    for(const who of ['owner','boss'])assert.equal(await access(who,other.id,otherRequest.id),false);
  });

  await t.test('revocation, withdrawal, archiving and suspension close access immediately',async()=>{
    await mapped('oce_set_admission',{p_mapping_id:mapping,p_admitted:false});
    assert.equal(await access('owner',project.id,request.id),false);
    await mapped('oce_set_admission',{p_mapping_id:mapping,p_admitted:true});
    assert.equal(await access('owner',project.id,request.id),true);
    assert.ifError((await admin.from('project_requests').update({status:'withdrawn'}).eq('id',request.id)).error);
    assert.equal(await access('owner',project.id,request.id),false);
    assert.ifError((await admin.from('project_requests').update({status:'open'}).eq('id',request.id)).error);
    assert.ifError((await admin.from('projects').update({status:'archived'}).eq('id',project.id)).error);
    assert.equal(await access('owner',project.id,request.id),false);
    assert.ifError((await admin.from('projects').update({status:'draft'}).eq('id',project.id)).error);
    assert.equal(await access('owner',project.id,request.id),true);
    assert.ifError((await admin.from('user_roles').delete().eq('user_id',users.assigned.id).eq('role','dao_reviewer')).error);
    assert.equal(await access('assigned',project.id,request.id),false,'live role check');
  });
});
