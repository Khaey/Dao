import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

test('messaging: live memberships, idempotence, notifications and revocation',async()=>{
 const url=process.env.DAO_SUPABASE_URL!; assert.equal(url,'http://127.0.0.1:54321');
 const pub=process.env.DAO_SUPABASE_PUBLISHABLE_KEY!,secret=process.env.DAO_SUPABASE_SECRET_KEY!; const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}}); const password='M!sg-'+randomUUID();
 async function actor(label:string,roles:string[]){const email=`msg-${label}-${randomUUID()}@example.invalid`;const created=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ifError(created.error);const id=created.data.user!.id;assert.ifError((await admin.from('profiles').insert({user_id:id,display_name:label})).error);for(const role of roles)assert.ifError((await admin.from('user_roles').insert({user_id:id,role})).error);const auth=createClient(url,pub,{auth:{persistSession:false,autoRefreshToken:false}});const signed=await auth.auth.signInWithPassword({email,password});assert.ifError(signed.error);return{id,db:createClient(url,pub,{global:{headers:{Authorization:`Bearer ${signed.data.session!.access_token}`}},auth:{persistSession:false,autoRefreshToken:false}})};}
 const owner=await actor('Client',['client']),pro=await actor('Artisan',['contractor']),other=await actor('Concurrent',['contractor']),staff=await actor('Gestionnaire',['dao_reviewer']);
 const cp=await admin.from('contractor_profiles').insert({user_id:pro.id,business_name:'Atelier messages',verification_status:'verified',contractor_type:'artisan',public_identity_status:'approved'}).select('id').single();assert.ifError(cp.error);
 const otherCp=await admin.from('contractor_profiles').insert({user_id:other.id,business_name:'Concurrent',verification_status:'verified',contractor_type:'artisan',public_identity_status:'approved'}).select('id').single();assert.ifError(otherCp.error);
 const project=await admin.from('projects').insert({client_id:owner.id,initiator_id:owner.id,project_origin:'client_existing_team'}).select('id').single();assert.ifError(project.error);
 const gov=await admin.from('governorates').select('id').limit(1).single();assert.ifError(gov.error);assert.ifError((await admin.from('project_versions').insert({project_id:project.data!.id,version_no:1,title:'Chantier messages',description:'',governorate_id:gov.data!.id})).error);
 const member=await admin.from('project_members').insert({project_id:project.data!.id,user_id:pro.id,participation_role:'contractor'}).select('id').single();assert.ifError(member.error);
 const openArgs={p_project_id:project.data!.id,p_contractor_id:cp.data!.id};
 const opened=await owner.db.rpc('open_project_conversation',openArgs);assert.ifError(opened.error);const replay=await pro.db.rpc('open_project_conversation',openArgs);assert.ifError(replay.error);assert.equal(replay.data,opened.data);
 for(const db of [other.db,staff.db]){const denied=await db.rpc('open_project_conversation',openArgs);assert.ok(denied.error);assert.equal(denied.error.code,'42501');}
 const competitor=await other.db.rpc('open_project_conversation',{p_project_id:project.data!.id,p_contractor_id:otherCp.data!.id});assert.ok(competitor.error);
 const direct=await pro.db.from('messages').insert({conversation_id:opened.data,author_id:owner.id,body:'usurpation'});assert.ok(direct.error);
 const key=randomUUID(),sendArgs={p_conversation_id:opened.data,p_body:' Bonjour chantier ',p_idempotency_key:key};const sent=await owner.db.rpc('send_conversation_message',sendArgs);assert.ifError(sent.error);const sentAgain=await owner.db.rpc('send_conversation_message',sendArgs);assert.ifError(sentAgain.error);assert.equal(sentAgain.data.id,sent.data.id);
 const stored=await admin.from('messages').select('id,author_id,body').eq('conversation_id',opened.data);assert.ifError(stored.error);assert.deepEqual(stored.data,[{id:sent.data.id,author_id:owner.id,body:'Bonjour chantier'}]);
 const notification=await admin.from('notifications').select('user_id,kind,payload,read_at').eq('kind','project_message').eq('payload->>message_id',sent.data.id);assert.ifError(notification.error);assert.equal(notification.data!.length,1);assert.equal(notification.data![0].user_id,pro.id);assert.equal(notification.data![0].read_at,null);assert.equal(notification.data![0].payload.body,undefined);
 const visible=await pro.db.rpc('list_conversation_messages',{p_conversation_id:opened.data,p_before:null,p_limit:30});assert.ifError(visible.error);assert.equal(visible.data.length,1);const hidden=await other.db.rpc('list_conversation_messages',{p_conversation_id:opened.data,p_before:null,p_limit:30});assert.ok(hidden.error);
 const marked=await pro.db.rpc('mark_conversation_read',{p_conversation_id:opened.data});assert.ifError(marked.error);assert.equal(marked.data,1);
 const tooLong=await owner.db.rpc('send_conversation_message',{p_conversation_id:opened.data,p_body:'x'.repeat(4001),p_idempotency_key:randomUUID()});assert.ok(tooLong.error);assert.equal(tooLong.error.code,'22023');
 assert.ok((await admin.from('messages').update({body:'changed'}).eq('id',sent.data.id)).error);assert.ok((await admin.from('messages').delete().eq('id',sent.data.id)).error);
 assert.ifError((await admin.from('project_members').update({status:'revoked',revoked_at:new Date().toISOString()}).eq('id',member.data!.id)).error);
 for(const db of [owner.db,pro.db]){const revoked=await db.rpc('list_conversation_messages',{p_conversation_id:opened.data,p_before:null,p_limit:30});assert.ok(revoked.error);assert.equal(revoked.error.code,'42501');const rows=await db.from('conversations').select('id').eq('id',opened.data);assert.ifError(rows.error);assert.deepEqual(rows.data,[]);}
});
