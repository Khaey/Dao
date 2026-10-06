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
  for(const role of ['client','other','pro','competitor']){
    const email=`award-${role}-${randomUUID()}@example.invalid`,password='P2!'+randomUUID();
    const created=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ifError(created.error);
    const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});assert.ifError((await db.auth.signInWithPassword({email,password})).error);
    await command(db,'initialize_my_account',{p_display_name:role,p_phone_e164:null,p_account_type:['client','other'].includes(role)?'client':'contractor',p_business_name:['pro','competitor'].includes(role)?role:null});
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
  await t.test('racing commands select one winner; results preserve confidentiality and audit',async()=>{
    const f=await fixture();for(const role of ['pro','competitor'])await rpc(role,'submit_bid_version',{p_version_id:f.offers[role].version});
    const outcomes=await Promise.all(['pro','competitor'].map(role=>users.client.db.rpc('award_bid_item_atomic',awardArgs(f.offers[role].items[0].id))));assert.equal(outcomes.filter(r=>!r.error).length,1);
    const winner=outcomes.find(r=>!r.error)!.data;const ai=(await admin.from('award_items').select('*').eq('id',winner.award_item_id).single()).data!;
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
});
