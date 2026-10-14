import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

test('P2.1 real JWT/RLS, award/cancel/reassign and independent-session concurrency',async t=>{
  const url=process.env.DAO_SUPABASE_URL!;
  assert.equal(url,'http://127.0.0.1:54321','P2.1 requires disposable Supabase');
  const key=process.env.DAO_SUPABASE_PUBLISHABLE_KEY!,secret=process.env.DAO_SUPABASE_SECRET_KEY!;
  assert.ok(key);assert.ok(secret);
  const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
  async function insert(table:string,data:any){const result=await admin.from(table).insert(data).select('*').single();assert.ifError(result.error);return result.data;}
  async function command(db:any,name:string,args:any){const result=await db.rpc(name,args);assert.ifError(result.error);return result.data;}
  async function denied(db:any,name:string,args:any,code?:string){const result=await db.rpc(name,args);assert.ok(result.error);if(code)assert.equal(result.error.code,code);}
  const users:any={};
  for(const role of ['client','other','pro','competitor','dao']){
    const email=`award-${role}-${randomUUID()}@example.invalid`,password='P2!'+randomUUID();
    const created=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ifError(created.error);
    const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});assert.ifError((await db.auth.signInWithPassword({email,password})).error);
    await command(db,'initialize_my_account',{p_display_name:role,p_phone_e164:null,p_account_type:['pro','competitor'].includes(role)?'contractor':'client',p_business_name:['pro','competitor'].includes(role)?role:null});
    users[role]={db,id:created.data.user!.id};
    if(['pro','competitor'].includes(role)){const update=await admin.from('contractor_profiles').update({verification_status:'verified'}).eq('user_id',created.data.user!.id);assert.ifError(update.error);}
  }
  const gov=(await admin.from('governorates').select('id').eq('code','E2E_TEST').single()).data!.id;
  const trade=(await admin.from('trades').select('id').eq('code','plumbing').single()).data!.id;
  const rpc=(role:string,name:string,args:any)=>command(users[role].db,name,args);
  async function fixture(grouped=false){
    const p=await insert('projects',{client_id:users.client.id});
    const v=await insert('project_versions',{project_id:p.id,version_no:1,title:'P2.1 '+randomUUID(),description:'safe',governorate_id:gov,status:'approved'});
    const pub=await insert('publications',{project_id:p.id,project_version_id:v.id,visibility:'public',safe_title:v.title,safe_description:'safe',governorate_id:gov,project_type:'renovation',published_at:new Date().toISOString()});
    const lots=[];
    for(let n=0;n<2;n++){const lot=await insert('project_requests',{project_id:p.id});const rv=await insert('project_request_versions',{project_id:p.id,request_id:lot.id,version_no:1,title:'Lot '+n,scope:'safe',trade_id:trade});const pr=await insert('publication_requests',{publication_id:pub.id,request_version_id:rv.id,safe_title:rv.title,safe_scope:'safe',trade_id:trade});lots.push({id:lot.id,pr:pr.id});}
    const offers:any={};
    for(const role of ['pro','competitor']){
      const draft=await rpc(role,'create_bid_draft',{p_publication_id:pub.id}),items=[];
      for(const lot of lots)items.push(await rpc(role,'upsert_bid_item',{p_publication_id:pub.id,p_version_id:draft.id,p_publication_request_id:lot.pr,p_price_millimes:1001,p_duration_days:2,p_inclusions:'original',p_exclusions:null}));
      let group:any=null;if(grouped&&role==='pro')group=await rpc(role,'configure_bid_package',{p_version_id:draft.id,p_indivisible:true});
      offers[role]={version:draft.id,items,group:group?.group_id};
    }
    return {project:p.id,pub:pub.id,lots,offers};
  }
  const awardArgs=(id:string,key=randomUUID())=>({p_idempotency_key:key,p_bid_item_id:id});
  const cancelArgs=(id:string,key=randomUUID())=>({p_idempotency_key:key,p_award_item_id:id,p_reason:'withdrawal',p_comment:null});
  async function grantDaoAdminAfterGlobalInvariantRace(){
    // This suite runs before the Backoffice suite in the shared database. The
    // latter temporarily isolates external admins while testing its invariant.
    assert.ifError((await admin.from('user_roles').insert({user_id:users.dao.id,role:'dao_admin'})).error);
  }
  await t.test('racing commands select one winner; results preserve confidentiality and audit',async()=>{
    const f=await fixture();for(const role of ['pro','competitor'])await rpc(role,'submit_bid_version',{p_version_id:f.offers[role].version});
    const outcomes=await Promise.all(['pro','competitor'].map(role=>users.client.db.rpc('award_bid_item_atomic',awardArgs(f.offers[role].items[0].id))));assert.equal(outcomes.filter(r=>!r.error).length,1);
    const winner=outcomes.find(r=>!r.error)!.data;const ai=(await admin.from('award_items').select('*').eq('id',winner.award_item_id).single()).data!;
    const uiRead=await users.client.db.from('award_items').select('id,request_id,bid_item_id,agreed_millimes,active,bid_items!award_items_bid_item_id_fkey(bid_version_id)').eq('project_id',f.project);assert.ifError(uiRead.error);assert.equal(uiRead.data!.length,1);assert.ok((uiRead.data![0] as any).bid_items.bid_version_id);
    const loser=ai.bid_item_id===f.offers.pro.items[0].id?'competitor':'pro';const loserItem=f.offers[loser].items[0].id;
    const own=await users[loser].db.from('bid_item_results').select('id,bid_item_id,status').eq('bid_item_id',loserItem);assert.ifError(own.error);assert.equal(own.data![0].status,'not_selected');
    const other=await users.other.db.from('bid_item_results').select('id,bid_item_id,status').eq('bid_item_id',loserItem);assert.ifError(other.error);assert.equal(other.data!.length,0);
    const hidden=await users[loser].db.from('bid_item_results').select('source_award_item_id');assert.ok(hidden.error);
    await denied(users[loser].db,'cancel_award_item_atomic',cancelArgs(ai.id),'42501');
    await denied(users.client.db,'cancel_award_item_atomic',{...cancelArgs(ai.id),p_reason:'other'},'22023');
    const key=randomUUID(),cancel=cancelArgs(ai.id,key);const cancellations=await Promise.all([users.client.db.rpc('cancel_award_item_atomic',cancel),users.client.db.rpc('cancel_award_item_atomic',cancel)]);for(const result of cancellations)assert.ifError(result.error);assert.deepEqual(cancellations[0].data,cancellations[1].data);
    const audit=await admin.from('award_cancellations').select('*').eq('award_item_id',ai.id);assert.ifError(audit.error);assert.equal(audit.data!.length,1);assert.equal(audit.data![0].actor_id,users.client.id);assert.ok(audit.data![0].created_at);
    assert.ok((await admin.from('award_cancellations').delete().eq('award_item_id',ai.id)).error);
    assert.ok((await admin.from('award_items').update({agreed_millimes:1}).eq('id',ai.id)).error);
    assert.ok((await admin.from('award_items').delete().eq('id',ai.id)).error);
    const nextArgs=awardArgs(loserItem);const replay=await Promise.all([users.client.db.rpc('award_bid_item_atomic',nextArgs),users.client.db.rpc('award_bid_item_atomic',nextArgs)]);for(const result of replay)assert.ifError(result.error);assert.deepEqual(replay[0].data,replay[1].data);
    const all=await admin.from('award_items').select('id,active,agreed_millimes').eq('project_id',f.project);assert.ifError(all.error);assert.equal(all.data!.length,2);assert.equal(all.data!.filter(row=>row.active).length,1);assert.equal(all.data!.find(row=>row.id===ai.id)!.agreed_millimes,1001);
    await denied(users.client.db,'award_bid_item_atomic',{...nextArgs,p_bid_item_id:f.offers[loser].items[1].id},'22023');
    assert.equal((await admin.from('contracts').select('id').eq('project_id',f.project)).data!.length,0);
    assert.equal((await admin.from('project_members').select('id').eq('project_id',f.project).eq('participation_role','contractor')).data!.length,0);
  });
  await t.test('submission racing attribution cannot leave a new offer on a closed lot',async()=>{
    const f=await fixture();await rpc('pro','submit_bid_version',{p_version_id:f.offers.pro.version});
    const [award,submit]=await Promise.all([users.client.db.rpc('award_bid_item_atomic',awardArgs(f.offers.pro.items[0].id)),users.competitor.db.rpc('submit_bid_version',{p_version_id:f.offers.competitor.version})]);assert.ifError(award.error);
    if(submit.error)assert.equal(submit.error.code,'23514');else {const results=await users.competitor.db.from('bid_item_results').select('status').eq('bid_item_id',f.offers.competitor.items[0].id);assert.ifError(results.error);assert.equal(results.data![0].status,'not_selected');}
    const draft=await rpc('competitor','create_bid_draft',{p_publication_id:f.pub});
    await denied(users.competitor.db,'upsert_bid_item',{p_publication_id:f.pub,p_version_id:draft.id,p_publication_request_id:f.lots[0].pr,p_price_millimes:1,p_duration_days:1,p_inclusions:'late',p_exclusions:null},'23514');
  });
  await t.test('racing packages and overlapping lots are all-or-none; cancellation reopens all package lots',async()=>{
    const f=await fixture(true);for(const role of ['pro','competitor'])await rpc(role,'submit_bid_version',{p_version_id:f.offers[role].version});
    await denied(users.client.db,'award_bid_item_atomic',awardArgs(f.offers.pro.items[0].id),'23514');
    const params={p_idempotency_key:randomUUID(),p_group_id:f.offers.pro.group};const result=await rpc('client','award_bid_group_atomic',params);assert.equal(result.items.length,2);assert.deepEqual(await rpc('client','award_bid_group_atomic',params),result);
    const cancelled=await rpc('client','cancel_award_item_atomic',cancelArgs(result.items[0].award_item_id));assert.equal(cancelled.cancelled_item_ids.length,2);
    const availability=await rpc('competitor','publication_lot_availability',{p_publication_id:f.pub});assert.equal(availability.every((lot:any)=>lot.accepts_offers),true);
    const race=await Promise.all([users.client.db.rpc('award_bid_group_atomic',{...params,p_idempotency_key:randomUUID()}),users.client.db.rpc('award_bid_item_atomic',awardArgs(f.offers.competitor.items[0].id))]);assert.equal(race.filter(r=>!r.error).length,1);
    const active=await admin.from('award_items').select('id').eq('project_id',f.project).eq('active',true);assert.ifError(active.error);assert.equal(active.data!.length,race[0].error?1:2);
    if(race[0].error){const lot=await admin.from('project_requests').select('status').eq('id',f.lots[1].id).single();assert.equal(lot.data!.status,'open');}
    else await denied(users.pro.db,'create_bid_draft',{p_publication_id:f.pub},'23514');
  });
  await t.test('contract foundation snapshots one award atomically and remains private and immutable',async()=>{
    const f=await fixture(true);await rpc('pro','submit_bid_version',{p_version_id:f.offers.pro.version});
    const awarded=await rpc('client','award_bid_group_atomic',{p_idempotency_key:randomUUID(),p_group_id:f.offers.pro.group});
    const award=(await admin.from('award_items').select('award_id').eq('id',awarded.items[0].award_item_id).single()).data!;
    const args={p_actor_id:users.dao.id,p_award_id:award.award_id,p_dao_user_id:users.dao.id,p_dao_legal_name:'D.A.O TEST',p_idempotency_key:randomUUID()};
    assert.ok((await users.dao.db.rpc('prepare_contract_foundation',args)).error,'authenticated callers stay denied');
    await grantDaoAdminAfterGlobalInvariantRace();
    const prepared=await admin.rpc('prepare_contract_foundation',args);assert.ifError(prepared.error);
    const replay=await admin.rpc('prepare_contract_foundation',args);assert.ifError(replay.error);assert.deepEqual(replay.data,prepared.data);
    assert.equal(prepared.data.item_count,2);assert.equal(prepared.data.total_millimes,2002);assert.equal(prepared.data.non_engaging,true);
    for(const role of ['client','pro','dao']){const visible=await users[role].db.from('contracts').select('id,status,total_millimes').eq('id',prepared.data.contract_id);assert.ifError(visible.error);assert.equal(visible.data!.length,1);}
    for(const role of ['other','competitor']){const hidden=await users[role].db.from('contracts').select('id').eq('id',prepared.data.contract_id);assert.ifError(hidden.error);assert.equal(hidden.data!.length,0);}
    const items=await users.pro.db.from('contract_items').select('agreed_millimes,title,duration_days').eq('contract_id',prepared.data.contract_id);assert.ifError(items.error);assert.equal(items.data!.length,2);
    const version=await users.client.db.from('contract_versions').select('id,content,content_hash').eq('id',prepared.data.version_id).single();assert.ifError(version.error);assert.equal(version.data!.content.non_engaging,true);assert.match(version.data!.content_hash,/^[0-9a-f]{64}$/);
    assert.ok((await admin.from('contract_versions').update({content:{forged:true}}).eq('id',prepared.data.version_id)).error);
    assert.ok((await admin.from('contract_items').delete().eq('contract_id',prepared.data.contract_id)).error);
    assert.ok((await admin.from('contracts').update({status:'signed'}).eq('id',prepared.data.contract_id)).error);
    await denied(users.client.db,'cancel_award_item_atomic',cancelArgs(awarded.items[0].award_item_id),'23514');
    const forbiddenLegalStart=await admin.rpc('start_contract_acceptance',{p_actor_id:users.dao.id,p_contract_id:prepared.data.contract_id,p_signature_mode:'trusted_simple',p_legal_effect_enabled:true,p_idempotency_key:randomUUID()});
    assert.ok(forbiddenLegalStart.error,'P2.2-B must reject legal activation');
    const startArgs={p_actor_id:users.dao.id,p_contract_id:prepared.data.contract_id,p_signature_mode:'trusted_simple',p_legal_effect_enabled:false,p_idempotency_key:randomUUID()};
    assert.ok((await users.dao.db.rpc('start_contract_acceptance',startArgs)).error,'acceptance orchestration stays service-only');
    const started=await admin.rpc('start_contract_acceptance',startArgs);assert.ifError(started.error);assert.equal(started.data.status,'awaiting_signatures');assert.equal(started.data.legal_effect_enabled,false);
    const evidence='a'.repeat(64),acceptedAt=new Date().toISOString();
    const accept=(actor:string)=>({p_actor_id:actor,p_contract_id:prepared.data.contract_id,p_contract_version_id:prepared.data.version_id,p_method:'trusted_simple',p_evidence_hash:evidence,p_provider_reference:null,p_evidence_metadata:{channel:'test'},p_accepted_at:acceptedAt,p_idempotency_key:randomUUID()});
    await denied(admin,'record_contract_acceptance',accept(users.other.id),'42501');
    const clientAcceptance=await admin.rpc('record_contract_acceptance',accept(users.client.id));assert.ifError(clientAcceptance.error);assert.equal(clientAcceptance.data.party_role,'client');
    await denied(admin,'validate_contract_acceptance',{p_actor_id:users.dao.id,p_contract_id:prepared.data.contract_id,p_reason:'Contrôle TEST',p_idempotency_key:randomUUID()},'23514');
    const contractorAcceptance=await admin.rpc('record_contract_acceptance',accept(users.pro.id));assert.ifError(contractorAcceptance.error);assert.equal(contractorAcceptance.data.party_role,'contractor');
    const proof=await users.client.db.from('contract_acceptances').select('party_role,method,evidence_hash').eq('contract_id',prepared.data.contract_id);assert.ifError(proof.error);assert.equal(proof.data!.length,2);
    const validated=await admin.rpc('validate_contract_acceptance',{p_actor_id:users.dao.id,p_contract_id:prepared.data.contract_id,p_reason:'Contrôle TEST',p_idempotency_key:randomUUID()});assert.ifError(validated.error);assert.equal(validated.data.status,'ready');assert.equal(validated.data.legal_effect_enabled,false);
    const proposalArgs={p_actor_id:users.client.id,p_contract_id:prepared.data.contract_id,p_scope_clarification:'Clarification sans ajout de lot',p_amount_delta_millimes:500,p_planned_start_date:'2027-01-15',p_duration_days:12,p_reason:'Évolution proposée TEST',p_idempotency_key:randomUUID()};
    assert.ok((await users.client.db.rpc('propose_contract_amendment',proposalArgs)).error,'amendment orchestration stays service-only');
    await denied(admin,'propose_contract_amendment',{...proposalArgs,p_actor_id:users.pro.id,p_idempotency_key:randomUUID()},'42501');
    await denied(admin,'propose_contract_amendment',{...proposalArgs,p_actor_id:users.other.id,p_idempotency_key:randomUUID()},'42501');
    const proposed=await admin.rpc('propose_contract_amendment',proposalArgs);assert.ifError(proposed.error);
    const proposedReplay=await admin.rpc('propose_contract_amendment',proposalArgs);assert.ifError(proposedReplay.error);assert.deepEqual(proposedReplay.data,proposed.data);
    assert.equal(proposed.data.status,'awaiting_acceptances');assert.equal(proposed.data.legal_effect_enabled,false);assert.equal(proposed.data.proposed_total_millimes,2502);
    for(const role of ['client','pro','dao']){const visible=await users[role].db.from('contract_amendments').select('id,status,legal_effect_enabled').eq('id',proposed.data.amendment_id);assert.ifError(visible.error);assert.equal(visible.data!.length,1);}
    for(const role of ['other','competitor']){const hidden=await users[role].db.from('contract_amendments').select('id').eq('id',proposed.data.amendment_id);assert.ifError(hidden.error);assert.equal(hidden.data!.length,0);}
    const amendmentVersion=await users.pro.db.from('contract_amendment_versions').select('content,content_hash').eq('id',proposed.data.amendment_version_id).single();assert.ifError(amendmentVersion.error);assert.equal(amendmentVersion.data!.content.non_engaging,true);assert.equal(amendmentVersion.data!.content.base_contract_version_id,prepared.data.version_id);assert.match(amendmentVersion.data!.content_hash,/^[0-9a-f]{64}$/);
    assert.ok((await admin.from('contract_amendment_versions').update({content:{forged:true}}).eq('id',proposed.data.amendment_version_id)).error);
    assert.ok((await admin.from('contract_amendments').update({legal_effect_enabled:true}).eq('id',proposed.data.amendment_id)).error);
    const amendmentAccept=(actor:string)=>({p_actor_id:actor,p_amendment_id:proposed.data.amendment_id,p_amendment_version_id:proposed.data.amendment_version_id,p_method:'trusted_simple',p_evidence_hash:evidence,p_provider_reference:null,p_evidence_metadata:{channel:'test'},p_accepted_at:acceptedAt,p_idempotency_key:randomUUID()});
    await denied(admin,'record_contract_amendment_acceptance',amendmentAccept(users.other.id),'42501');
    assert.ifError((await admin.rpc('record_contract_amendment_acceptance',amendmentAccept(users.client.id))).error);
    await denied(admin,'validate_contract_amendment',{p_actor_id:users.dao.id,p_amendment_id:proposed.data.amendment_id,p_reason:'Contrôle prématuré',p_idempotency_key:randomUUID()},'23514');
    assert.ifError((await admin.rpc('record_contract_amendment_acceptance',amendmentAccept(users.pro.id))).error);
    const amendmentProofs=await users.client.db.from('contract_amendment_acceptances').select('party_role,evidence_hash').eq('amendment_id',proposed.data.amendment_id);assert.ifError(amendmentProofs.error);assert.equal(amendmentProofs.data!.length,2);
    const acceptedAmendment=await admin.rpc('validate_contract_amendment',{p_actor_id:users.dao.id,p_amendment_id:proposed.data.amendment_id,p_reason:'Contrôle D.A.O TEST',p_idempotency_key:randomUUID()});assert.ifError(acceptedAmendment.error);assert.equal(acceptedAmendment.data.status,'accepted');assert.equal(acceptedAmendment.data.legal_effect_enabled,false);
    const unchangedContract=await admin.from('contracts').select('status,total_millimes,current_version_id,legal_effect_enabled').eq('id',prepared.data.contract_id).single();assert.ifError(unchangedContract.error);assert.deepEqual(unchangedContract.data,{status:'ready',total_millimes:2002,current_version_id:prepared.data.version_id,legal_effect_enabled:false});
    assert.ok((await admin.from('contract_amendment_acceptances').delete().eq('amendment_id',proposed.data.amendment_id)).error);
    const rejectedProposal=await admin.rpc('propose_contract_amendment',{...proposalArgs,p_scope_clarification:'Autre clarification',p_amount_delta_millimes:null,p_planned_start_date:null,p_duration_days:null,p_idempotency_key:randomUUID()});assert.ifError(rejectedProposal.error);
    const rejected=await admin.rpc('reject_contract_amendment',{p_actor_id:users.pro.id,p_amendment_id:rejectedProposal.data.amendment_id,p_reason:'Refus motivé TEST',p_idempotency_key:randomUUID()});assert.ifError(rejected.error);assert.equal(rejected.data.status,'rejected');assert.equal(rejected.data.party_role,'contractor');
    await denied(admin,'validate_contract_amendment',{p_actor_id:users.dao.id,p_amendment_id:rejectedProposal.data.amendment_id,p_reason:'Interdit',p_idempotency_key:randomUUID()},'23514');
    const cancelledProposal=await admin.rpc('propose_contract_amendment',{...proposalArgs,p_scope_clarification:null,p_amount_delta_millimes:null,p_planned_start_date:'2027-02-01',p_duration_days:15,p_idempotency_key:randomUUID()});assert.ifError(cancelledProposal.error);
    const cancelledAmendment=await admin.rpc('cancel_contract_amendment',{p_actor_id:users.dao.id,p_amendment_id:cancelledProposal.data.amendment_id,p_reason:'Annulation D.A.O motivée TEST',p_idempotency_key:randomUUID()});assert.ifError(cancelledAmendment.error);assert.equal(cancelledAmendment.data.status,'cancelled');
    assert.ok((await admin.from('contract_amendment_events').delete().eq('amendment_id',cancelledProposal.data.amendment_id)).error);
    await denied(admin,'cancel_contract_draft',{p_actor_id:users.dao.id,p_contract_id:prepared.data.contract_id,p_reason:'Trop tard',p_idempotency_key:randomUUID()},'23514');
    const racing=await fixture();await rpc('pro','submit_bid_version',{p_version_id:racing.offers.pro.version});
    const selected=await rpc('client','award_bid_item_atomic',awardArgs(racing.offers.pro.items[0].id));
    const selectedRow=(await admin.from('award_items').select('award_id').eq('id',selected.award_item_id).single()).data!;
    const raceArgs={...args,p_award_id:selectedRow.award_id,p_idempotency_key:randomUUID()};
    const race=await Promise.all([admin.rpc('prepare_contract_foundation',raceArgs),users.client.db.rpc('cancel_award_item_atomic',cancelArgs(selected.award_item_id))]);
    assert.equal(race.filter(result=>!result.error).length,1,'prepare and cancel cannot both commit');
    if(!race[0].error){
      const cancelled=await admin.rpc('cancel_contract_draft',{p_actor_id:users.dao.id,p_contract_id:race[0].data.contract_id,p_reason:'Abandon motivé TEST',p_idempotency_key:randomUUID()});assert.ifError(cancelled.error);assert.equal(cancelled.data.status,'cancelled');
      assert.ok((await admin.from('contract_events').delete().eq('contract_id',race[0].data.contract_id)).error);
    }
  });
});
