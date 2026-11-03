import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { BtpEstimateService } from '../../src/services/BtpEstimateService.js';
import { createBtpEstimateHandler, createBtpPriceHandler } from '../../src/server/btpEstimateHandler.js';

// #551 — base de prix et estimation avec de vrais JWT Supabase sur la pile jetable.
// Tous les tarifs créés ici sont FICTIFS (source test_fixture) et la pile est détruite après la CI.
const annotate=(name:string,fn:()=>Promise<void>)=>async()=>{try{await fn();}catch(error:any){console.log(`::error title=btp-estimate-real ${name}::${String(error?.message??error).replace(/\r?\n/g,' ').slice(0,900)}`);throw error;}};
test('btp estimate: real JWT, RLS, separation of duties and honest totals',async t0=>{
  const t={test:(name:string,fn:()=>Promise<void>)=>t0.test(name,annotate(name,fn))};
  const url=process.env.DAO_SUPABASE_URL!,key=process.env.DAO_SUPABASE_PUBLISHABLE_KEY!,secret=process.env.DAO_SUPABASE_SECRET_KEY!;
  assert.equal(url,'http://127.0.0.1:54321','Only disposable Supabase is authorized');assert.ok(key);assert.ok(secret);
  const opts={auth:{persistSession:false,autoRefreshToken:false}};
  const admin=createClient(url,secret,opts);const anon=createClient(url,key,opts);
  const password='Est!'+randomUUID();const users:any={};
  let project:any,work:any,fixtureSource:any;
  const api=(who:string)=>{const svc=new BtpEstimateService(users[who].db);const resolve=async()=>({id:users[who].id});
    return {estimates:createBtpEstimateHandler(svc,resolve),prices:createBtpPriceHandler(svc,resolve)};};
  const post=async(who:string,kind:'estimates'|'prices',body:any)=>{const r=await api(who)[kind](new Request(`https://dao.test/api/btp/${kind}`,{method:'POST',headers:{authorization:'Bearer real','content-type':'application/json'},body:JSON.stringify(body)}));return {status:r.status,body:await r.json()};};
  const get=async(who:string,kind:'estimates'|'prices',query:string)=>{const r=await api(who)[kind](new Request(`https://dao.test/api/btp/${kind}?${query}`,{headers:{authorization:'Bearer real'}}));return {status:r.status,body:await r.json()};};

  await annotate('setup',async()=>{
    const roles:Record<string,string>={owner:'client',stranger:'client',pro:'contractor',assigned:'dao_reviewer',boss:'dao_admin'};
    for(const [name,role] of Object.entries(roles)){
      const email=`est551-${name}-${randomUUID()}@example.invalid`;const created=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ifError(created.error);
      const id=created.data.user!.id;assert.ifError((await admin.from('profiles').insert({user_id:id,display_name:'Synth '+name})).error);assert.ifError((await admin.from('user_roles').insert({user_id:id,role})).error);
      const db=createClient(url,key,opts);assert.ifError((await db.auth.signInWithPassword({email,password})).error);users[name]={id,db};
    }
    const p=await admin.from('projects').insert({client_id:users.owner.id,initiator_id:users.owner.id,project_origin:'client_existing_team'}).select('*').single();assert.ifError(p.error);project=p.data;
    assert.ifError((await admin.from('project_members').insert({project_id:project.id,user_id:users.pro.id,participation_role:'contractor'})).error);
    assert.ifError((await admin.from('review_assignments').insert({project_id:project.id,reviewer_id:users.assigned.id,assigned_at:new Date().toISOString()})).error);
    const v=await admin.from('btp_catalog_versions').select('id').eq('country_code','TN').eq('status','published').single();assert.ifError(v.error);
    const w=await admin.from('btp_works').select('id,unit_code').eq('code','btp_work_tiling').eq('catalog_version_id',v.data!.id).single();assert.ifError(w.error);work=w.data;
  })();

  await t.test('anon is denied at the privilege level',async()=>{
    const r=await anon.rpc('btp_estimate_snapshot_v1',{p_project_id:project.id});assert.ok(r.error);assert.equal(r.error.code,'42501');
    const w=await anon.from('btp_price_items').select('id');assert.ok(w.error);
  });

  await t.test('Artisan member and foreign Client cannot read the estimate (403)',async()=>{
    for(const who of ['pro','stranger'])assert.equal((await get(who,'estimates',`project_id=${project.id}`)).status,403,who);
    assert.equal((await get('owner','estimates',`project_id=${project.id}`)).status,200);
    assert.equal((await get('assigned','estimates',`project_id=${project.id}`)).status,200);
  });

  await t.test('without validated data the estimate is unavailable and lists what is missing',async()=>{
    const r=await post('owner','estimates',{action:'preview',projectId:project.id,lines:[{workId:work.id}]});
    assert.equal(r.status,200);assert.equal(r.body.data.result.coverage.status,'unavailable');assert.equal(r.body.data.result.totals.htMinMinor,null);
    assert.deepEqual(r.body.data.result.missing[0].codes,['quantity_missing','price_missing']);assert.equal(r.body.data.verification.ok,true);
  });

  await t.test('only staff records, the author cannot verify, an Admin verifies',async()=>{
    const s=await post('boss','prices',{action:'register_source',idempotencyKey:'src-'+randomUUID(),code:'real551-'+randomUUID().slice(0,8),name:'Jeu FICTIF CI #551',publisher:'CI',sourceKind:'test_fixture',dataNature:'fictitious_test',licenseNote:'Données fictives de test'});
    assert.equal(s.status,200);fixtureSource=s.body.data.source;
    assert.equal((await post('owner','prices',{action:'record',idempotencyKey:'rec-'+randomUUID(),sourceId:fixtureSource.id,workId:work.id,amountMinMinor:25000,taxBasis:'HT',vatRateBp:1900,observedOn:'2024-01-01',validFrom:'2024-01-01',sourceLocator:'T1'})).status,403);
    const rec=await post('assigned','prices',{action:'record',idempotencyKey:'rec-'+randomUUID(),sourceId:fixtureSource.id,workId:work.id,amountMinMinor:25000,taxBasis:'HT',vatRateBp:1900,observedOn:'2024-01-01',validFrom:'2024-01-01',sourceLocator:'T1 ligne 3'});
    assert.equal(rec.status,200);const item=rec.body.data.item;assert.equal(item.status,'pending');
    assert.equal((await post('assigned','prices',{action:'verify',idempotencyKey:'ver-'+randomUUID(),itemId:item.id,expectedRevision:1})).status,403);
    const ver=await post('boss','prices',{action:'verify',idempotencyKey:'ver-'+randomUUID(),itemId:item.id,expectedRevision:1});
    assert.equal(ver.status,200);assert.equal(ver.body.data.item.verifiedRevision,1);
  });

  await t.test('simulation is exact, saved as an immutable revision, and never leaks to the Artisan',async()=>{
    const key='calc-'+randomUUID();const body={action:'calculate',idempotencyKey:key,projectId:project.id,label:'Simulation CI',mode:'simulation',
      lines:[{workId:work.id,quantity:{value:'12.345'},source:{kind:'declared',reference:'Plan CI'}}]};
    const r=await post('owner','estimates',body);assert.equal(r.status,200);
    const result=r.body.data.current.result;assert.equal(result.coverage.status,'complete');assert.equal(result.totals.htMinMinor,308625);assert.equal(result.totals.ttcMinMinor,367264);
    assert.equal(r.body.data.current.verification.ok,true);
    const replay=await post('owner','estimates',body);assert.equal(replay.body.data.current.resultSha256,r.body.data.current.resultSha256);
    // En mode référence, le tarif fictif n'existe pas.
    const ref=await post('owner','estimates',{action:'preview',projectId:project.id,lines:body.lines});assert.equal(ref.body.data.result.coverage.status,'unavailable');
    const direct=await users.pro.db.from('btp_estimates').select('id').eq('project_id',project.id);assert.ifError(direct.error);assert.equal(direct.data!.length,0);
    const forged=await users.owner.db.from('btp_estimates').update({label:'forgé'}).eq('id',r.body.data.id).select('id');assert.ok(forged.error||forged.data!.length===0);
  });
});
