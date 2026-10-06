import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
export async function awardLifecycleCases(db, check) {
  const insert=async(table,values)=>{const keys=Object.keys(values);return (await db.query(`insert into public.${table}(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')}) returning *`,Object.values(values))).rows[0];};
  const actors={};
  for(const role of ['client','other','pro','competitor','staff']){
    const id=randomUUID();await db.query('insert into auth.users values($1)',[id]);
    await insert('user_roles',{user_id:id,role:role==='staff'?'dao_reviewer':['client','other'].includes(role)?'client':'contractor'});actors[role]={id};
    if(['pro','competitor'].includes(role))actors[role].cp=(await insert('contractor_profiles',{user_id:id,business_name:role,verification_status:'verified'})).id;
  }
  const gov=(await db.query('select id from public.governorates limit 1')).rows[0].id,trade=(await db.query('select id from public.trades where active limit 1')).rows[0].id;
  async function as(role,fn){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actors[role].id]);await db.exec('set role authenticated');try{return await fn();}finally{await db.exec("reset role;select set_config('request.jwt.claim.sub','',false)");}}
  async function rpc(role,name,args){return as(role,async()=>(await db.query(`select to_jsonb(public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})) as result`,args)).rows[0].result);}
  const denied=async(role,name,args,code)=>assert.rejects(rpc(role,name,args),e=>e.code===code);
  async function fixture(){
    const p=await insert('projects',{client_id:actors.client.id});
    const v=await insert('project_versions',{project_id:p.id,version_no:1,title:'fixture',description:'safe',governorate_id:gov,status:'approved'});
    const pub=await insert('publications',{project_id:p.id,project_version_id:v.id,visibility:'public',safe_title:'safe',safe_description:'safe',governorate_id:gov,project_type:'renovation',published_at:new Date().toISOString()});const lots=[];
    for(let n=0;n<2;n++){const lot=await insert('project_requests',{project_id:p.id});const rv=await insert('project_request_versions',{project_id:p.id,request_id:lot.id,version_no:1,title:'Lot '+n,scope:'safe',trade_id:trade});const pr=await insert('publication_requests',{publication_id:pub.id,request_version_id:rv.id,safe_title:'Lot '+n,safe_scope:'safe',trade_id:trade});lots.push({id:lot.id,pr:pr.id});}
    async function offer(role){const v=await rpc(role,'create_bid_draft',[pub.id]),items=[];for(const lot of lots)items.push(await rpc(role,'upsert_bid_item',[pub.id,v.id,lot.pr,1001,2,'original',null]));return {version:v.id,items};}
    return {project:p.id,pub:pub.id,lots,a:await offer('pro'),b:await offer('competitor')};
  }
  const f=await fixture();await rpc('pro','submit_bid_version',[f.a.version]);await rpc('competitor','submit_bid_version',[f.b.version]);let award;
  await check('P2.1 closes only the awarded lot; not_selected is per-line and commercial content remains immutable',async()=>{
    award=await rpc('client','award_bid_item_atomic',[randomUUID(),f.a.items[0].id]);
    assert.equal((await db.query('select status from public.bid_item_results where bid_item_id=$1 order by id desc limit 1',[f.b.items[0].id])).rows[0].status,'not_selected');
    assert.equal((await db.query('select inclusions from public.bid_items where id=$1',[f.b.items[0].id])).rows[0].inclusions,'original');
    assert.equal((await db.query('select status from public.bid_versions where id=$1',[f.b.version])).rows[0].status,'submitted');
    const lots=await rpc('competitor','publication_lot_availability',[f.pub]);assert.equal(lots.find(x=>x.request_id===f.lots[0].id).accepts_offers,false);assert.equal(lots.find(x=>x.request_id===f.lots[1].id).accepts_offers,true);
    assert.equal((await db.query('select payment_status from public.projects where id=$1',[f.project])).rows[0].payment_status,'not_set');
  });
  await check('P2.1 closed-lot writes and pre-award draft submission are denied in SQL',async()=>{
    const d=await rpc('competitor','create_bid_draft',[f.pub]);await denied('competitor','upsert_bid_item',[f.pub,d.id,f.lots[0].pr,100,1,'blocked',null],'23514');await rpc('competitor','upsert_bid_item',[f.pub,d.id,f.lots[1].pr,100,1,'open',null]);
    const old=await fixture();await rpc('pro','submit_bid_version',[old.a.version]);await rpc('client','award_bid_item_atomic',[randomUUID(),old.a.items[0].id]);await denied('competitor','submit_bid_version',[old.b.version],'23514');
    assert.equal((await db.query('select status from public.bid_versions where id=$1',[old.b.version])).rows[0].status,'draft');
  });
  await check('P2.1 result RLS isolates competitors and hides the source winner; history and award value cannot be rewritten',async()=>{
    for(const role of ['pro','other'])await as(role,async()=>assert.equal((await db.query('select id,status from public.bid_item_results where bid_item_id=$1',[f.b.items[0].id])).rows.length,0));
    await as('competitor',async()=>assert.equal((await db.query('select status from public.bid_item_results where bid_item_id=$1',[f.b.items[0].id])).rows[0].status,'not_selected'));
    await as('competitor',async()=>assert.rejects(db.query('select source_award_item_id from public.bid_item_results'),e=>e.code==='42501'));
    for(const sql of ["update public.bid_item_results set status='available'",'delete from public.bid_item_results'])await assert.rejects(db.exec(sql),e=>e.code==='23514');
    for(const sql of ['update public.award_items set agreed_millimes=1 where id=$1','delete from public.award_items where id=$1','update public.award_items set active=false where id=$1'])await assert.rejects(db.query(sql,[award.award_item_id]),e=>e.code==='23514');
  });
  await check('P2.1 cancellation enforces owner/staff, enumerated reason and comment for other',async()=>{
    for(const role of ['other','pro','competitor'])await denied(role,'cancel_award_item_atomic',[randomUUID(),award.award_item_id,'withdrawal',null],'42501');
    for(const reason of [null,'','invalid','other'])await denied('client','cancel_award_item_atomic',[randomUUID(),award.award_item_id,reason,null],'22023');
  });
  await check('P2.1 cancellation replay, reopen and reassignment preserve amounts and actor/date/reason',async()=>{
    const key=randomUUID(),args=[key,award.award_item_id,'other','Désaccord documenté'];const result=await rpc('client','cancel_award_item_atomic',args);assert.deepEqual(await rpc('client','cancel_award_item_atomic',args),result);
    await denied('client','cancel_award_item_atomic',[key,award.award_item_id,'financing',null],'22023');
    const row=(await db.query('select * from public.award_cancellations where award_item_id=$1',[award.award_item_id])).rows[0];assert.equal(row.actor_id,actors.client.id);assert.ok(row.created_at);assert.equal(row.comment,'Désaccord documenté');
    assert.equal((await rpc('competitor','publication_lot_availability',[f.pub])).find(x=>x.request_id===f.lots[0].id).accepts_offers,true);
    const next=await rpc('client','award_bid_item_atomic',[randomUUID(),f.b.items[0].id]);assert.notEqual(next.award_item_id,award.award_item_id);
    assert.deepEqual((await db.query('select active,agreed_millimes from public.award_items where id=$1',[award.award_item_id])).rows[0],{active:false,agreed_millimes:1001});
    for(const sql of ['delete from public.award_cancellations',"update public.award_cancellations set reason='financing'"])await assert.rejects(db.exec(sql),e=>e.code==='23514');
    await assert.rejects(db.query('update public.award_items set active=true where id=$1',[award.award_item_id]),e=>e.code==='23514');
  });
  const g=await fixture(),group=await rpc('pro','configure_bid_package',[g.a.version,true]);await rpc('pro','submit_bid_version',[g.a.version]);await rpc('competitor','submit_bid_version',[g.b.version]);
  await check('P2.1 indivisible packages are awarded, cancelled and reassigned together with safe replay',async()=>{
    await denied('client','award_bid_item_atomic',[randomUUID(),g.a.items[0].id],'23514');const key=randomUUID(),result=await rpc('client','award_bid_group_atomic',[key,group.group_id]);assert.equal(result.items.length,2);assert.deepEqual(await rpc('client','award_bid_group_atomic',[key,group.group_id]),result);
    await denied('client','award_bid_item_atomic',[key,g.a.items[0].id],'22023');const cancelled=await rpc('staff','cancel_award_item_atomic',[randomUUID(),result.items[0].award_item_id,'mutual_agreement',null]);assert.equal(cancelled.cancelled_item_ids.length,2);assert.equal((await rpc('pro','publication_lot_availability',[g.pub])).every(x=>x.accepts_offers),true);
    assert.equal((await rpc('client','award_bid_group_atomic',[randomUUID(),group.group_id])).items.length,2);await denied('pro','create_bid_draft',[g.pub],'23514');
  });
  const h=await fixture(),hg=await rpc('pro','configure_bid_package',[h.a.version,true]);await rpc('pro','submit_bid_version',[h.a.version]);await rpc('competitor','submit_bid_version',[h.b.version]);
  await check('P2.1 one conflicting lot rejects the whole package with no partial writes',async()=>{
    await rpc('client','award_bid_item_atomic',[randomUUID(),h.b.items[1].id]);await denied('client','award_bid_group_atomic',[randomUUID(),hg.group_id],'23514');assert.equal((await db.query('select count(*)::int as n from public.award_items where project_id=$1 and active',[h.project])).rows[0].n,1);assert.equal((await db.query('select status from public.project_requests where id=$1',[h.lots[0].id])).rows[0].status,'open');await denied('competitor','configure_bid_package',[h.a.version,true],'42501');
  });
  await check('P2.1 cancellation never enters the contractual domain or mutates memberships',async()=>{
    const row=(await db.query('select * from public.award_items where project_id=$1 and active',[h.project])).rows[0];const before=(await db.query('select count(*)::int as n from public.project_members where project_id=$1',[h.project])).rows[0].n;await insert('contracts',{project_id:h.project,award_id:row.award_id});await denied('client','cancel_award_item_atomic',[randomUUID(),row.id,'financing',null],'23514');assert.equal((await db.query('select count(*)::int as n from public.project_members where project_id=$1',[h.project])).rows[0].n,before);assert.equal((await db.query('select active from public.award_items where id=$1',[row.id])).rows[0].active,true);
  });
}
