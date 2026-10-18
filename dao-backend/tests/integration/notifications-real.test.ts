import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

test('notifications S1: real JWT, live roles, concurrent reads and confirmed events', async t => {
  const url=process.env.DAO_SUPABASE_URL!;assert.equal(url,'http://127.0.0.1:54321','Disposable local stack only');
  const key=process.env.DAO_SUPABASE_PUBLISHABLE_KEY!,secret=process.env.DAO_SUPABASE_SECRET_KEY!;assert.ok(key);assert.ok(secret);
  const options={auth:{persistSession:false,autoRefreshToken:false}};
  const admin=createClient(url,secret,options),anon=createClient(url,key,options);
  const actors:Record<string,any>={};
  async function insert(table:string,input:any){const r=await admin.from(table).insert(input).select('*').single();assert.ifError(r.error);return r.data!;}
  async function rpc(db:any,name:string,args:any={}){const r=await db.rpc(name,args);assert.ifError(r.error);return r.data;}
  async function denied(db:any,name:string,args:any={}){const r=await db.rpc(name,args);assert.ok(r.error,`${name} must deny access`);}
  for(const [name,role] of Object.entries({client:'client',other:'client',pro:'contractor',staff:'dao_reviewer'})) {
    const email=`notices-${name}-${randomUUID()}@example.invalid`,password='N!'+randomUUID();
    const user=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ifError(user.error);
    const auth=createClient(url,key,options);const login=await auth.auth.signInWithPassword({email,password});assert.ifError(login.error);
    const db=createClient(url,key,{...options,global:{headers:{Authorization:'Bearer '+login.data.session!.access_token}}});
    actors[name]={id:user.data.user!.id,email,db};await insert('profiles',{user_id:actors[name].id,display_name:'Synthetic '+name});
    await insert('user_roles',{user_id:actors[name].id,role});
  }
  const {client,other,pro,staff}=actors;
  const cp=await insert('contractor_profiles',{user_id:pro.id,business_name:'Synthetic notices',verification_status:'verified'});
  const gov=(await admin.from('governorates').select('id').eq('code','E2E_TEST').single()).data!.id;
  const trade=(await admin.from('trades').select('id').eq('code','plumbing').single()).data!.id;
  const page=(db:any,args:any={})=>rpc(db,'my_notifications',args);
  let project:any,version:any;
  await t.test('empty Client/Artisan/staff, anon, invalid JWT and no direct writes/outbox',async()=>{
    for(const a of [client,pro,staff]){const p=await page(a.db);assert.deepEqual(p.rows,[]);assert.equal(p.unread_count,0);}
    await denied(anon,'my_notifications');await denied(anon,'my_unread_notification_count');await denied(anon,'mark_my_notification_read',{p_id:randomUUID()});
    const invalid=createClient(url,key,{...options,global:{headers:{Authorization:'Bearer forged.jwt.invalid'}}});await denied(invalid,'my_notifications');
    for(const db of [client.db,pro.db,staff.db]) {
      assert.ok((await db.from('notification_outbox').select('*')).error);
      assert.ok((await db.from('notifications').insert({user_id:client.id,kind:'review_approved'})).error);
      assert.ok((await db.from('notifications').update({read_at:new Date().toISOString()}).eq('user_id',client.id)).error);
      assert.ok((await db.from('notifications').delete().eq('user_id',client.id)).error);
    }
    for(const args of [{p_limit:0},{p_limit:51},{p_before:'2026-10-18T00:00:00Z',p_before_id:null}])await denied(client.db,'my_notifications',args);
  });
  await t.test('real rejected review produces exactly one minimal notice, failed command produces none',async()=>{
    project=await insert('projects',{client_id:client.id});
    version=await insert('project_versions',{project_id:project.id,version_no:1,title:'PRIVATE TITLE',description:'PRIVATE',governorate_id:gov,status:'client_review'});
    const args={p_project_id:project.id,p_approve:false,p_comment:'PRIVATE refusal reason'};
    await rpc(staff.db,'review_project',args);await denied(staff.db,'review_project',args);
    const p=await page(client.db);assert.equal(p.rows.length,1);assert.equal(p.rows[0].kind,'review_rejected');assert.equal(p.unread_count,1);
    assert.equal(p.rows[0].target_id,project.id);assert.ok(!JSON.stringify(p).includes('PRIVATE'));
    const stored=await admin.from('notifications').select('payload').eq('user_id',client.id);assert.ifError(stored.error);
    assert.deepEqual(Object.keys(stored.data![0].payload).sort(),['project_id','version_id','workspace']);
    assert.deepEqual((await page(other.db)).rows,[]);assert.deepEqual((await page(staff.db)).rows,[]);
    assert.deepEqual((await other.db.from('notifications').select('id').eq('id',p.rows[0].id)).data,[]);
  });
  await t.test('real composite keyset pagination covers 100+ equal timestamps without overlap',async()=>{
    const rows=Array.from({length:105},(_,i)=>({user_id:client.id,kind:'review_rejected',event_key:`fixture:${i}`,created_at:'2026-10-18T00:00:00.123456Z',
      payload:{project_id:project.id,version_id:version.id,workspace:'client'}}));
    assert.ifError((await admin.from('notifications').insert(rows)).error);
    const ids=new Set<string>();let cursor:any=null;
    do {const p=await page(client.db,{p_limit:20,p_before:cursor?.created_at??null,p_before_id:cursor?.id??null});
      assert.equal(p.unread_count,106);for(const row of p.rows){assert.ok(!ids.has(row.id));ids.add(row.id);}
      cursor=p.has_more?p.rows.at(-1):null;
    }while(cursor);
    assert.equal(ids.size,106);assert.equal(await rpc(client.db,'my_unread_notification_count'),106);
    assert.ok((await admin.from('notifications').insert(rows.slice(0,1))).error,'stable event key must reject duplicate delivery');
  });
  await t.test('foreign/unknown mark is uniform; concurrent/idempotent reads preserve first timestamp',async()=>{
    const item=(await page(client.db)).rows[0];
    const foreign=await rpc(other.db,'mark_my_notification_read',{p_id:item.id});
    assert.equal(await rpc(other.db,'mark_my_notification_read',{p_id:randomUUID()}),foreign);
    assert.equal(await rpc(client.db,'my_unread_notification_count'),106);
    await Promise.all([1,2].map(()=>rpc(client.db,'mark_my_notification_read',{p_id:item.id})));
    const read=(await admin.from('notifications').select('read_at').eq('id',item.id).single()).data!.read_at;assert.ok(read);
    await rpc(client.db,'mark_my_notification_read',{p_id:item.id});
    assert.equal((await admin.from('notifications').select('read_at').eq('id',item.id).single()).data!.read_at,read);
    assert.equal(await rpc(client.db,'my_unread_notification_count'),105);
    assert.ok((await page(client.db,{p_unread:true})).rows.every((r:any)=>r.read_at===null));
  });
  let collaboration:any,invitation:any;
  await t.test('confirmed invitation, acceptance and private messaging use existing actor commands',async()=>{
    collaboration=await rpc(client.db,'create_client_existing_team_project',{p_title:'Synthetic notices team',p_description:'',p_governorate_id:gov,
      p_delegation_id:null,p_locality_id:null,p_stage:'not_started',p_payment_status:'not_set',
      p_team:[{recipient_name:'Synthetic pro',recipient_email:pro.email,trade_id:trade,lot_title:'Synthetic lot',budget_millimes:null,can_view_private_details:false}]});
    invitation=collaboration.invitations[0];
    assert.equal((await page(pro.db)).rows.filter((r:any)=>r.kind==='invitation_received').length,1);
    await rpc(pro.db,'respond_my_project_invitation',{p_invitation_id:invitation.id,p_accept:true});
    await denied(pro.db,'respond_my_project_invitation',{p_invitation_id:invitation.id,p_accept:true});
    assert.equal((await page(pro.db)).rows.filter((r:any)=>r.kind==='invitation_received').length,0);
    assert.equal((await page(client.db)).rows.filter((r:any)=>r.kind==='invitation_accepted').length,1);
    const conversation=await rpc(client.db,'open_project_conversation',{p_project_id:collaboration.id,p_contractor_id:cp.id});
    const args={p_conversation_id:conversation,p_body:'PRIVATE MESSAGE',p_idempotency_key:randomUUID()};
    await rpc(client.db,'send_conversation_message',args);await rpc(client.db,'send_conversation_message',args);
    const p=await page(pro.db);assert.equal(p.rows.filter((r:any)=>r.kind==='project_message').length,1);assert.ok(!JSON.stringify(p).includes('PRIVATE'));
    assert.equal(p.rows[0].target_id,conversation);
    await denied(other.db,'list_conversation_messages',{p_conversation_id:conversation});
    await denied(staff.db,'list_conversation_messages',{p_conversation_id:conversation});
    await rpc(pro.db,'mark_conversation_read',{p_conversation_id:conversation});assert.equal(await rpc(pro.db,'my_unread_notification_count'),0);
    const member=(await admin.from('project_members').select('id').eq('project_id',collaboration.id).eq('user_id',pro.id).single()).data!;
    await rpc(client.db,'update_project_member',{p_member_id:member.id,p_revoke:true,p_can_view_private_details:false});
    assert.deepEqual((await page(pro.db)).rows,[]);
    assert.equal((await page(client.db)).rows.filter((r:any)=>r.kind==='invitation_accepted').length,0);
    assert.deepEqual((await pro.db.from('notifications').select('id')).data,[]);
  });
  await t.test('failed atomic team creation leaves neither project nor notification',async()=>{
    const before=await rpc(pro.db,'my_unread_notification_count');
    const projectsBefore=await admin.from('projects').select('id',{count:'exact',head:true}).eq('initiator_id',client.id);assert.ifError(projectsBefore.error);
    const bad=await client.db.rpc('create_client_existing_team_project',{p_title:'Rollback notices',p_description:'',p_governorate_id:gov,
      p_delegation_id:null,p_locality_id:null,p_stage:'not_started',p_payment_status:'not_set',
      p_team:[{recipient_email:pro.email,trade_id:trade,lot_title:'First'},{recipient_email:pro.email,trade_id:trade,lot_title:'Duplicate'}]});
    assert.ok(bad.error);assert.equal(await rpc(pro.db,'my_unread_notification_count'),before);
    const projectsAfter=await admin.from('projects').select('id',{count:'exact',head:true}).eq('initiator_id',client.id);assert.ifError(projectsAfter.error);
    assert.equal(projectsAfter.count,projectsBefore.count);
  });
  await t.test('pending invitation expires/revokes live and suspended recipients receive no new row',async()=>{
    async function pending(){
      const p=await rpc(pro.db,'create_collaborative_project',{p_origin:'contractor_existing_client',p_title:'Synthetic pending',p_description:'',
        p_governorate_id:gov,p_delegation_id:null,p_locality_id:null,p_stage:'not_started',p_payment_status:'not_set'});
      const i=await rpc(pro.db,'issue_project_invitation',{p_project_id:p.id,p_expected_role:'client',p_recipient_email:other.email,
        p_recipient_name:null,p_principal_request_id:null,p_can_view_private_details:false});return {p,i};
    }
    const one=await pending();assert.equal((await page(other.db)).rows.length,1);
    await rpc(pro.db,'revoke_project_invitation',{p_invitation_id:one.i.id});assert.deepEqual((await page(other.db)).rows,[]);
    const two=await pending();assert.equal((await page(other.db)).rows.length,1);
    const record=(await admin.from('project_invitations').select('created_at').eq('id',two.i.id).single()).data!;
    // An explicit old timestamp is fixture-only; product RPCs never accept it.
    assert.ifError((await admin.from('project_invitations').update({created_at:'2026-01-01T00:00:00Z',expires_at:'2026-01-02T00:00:00Z'}).eq('id',two.i.id)).error);
    assert.ok(record.created_at);assert.deepEqual((await page(other.db)).rows,[]);
    await insert('account_states',{user_id:other.id,status:'suspended'});
    const before=await admin.from('notifications').select('id',{count:'exact',head:true}).eq('user_id',other.id);assert.ifError(before.error);
    await pending();const after=await admin.from('notifications').select('id',{count:'exact',head:true}).eq('user_id',other.id);assert.ifError(after.error);assert.equal(after.count,before.count);
  });
  await t.test('dual role changes workspace; suspension/current role removal and archive fail closed',async()=>{
    await insert('user_roles',{user_id:client.id,role:'contractor'});
    await rpc(client.db,'set_my_workspace',{p_workspace:'contractor'});assert.deepEqual((await page(client.db)).rows,[]);
    await rpc(client.db,'set_my_workspace',{p_workspace:'client'});assert.equal((await page(client.db)).rows.length,20);
    await insert('account_states',{user_id:client.id,status:'suspended'});
    await denied(client.db,'my_notifications');await denied(client.db,'my_unread_notification_count');await denied(client.db,'mark_my_notification_read',{p_id:randomUUID()});
    assert.deepEqual((await client.db.from('notifications').select('id')).data,[]);
    assert.ifError((await admin.from('account_states').update({status:'active'}).eq('user_id',client.id)).error);
    assert.ifError((await admin.from('user_roles').delete().eq('user_id',client.id).eq('role','client')).error);
    assert.deepEqual((await page(client.db)).rows,[]);
    await insert('user_roles',{user_id:client.id,role:'client'});
    assert.ifError((await admin.from('projects').update({status:'archived'}).eq('id',project.id)).error);
    assert.deepEqual((await page(client.db)).rows,[]);
  });
  await t.test('previous JWT from deleted bare Auth identity is refused',async()=>{
    const email=`notices-deleted-${randomUUID()}@example.invalid`,password='N!'+randomUUID();
    const user=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ifError(user.error);
    const auth=createClient(url,key,options);const login=await auth.auth.signInWithPassword({email,password});assert.ifError(login.error);
    const old=createClient(url,key,{...options,global:{headers:{Authorization:'Bearer '+login.data.session!.access_token}}});
    assert.ifError((await admin.auth.admin.deleteUser(user.data.user!.id)).error);
    await denied(old,'my_notifications');
  });
});
