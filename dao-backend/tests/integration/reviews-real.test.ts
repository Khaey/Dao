import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// #213 R1 — verified Client reviews against the disposable Supabase stack with real JWTs.
// Surface failures as GitHub annotations (readable through the checks API) in addition to TAP.
const annotate=(name:string,fn:()=>Promise<void>)=>async()=>{try{await fn();}catch(error:any){console.log(`::error title=reviews-real ${name}::${String(error?.message??error).replace(/\r?\n/g,' ').slice(0,900)}`);throw error;}};
test('reviews: verified eligibility, closed tables, minimal public projection, moderation',async t0=>{
  const t={test:(name:string,fn:()=>Promise<void>)=>t0.test(name,annotate(name,fn))};
  const url=process.env.DAO_SUPABASE_URL!,key=process.env.DAO_SUPABASE_PUBLISHABLE_KEY!,secret=process.env.DAO_SUPABASE_SECRET_KEY!;
  assert.equal(url,'http://127.0.0.1:54321','Only disposable Supabase is authorized');assert.ok(key);assert.ok(secret);
  const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
  const password='Rev!'+randomUUID();const users:any={};
  async function insert(table:string,row:any){const r=await admin.from(table).insert(row).select('*').single();assert.ifError(r.error);return r.data;}
  const call=(name:string,fn:string,args:any={})=>users[name].db.rpc(fn,args);
  async function ok(name:string,fn:string,args:any={}){const r=await call(name,fn,args);assert.ifError(r.error);return r.data;}
  async function denied(name:string,fn:string,args:any,code='42501'){const r=await call(name,fn,args);assert.ok(r.error,`${name} ${fn} must fail`);assert.equal(r.error.code,code,`${name} ${fn}: ${r.error.message}`);}
  let cp:any,cp2:any,project:any,member:any;
  await annotate('setup',async()=>{
    const roles:Record<string,[string,string]>={client:['client','Amira Ben Salem'],client2:['client','Youssef'],outsider:['client','Out Sider'],pro:['contractor','Pro Un'],pro2:['contractor','Pro Deux'],staff:['dao_reviewer','Staff DAO']};
    for(const [name,[role,display]] of Object.entries(roles)){
      const email=`rev213-${name}-${randomUUID()}@example.invalid`;const created=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ifError(created.error);
      const id=created.data.user!.id;assert.ifError((await admin.from('profiles').insert({user_id:id,display_name:display})).error);assert.ifError((await admin.from('user_roles').insert({user_id:id,role})).error);
      const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});assert.ifError((await db.auth.signInWithPassword({email,password})).error);
      users[name]={id,db};
    }
    cp=await insert('contractor_profiles',{user_id:users.pro.id,business_name:'Société privée avis',public_trade_name:'Atelier Avis',contractor_type:'company',verification_status:'verified',public_identity_status:'approved'});
    cp2=await insert('contractor_profiles',{user_id:users.pro2.id,business_name:'Autre pro',contractor_type:'artisan',verification_status:'verified',public_identity_status:'approved'});
    await insert('contractor_profile_details',{contractor_id:cp.id,review_status:'approved',city:'Tunis'});
    const gov=(await admin.from('governorates').select('id').limit(1).single()).data!;
    project=await insert('projects',{client_id:users.client.id,initiator_id:users.client.id,project_origin:'client_existing_team'});
    await insert('project_versions',{project_id:project.id,version_no:1,title:'Titre privé du chantier avis',description:'',governorate_id:gov.id});
    member=await insert('project_members',{project_id:project.id,user_id:users.pro.id,participation_role:'contractor'});
  })();
  const review=(stars:number,comment:string,extra:any={})=>({p_project_id:project.id,p_contractor_id:cp.id,p_input:{rating:stars,comment,...extra}});
  const good='Travail soigné, équipe ponctuelle, chantier laissé propre chaque soir.';
  let reviewId='';

  await t.test('eligibility starts with the works and only for the real Client × professional pair',async()=>{
    assert.deepEqual(await ok('client','my_review_opportunities'),[]);
    await denied('client','submit_contractor_review',review(5,good));
    assert.ifError((await admin.from('projects').update({project_stage:'started'}).eq('id',project.id)).error);
    const opportunities=await ok('client','my_review_opportunities');
    assert.equal(opportunities.length,1);assert.equal(opportunities[0].contractor_id,cp.id);assert.equal(opportunities[0].review,null);
    await denied('outsider','submit_contractor_review',review(1,'Avis forgé par un tiers qui n a jamais eu de chantier.'));
    await denied('client','submit_contractor_review',{...review(1,'Professionnel absent de ce chantier, avis refusé.'),p_contractor_id:cp2.id});
    await denied('pro','submit_contractor_review',review(5,'Le professionnel tente de se noter lui-même ici.'));
  });

  await t.test('validation: scores 1–5, comment length, no contact details',async()=>{
    for(const input of [review(6,good),review(0,good),review(4.5,good),review(5,'Trop court'),
      review(5,'Appelez-le au +216 20 123 456 pour un devis rapide.'),review(5,'Écrivez à artisan.exemple@mail.tn pour un devis.'),
      review(5,'Voir www.exemple.tn pour ses autres réalisations.'),review(5,good,{quality:9})])
      await denied('client','submit_contractor_review',input,'22023');
  });

  await t.test('publish, edit in place, tables stay closed',async()=>{
    const first=await ok('client','submit_contractor_review',review(4,'Chantier 2024, budget de 12 000 TND respecté, finitions soignées.',{quality:5,deadlines:3}));
    assert.equal(first.status,'published');reviewId=first.id;
    const edited=await ok('client','submit_contractor_review',review(5,good,{quality:5,deadlines:4,budget:5,communication:5,cleanliness:4}));
    assert.equal(edited.id,reviewId);assert.equal(edited.edited,true);
    for(const name of ['client','pro','staff']){
      const read=await users[name].db.from('contractor_reviews').select('*');assert.ok(read.error,`${name} cannot read the table`);
    }
    assert.ok((await users.client.db.from('contractor_reviews').update({rating:1}).eq('id',reviewId)).error);
    assert.ok((await users.pro.db.from('contractor_review_reports').insert({review_id:reviewId,reporter_id:users.pro.id,reason:'other'})).error);
    assert.ok((await users.pro.db.from('contractor_review_responses').insert({review_id:reviewId,author_id:users.pro.id,body:'forgé'})).error);
  });

  await t.test('public read: published only, minimal projection, same gates as the profile',async()=>{
    const view=await ok('client2','professional_reviews',{p_contractor_id:cp.id,p_limit:10,p_offset:0});
    assert.equal(view.items.length,1);assert.equal(view.summary.count,1);assert.equal(Number(view.summary.average),5);
    assert.deepEqual(Object.keys(view.items[0]).sort(),['author','comment','criteria','edited','governorate','id','month','rating','response']);
    assert.equal(view.items[0].author,'Amira S.');
    const serialized=JSON.stringify(view);
    for(const secret of [users.client.id,project.id,'Titre privé','Ben Salem'])assert.equal(serialized.includes(secret),false,secret);
    const card=(await ok('client2','professional_directory',{p_review:false})).find((row:any)=>row.id===cp.id);
    assert.equal(card.rating_count,1);assert.equal(Number(card.rating_average),5);
    assert.equal((await ok('client2','professional_public_profile',{p_id:cp.id,p_preview:false})).rating.count,1);
    await denied('pro2','professional_reviews',{p_contractor_id:cp.id,p_limit:10,p_offset:0});
    const anon=createClient(url,key,{auth:{persistSession:false}});assert.ok((await anon.rpc('professional_reviews',{p_contractor_id:cp.id,p_limit:10,p_offset:0})).error);
  });

  await t.test('response and report belong to the reviewed professional only',async()=>{
    await denied('client','respond_to_contractor_review',{p_review_id:reviewId,p_body:'Merci'});
    await denied('pro2','respond_to_contractor_review',{p_review_id:reviewId,p_body:'Réponse usurpée'});
    await denied('pro','respond_to_contractor_review',{p_review_id:reviewId,p_body:'Appelez le 20123456'},'22023');
    await ok('pro','respond_to_contractor_review',{p_review_id:reviewId,p_body:'Merci pour votre confiance !'});
    assert.equal((await ok('client2','professional_reviews',{p_contractor_id:cp.id,p_limit:10,p_offset:0})).items[0].response.body,'Merci pour votre confiance !');
    assert.equal((await ok('pro','my_received_reviews')).length,1);
    await denied('client2','report_contractor_review',{p_review_id:reviewId,p_reason:'fake',p_details:''});
    await denied('pro','report_contractor_review',{p_review_id:reviewId,p_reason:'bad',p_details:''},'22023');
    assert.equal((await ok('pro','report_contractor_review',{p_review_id:reviewId,p_reason:'fake',p_details:'Chantier inconnu'})).status,'open');
  });

  await t.test('staff moderation with mandatory reason; withdraw cannot bypass a hide',async()=>{
    await denied('pro','moderate_contractor_review',{p_review_id:reviewId,p_action:'hide',p_reason:'Raison valide'});
    await denied('client','review_moderation_queue',{});
    assert.equal((await ok('staff','review_moderation_queue'))[0].id,reviewId);
    await denied('staff','moderate_contractor_review',{p_review_id:reviewId,p_action:'hide',p_reason:''},'22023');
    await ok('staff','moderate_contractor_review',{p_review_id:reviewId,p_action:'hide',p_reason:'Chantier contesté, vérification en cours'});
    assert.equal((await ok('client2','professional_reviews',{p_contractor_id:cp.id,p_limit:10,p_offset:0})).items.length,0);
    assert.equal((await ok('client2','professional_directory',{p_review:false})).find((row:any)=>row.id===cp.id).rating_count,0);
    assert.equal((await ok('client','my_review_opportunities'))[0].review.hidden_reason,'Chantier contesté, vérification en cours');
    await ok('client','withdraw_contractor_review',{p_review_id:reviewId});
    assert.equal((await ok('client','submit_contractor_review',review(5,good))).status,'hidden');
    await ok('staff','moderate_contractor_review',{p_review_id:reviewId,p_action:'restore',p_reason:null});
    assert.equal((await ok('client2','professional_reviews',{p_contractor_id:cp.id,p_limit:10,p_offset:0})).items.length,1);
    await denied('outsider','withdraw_contractor_review',{p_review_id:reviewId});
  });

  await t.test('losing the relationship blocks edits but keeps the published review; actions are audited',async()=>{
    assert.ifError((await admin.from('project_members').update({status:'revoked',revoked_at:new Date().toISOString()}).eq('id',member.id)).error);
    await denied('client','submit_contractor_review',review(1,'Modification après retrait du professionnel du chantier.'));
    assert.equal((await ok('client2','professional_reviews',{p_contractor_id:cp.id,p_limit:10,p_offset:0})).items.length,1);
    const audit=await admin.from('audit_events').select('action,metadata').eq('entity_type','contractor_review').eq('entity_id',reviewId);
    assert.ifError(audit.error);assert.ok(audit.data!.length>=8);
    assert.equal(JSON.stringify(audit.data).includes('soigné'),false,'audit never stores review text');
  });
});
