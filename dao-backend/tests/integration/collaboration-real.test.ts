import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { DocumentService } from '../../src/services/DocumentService.js';

test('collaboration: real Auth/JWT, atomic confirmation and RLS/Storage boundaries', async t => {
  const url=process.env.DAO_SUPABASE_URL;
  assert.equal(url,'http://127.0.0.1:54321','collaboration integration requires disposable local Supabase');
  const key=process.env.DAO_SUPABASE_PUBLISHABLE_KEY!,secret=process.env.DAO_SUPABASE_SECRET_KEY!;
  assert.ok(key);assert.ok(secret);
  const admin=createClient(url!,secret,{auth:{persistSession:false,autoRefreshToken:false}});
  const suffix=randomUUID();
  const password='D!ao-'+randomUUID();
  async function command(db:any,name:string,args:Record<string,unknown>) {
    const result=await db.rpc(name,args);
    if(result.error) throw new Error(`${name}: ${result.error.code} ${result.error.message}`);
    return result.data;
  }
  async function denied(db:any,name:string,args:Record<string,unknown>,code?:string) {
    const result=await db.rpc(name,args);assert.ok(result.error,'RPC must deny the operation');
    if(code) assert.equal(result.error.code,code);
  }
  async function actor(label:string,role:'client'|'contractor') {
    const email=`collab-${label}-${suffix}@example.invalid`;
    const created=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ifError(created.error);
    const session=createClient(url!,key,{auth:{persistSession:false,autoRefreshToken:false}});
    const signed=await session.auth.signInWithPassword({email,password});assert.ifError(signed.error);
    const db=createClient(url!,key,{global:{headers:{Authorization:'Bearer '+signed.data.session!.access_token}},auth:{persistSession:false,autoRefreshToken:false}});
    await command(db,'initialize_my_account',{p_display_name:label,p_phone_e164:null,p_account_type:role,p_business_name:role==='contractor'?'Atelier '+label:null});
    return {id:created.data.user!.id,email,db};
  }
  const client=await actor('client','client'),other=await actor('other','client');
  const pro=await actor('initiator','contractor'),member=await actor('member','contractor');
  const governorate=await admin.from('governorates').select('id').eq('code','E2E_TEST').single();assert.ifError(governorate.error);
  const trade=await admin.from('trades').select('id').eq('code','plumbing').single();assert.ifError(trade.error);
  await t.test('client existing team creates multiple artisans, principal lots and invitations atomically', async () => {
    const before = await admin.from('projects').select('id', { count: 'exact', head: true });
    assert.ifError(before.error);
    const created = await command(client.db, 'create_client_existing_team_project', {
      p_title: 'Équipe existante multi-artisans',
      p_description: 'Création atomique',
      p_governorate_id: governorate.data!.id,
      p_delegation_id: null,
      p_locality_id: null,
      p_stage: 'in_progress',
      p_payment_status: 'partial',
      p_team: [
        { recipient_name: 'Plombier fixture', recipient_email: `plombier-${suffix}@example.invalid`, trade_id: trade.data!.id, lot_title: 'Plomberie principale', budget_millimes: 2500000, can_view_private_details: false },
        { recipient_name: 'Électricien fixture', recipient_email: `electricien-${suffix}@example.invalid`, trade_id: trade.data!.id, lot_title: 'Électricité principale', budget_millimes: 1800000, can_view_private_details: true },
      ],
    });
    assert.ok(created.id);
    assert.equal(created.invitations.length, 2);
    const lots = await admin.from('project_requests').select('id,contractor_member_id').eq('project_id', created.id).order('id');
    assert.ifError(lots.error); assert.equal(lots.data!.length, 2);
    assert.equal(lots.data!.every(row => row.contractor_member_id === null), true);
    const invites = await admin.from('project_invitations').select('id,principal_request_id,recipient_email,status').eq('project_id', created.id).order('id');
    assert.ifError(invites.error); assert.equal(invites.data!.length, 2);
    assert.equal(invites.data!.every(row => row.status === 'pending' && lots.data!.some(lot => lot.id === row.principal_request_id)), true);
    const linked = new Set(created.invitations.map((value:any) => value.request_id));
    assert.equal(linked.size, 2);
    assert.equal(lots.data!.every(lot => linked.has(lot.id)), true);

    const failed = await client.db.rpc('create_client_existing_team_project', {
      p_title: 'Équipe invalide',
      p_description: '',
      p_governorate_id: governorate.data!.id,
      p_delegation_id: null,
      p_locality_id: null,
      p_stage: 'not_started',
      p_payment_status: 'not_set',
      p_team: [
        { recipient_name: 'A', recipient_email: `duplicate-${suffix}@example.invalid`, trade_id: trade.data!.id, lot_title: 'Lot A', budget_millimes: null },
        { recipient_name: 'B', recipient_email: `duplicate-${suffix}@example.invalid`, trade_id: trade.data!.id, lot_title: 'Lot B', budget_millimes: null },
      ],
    });
    assert.ok(failed.error, 'duplicate artisan emails must reject the whole atomic command');
    const after = await admin.from('projects').select('id', { count: 'exact', head: true });
    assert.ifError(after.error);
    assert.equal(after.count, (before.count ?? 0) + 1, 'failed batch must not leave a partial project');
  });

  const create=(db:any,origin:string)=>command(db,'create_collaborative_project',{
    p_origin:origin,p_title:'Chantier réel JWT',p_description:'Description publique sûre',
    p_governorate_id:governorate.data!.id,p_delegation_id:null,p_locality_id:null,
    p_stage:'in_progress',p_payment_status:'partial',
  });
  const invite=(db:any,projectId:string,role:string,email:string|null=null,requestId:string|null=null)=>command(db,'issue_project_invitation',{
    p_project_id:projectId,p_expected_role:role,p_recipient_email:email,p_recipient_name:null,p_principal_request_id:requestId,p_can_view_private_details:false,
  });
  const project=await create(pro.db,'contractor_existing_client');
  const versionBefore=await admin.from('project_versions').select('id,status,version_no').eq('project_id',project.id).single();assert.ifError(versionBefore.error);
  const invitation=await invite(pro.db,project.id,'client');
  await t.test('contractor pending does not become verified or acquire a client role',async()=> {
    const profile=await admin.from('contractor_profiles').select('verification_status').eq('user_id',pro.id).single();assert.ifError(profile.error);
    assert.equal(profile.data!.verification_status,'pending');assert.equal(project.client_id,null);
    const roles=await admin.from('user_roles').select('role').eq('user_id',pro.id);assert.ifError(roles.error);
    assert.deepEqual(roles.data!.map(r=>r.role),['contractor']);
    await denied(pro.db,'create_project_draft',{p_project_type:'other',p_surface_m2:null,p_desired_start_date:null,p_indicative_budget_millimes:null,p_governorate_id:governorate.data!.id,p_delegation_id:null,p_locality_id:null},'42501');
    await denied(pro.db,'create_collaborative_project',{p_origin:'client_existing_team',p_title:'Wrong role',p_description:'',p_governorate_id:governorate.data!.id,p_delegation_id:null,p_locality_id:null,p_stage:'not_started',p_payment_status:'not_set'},'42501');
  });
  await t.test('global role cannot be forged through an invitation',async()=> {
    for(const role of ['dao_admin','dao_reviewer','internal']) await denied(pro.db,'issue_project_invitation',{
      p_project_id:project.id,p_expected_role:role,p_recipient_email:null,p_can_view_private_details:false,
    },'22023');
    await denied(pro.db,'respond_project_invitation',{p_token:invitation.token,p_accept:true},'42501');
    const hash=await pro.db.from('project_invitations').select('token_hash').eq('id',invitation.id);
    assert.ok(hash.error,'public API must never expose the stored token hash');
  });
  await t.test('two independent clients race to confirm: exactly one succeeds',async()=> {
    const results=await Promise.all([
      client.db.rpc('respond_project_invitation',{p_token:invitation.token,p_accept:true}),
      other.db.rpc('respond_project_invitation',{p_token:invitation.token,p_accept:true}),
    ]);
    assert.equal(results.filter(r=>!r.error).length,1);assert.equal(results.filter(r=>r.error).length,1);
    const row=await admin.from('projects').select('client_id,initiator_id,confirmed_at,confirmed_by,status').eq('id',project.id).single();assert.ifError(row.error);
    assert.ok([client.id,other.id].includes(row.data!.client_id));assert.equal(row.data!.confirmed_by,row.data!.client_id);
    assert.equal(row.data!.initiator_id,pro.id);assert.ok(row.data!.confirmed_at);assert.equal(row.data!.status,'draft');
    const members=await admin.from('project_members').select('user_id,participation_role').eq('project_id',project.id).eq('status','accepted');assert.ifError(members.error);
    assert.equal(members.data!.length,2);assert.equal(members.data!.filter(m=>m.participation_role==='client').length,1);
    const versionAfter=await admin.from('project_versions').select('id,status,version_no').eq('project_id',project.id).single();assert.ifError(versionAfter.error);
    assert.deepEqual(versionAfter.data,versionBefore.data);
    await denied(client.db,'respond_project_invitation',{p_token:invitation.token,p_accept:true},'23514');
  });
  const confirmed=await admin.from('projects').select('client_id').eq('id',project.id).single();assert.ifError(confirmed.error);
  const owner=confirmed.data!.client_id===client.id?client:other;
  const unrelated=owner.id===client.id?other:client;
  const lot=await command(owner.db,'add_project_request',{p_project_id:project.id,p_trade_id:trade.data!.id,p_title:'Lot partagé',p_scope:'Scope explicite',p_budget_millimes:1000});
  const memberInvite=await invite(owner.db,project.id,'contractor',member.email,lot.id);
  await command(member.db,'respond_project_invitation',{p_token:memberInvite.token,p_accept:true});
  const membership=await admin.from('project_members').select('id').eq('project_id',project.id).eq('user_id',member.id).single();assert.ifError(membership.error);
  const principalAssignment=await admin.from('project_requests').select('contractor_member_id').eq('id',lot.id).single();assert.ifError(principalAssignment.error);assert.equal(principalAssignment.data!.contractor_member_id,membership.data!.id);
  await t.test('invited contractor can read shared workspace but cannot edit or submit',async()=> {
    const read=await member.db.from('projects').select('id').eq('id',project.id);assert.ifError(read.error);assert.equal(read.data!.length,1);
    const otherRead=await unrelated.db.from('projects').select('id').eq('id',project.id);assert.ifError(otherRead.error);assert.equal(otherRead.data!.length,0);
    await denied(member.db,'add_project_request',{p_project_id:project.id,p_trade_id:trade.data!.id,p_title:'Forbidden',p_scope:'Scope',p_budget_millimes:null},'42501');
    await denied(member.db,'submit_project_for_review',{p_project_id:project.id},'42501');
    await denied(pro.db,'submit_project_for_review',{p_project_id:project.id},'42501');
    const write=await member.db.from('project_members').update({can_view_private_details:true}).eq('id',membership.data!.id);assert.ok(write.error);
    await denied(member.db,'update_project_member',{p_member_id:membership.data!.id,p_revoke:false,p_can_view_private_details:true},'42501');
  });
  const privateDetails=await command(pro.db,'upsert_project_private_details',{p_project_id:project.id,p_exact_address:'Fixture privée',p_access_instructions:null,p_contact_phone:null,p_contact_email:null});
  await t.test('private details require explicit client permission',async()=> {
    const hidden=await member.db.from('project_private_details').select('id').eq('id',privateDetails.id);assert.ifError(hidden.error);assert.equal(hidden.data!.length,0);
    await command(owner.db,'update_project_member',{p_member_id:membership.data!.id,p_revoke:false,p_can_view_private_details:true});
    const visible=await member.db.from('project_private_details').select('id').eq('id',privateDetails.id);assert.ifError(visible.error);assert.equal(visible.data!.length,1);
    await denied(member.db,'upsert_project_private_details',{p_project_id:project.id,p_exact_address:'Forbidden',p_access_instructions:null,p_contact_phone:null,p_contact_email:null},'42501');
  });
  const path=`project/${project.id}/${randomUUID()}.pdf`;
  const doc=await command(owner.db,'create_project_document',{p_project_id:project.id,p_object_path:path,p_original_name:'fixture.pdf',p_mime_type:'application/pdf',p_size_bytes:4});
  const upload=await admin.storage.from('dao-private').upload(path,Buffer.from('test'),{contentType:'application/pdf'});assert.ifError(upload.error);
  const storage=admin.storage;
  await t.test('owner_only, shared approval and signed-download authorization',async()=> {
    await assert.rejects(new DocumentService(member.db,storage).signedProjectDownload(doc.id),e=>(e as any).code==='FORBIDDEN');
    await command(owner.db,'set_project_document_sharing',{p_document_id:doc.id,p_share_scope:'project_members'});
    await assert.rejects(new DocumentService(member.db,storage).signedProjectDownload(doc.id),e=>(e as any).code==='FORBIDDEN');
    const approve=await admin.from('documents').update({status:'approved'}).eq('id',doc.id);assert.ifError(approve.error);
    assert.ok(await new DocumentService(member.db,storage).signedProjectDownload(doc.id));
    await assert.rejects(new DocumentService(unrelated.db,storage).signedProjectDownload(doc.id),e=>(e as any).code==='FORBIDDEN');
  });
  await t.test('membership gives neither competitor bids nor invite_only access',async()=> {
    const proProfile=await admin.from('contractor_profiles').select('id').eq('user_id',pro.id).single();assert.ifError(proProfile.error);
    const bid=await admin.from('bids').insert({project_id:project.id,contractor_id:proProfile.data!.id}).select('id').single();assert.ifError(bid.error);
    const bv=await admin.from('bid_versions').insert({bid_id:bid.data!.id,project_id:project.id,contractor_id:proProfile.data!.id,version_no:1,expires_at:'2099-01-01',status:'submitted',submitted_at:new Date().toISOString()}).select('id').single();assert.ifError(bv.error);
    for(const [table,id] of [['bids',bid.data!.id],['bid_versions',bv.data!.id]]) {
      const rows=await member.db.from(table).select('id').eq('id',id);assert.ifError(rows.error);assert.equal(rows.data!.length,0);
    }
    const verify=await admin.from('contractor_profiles').update({verification_status:'verified'}).eq('user_id',member.id);assert.ifError(verify.error);
    const pub=await admin.from('publications').insert({project_id:project.id,project_version_id:versionBefore.data!.id,visibility:'invite_only',safe_title:'DAO sur invitation',safe_description:'Safe',governorate_id:governorate.data!.id}).select('id').single();assert.ifError(pub.error);
    const read=await member.db.from('publications').select('id').eq('id',pub.data!.id);assert.ifError(read.error);assert.equal(read.data!.length,0);
  });
  await t.test('revocation removes signed-file and private/workspace permission immediately',async()=> {
    await command(owner.db,'assign_project_request_member',{p_request_id:lot.id,p_member_id:membership.data!.id});
    await command(owner.db,'update_project_member',{p_member_id:membership.data!.id,p_revoke:true,p_can_view_private_details:null});
    const read=await member.db.from('projects').select('id').eq('id',project.id);assert.ifError(read.error);assert.equal(read.data!.length,0);
    const privateRead=await member.db.from('project_private_details').select('id').eq('id',privateDetails.id);assert.ifError(privateRead.error);assert.equal(privateRead.data!.length,0);
    await assert.rejects(new DocumentService(member.db,storage).signedProjectDownload(doc.id),e=>(e as any).code==='FORBIDDEN');
    const assigned=await admin.from('project_requests').select('contractor_member_id,status').eq('id',lot.id).single();assert.ifError(assigned.error);
    assert.equal(assigned.data!.contractor_member_id,null);assert.equal(assigned.data!.status,'open');
  });
  await t.test('revoked, expired, declined and wrong-email invitation lifecycle',async()=> {
    const pending=await create(pro.db,'contractor_existing_client');
    const wrongEmail=await invite(pro.db,pending.id,'client',owner.email);
    await denied(unrelated.db,'respond_project_invitation',{p_token:wrongEmail.token,p_accept:true},'42501');
    await command(pro.db,'revoke_project_invitation',{p_invitation_id:wrongEmail.id});
    assert.equal(await command(createClient(url!,key),'preview_project_invitation',{p_token:wrongEmail.token}),null);
    await denied(owner.db,'respond_project_invitation',{p_token:wrongEmail.token,p_accept:true},'23514');
    const expired=await invite(pro.db,pending.id,'client');
    const change=await admin.from('project_invitations').update({created_at:'2026-01-01T00:00:00Z',expires_at:'2026-01-02T00:00:00Z'}).eq('id',expired.id);assert.ifError(change.error);
    await denied(owner.db,'respond_project_invitation',{p_token:expired.token,p_accept:true},'23514');
    const decline=await invite(pro.db,pending.id,'client');
    await command(owner.db,'respond_project_invitation',{p_token:decline.token,p_accept:false});
    const p=await admin.from('projects').select('client_id').eq('id',pending.id).single();assert.ifError(p.error);assert.equal(p.data!.client_id,null);
  });
});
