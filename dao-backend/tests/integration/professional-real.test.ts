import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createProfessionalHandler } from '../../src/server/professionalHandler.js';

test('PRO real JWT, private Storage, moderation, consent and revocation',async t=>{
  const url=process.env.DAO_SUPABASE_URL!,key=process.env.DAO_SUPABASE_PUBLISHABLE_KEY!,secret=process.env.DAO_SUPABASE_SECRET_KEY!;
  assert.equal(url,'http://127.0.0.1:54321','Only disposable Supabase is authorized');assert.ok(key);assert.ok(secret);
  const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}}),users:any={};
  const roles={pro:'contractor',other:'contractor',client:'client',reviewer:'dao_reviewer',reviewer2:'dao_reviewer',admin:'dao_admin'};
  async function insert(table:string,input:any){const r=await admin.from(table).insert(input).select('*').single();assert.ifError(r.error);return r.data;}
  async function rpc(name:string,fn:string,input:any){const r=await users[name].db.rpc(fn,input);assert.ifError(r.error);return r.data;}
  const cmd=(name:string,action:string,input:any)=>rpc(name,'professional_command',{p_action:action,p_input:input});
  for(const [name,role] of Object.entries(roles)) {
    const email=`pro112-${name}-${randomUUID()}@example.invalid`,password='Pro112!'+randomUUID();
    const created=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ifError(created.error);
    const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});const signed=await db.auth.signInWithPassword({email,password});assert.ifError(signed.error);
    users[name]={id:created.data.user!.id,db,token:signed.data.session!.access_token};
    await insert('profiles',{user_id:users[name].id,display_name:`PRO ${name}`});await insert('user_roles',{user_id:users[name].id,role});
  }
  const cp=await insert('contractor_profiles',{user_id:users.pro.id,business_name:'PRO société',contractor_type:'company',public_trade_name:'PRO client',public_presentation:'Travaux déclarés',verification_status:'verified'});
  const trades=(await admin.from('trades').select('id').eq('active',true).limit(2)).data!;assert.equal(trades.length,2);
  for(const tr of trades)await insert('contractor_trades',{contractor_id:cp.id,trade_id:tr.id});
  async function dossier(){return rpc('pro','professional_dossier',{p_id:cp.id});}
  async function publish(){await cmd('pro','profile_submit',{});await cmd('admin','review_profile',{id:cp.id,approve:true,revision:(await dossier()).details.revision});}
  const publicProfile=()=>rpc('client','professional_public_profile',{p_id:cp.id,p_preview:false});
  async function api(name:string,action:string,input:any){
    const handler=createProfessionalHandler(users[name].db,async(header)=>{
      const scoped=createClient(url,key,{global:{headers:{Authorization:header||''}},auth:{persistSession:false,autoRefreshToken:false}});
      const r=await scoped.auth.getUser();return r.error?null:r.data.user;
    },()=>admin);
    return handler(new Request('http://dao.local/api/professionals',{method:'POST',headers:{Authorization:'Bearer '+users[name].token,'Content-Type':'application/json'},body:JSON.stringify({action,input})}));
  }
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
  async function upload(input:any,bytes:Buffer){const prepared=await api('pro','prepare_upload',{...input,original_name:input.original_name||'photo.png',size_bytes:bytes.length});assert.equal(prepared.status,200);const data=(await prepared.json()).data;const uploaded=await users.pro.db.storage.from('dao-private').uploadToSignedUrl(data.path,data.token,bytes,{contentType:input.mime_type,upsert:false});assert.ifError(uploaded.error);return data;}
  let project:any,photo:any,brochure:any,legal:any;
  await t.test('private fiscal identity, optional RNE, explicit consent and multitrade profile',async()=>{
    await cmd('pro','details',{legal_name:'PRIVATE LEGAL NAME',tax_identifier:'PRIVATE TAX',registration_identifier:'',professional_email:'contact@example.invalid',professional_phone:'+21620000003',office_address:'PRIVATE ADDRESS',city:'Tunis',website_url:'https://example.com',show_phone:false});
    const d=await dossier();assert.equal(d.details.registration_identifier,'');assert.equal(d.profile.verification_status,'pending');
    assert.ifError((await users.reviewer.db.rpc('backoffice_command',{p_action:'professional',p_input:{contractor_id:cp.id,decision:'verify'},p_key:randomUUID()})).error);
    await publish();const view=await publicProfile();assert.equal(view.trades.length,2);assert.equal(view.professional_email,null);assert.equal(view.office_address,null);assert.equal(JSON.stringify(view).includes('PRIVATE'),false);
    assert.equal((await users.client.db.from('contractor_profile_details').select('*').eq('contractor_id',cp.id)).data!.length,0);
    assert.equal((await users.other.db.rpc('professional_dossier',{p_id:cp.id})).error!.code,'42501');
    assert.equal((await users.pro.db.from('contractor_profile_details').update({review_status:'approved'}).eq('contractor_id',cp.id)).error!.code,'42501');
  });
  await t.test('web/contact edits moderate content without re-verifying; invalid URLs denied',async()=>{
    assert.ok((await users.pro.db.rpc('professional_command',{p_action:'details',p_input:{website_url:'javascript:alert(1)'}})).error);
    await cmd('pro','details',{show_phone:true});assert.equal((await dossier()).profile.verification_status,'verified');assert.ok((await users.client.db.rpc('professional_public_profile',{p_id:cp.id})).error);
    await publish();assert.equal((await publicProfile()).professional_phone,'+21620000003');
    const anon=createClient(url,key,{auth:{persistSession:false}});assert.ok((await anon.rpc('professional_dossier',{p_id:cp.id})).error);
  });
  await t.test('real signed upload, server byte inspection, no direct Storage, revision race',async()=>{
    project=await cmd('pro','portfolio_save',{title:'Projet PRO',description:'Réalisé',trade_id:trades[0].id,publication_consent:true});
    photo=await upload({kind:'portfolio',portfolio_project_id:project.id,asset_kind:'before',mime_type:'image/png',public_consent:true},png);
    assert.equal((await api('pro','finalize_upload',{kind:'portfolio',id:photo.id})).status,200);
    assert.ok((await users.pro.db.rpc('professional_confirm_upload',{p_kind:'portfolio',p_id:photo.id,p_actor:users.pro.id,p_sha256:'a'.repeat(64)})).error);
    assert.ok((await users.client.db.storage.from('dao-private').createSignedUrl(photo.path,60)).error);
    assert.ok((await users.pro.db.storage.from('dao-private').upload(photo.path,png,{upsert:true,contentType:'image/png'})).error);
    await cmd('reviewer','review_file',{id:photo.id,kind:'portfolio',approve:true,revision:2});
    assert.equal((await publicProfile()).portfolio.length,0);await cmd('pro','portfolio_submit',{id:project.id});
    const race=await Promise.all(['reviewer','reviewer2'].map(name=>users[name].db.rpc('professional_command',{p_action:'review_portfolio',p_input:{id:project.id,approve:true,revision:2}})));
    assert.equal(race.filter(r=>!r.error).length,1);assert.equal(race.find(r=>r.error)!.error.code,'23514');
    assert.equal((await publicProfile()).portfolio[0].assets[0].asset_kind,'before');assert.equal(JSON.stringify(await publicProfile()).includes('object_path'),false);
  });
  await t.test('spoofed MIME never becomes reviewable',async()=>{
    const fake=await upload({kind:'portfolio',portfolio_project_id:project.id,asset_kind:'photo',mime_type:'image/png',public_consent:true},Buffer.from('<html>not a PNG</html>'));
    assert.equal((await api('pro','finalize_upload',{kind:'portfolio',id:fake.id})).status,400);
    assert.equal((await users.reviewer.db.rpc('professional_command',{p_action:'review_file',p_input:{id:fake.id,kind:'portfolio',approve:true,revision:1}})).error!.code,'23514');
  });
  await t.test('approved brochure public, fiscal PDF permanently private',async()=>{
    const pdf=Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF');
    legal=await upload({kind:'professional',purpose:'tax',mime_type:'application/pdf',original_name:'fiscal.pdf'},pdf);
    assert.equal((await api('pro','finalize_upload',{kind:'professional',id:legal.id})).status,200);await cmd('reviewer','review_file',{kind:'professional',id:legal.id,approve:true,revision:2});
    assert.equal((await api('client','download',{kind:'professional',id:legal.id})).status,403);
    assert.ifError((await users.reviewer.db.rpc('backoffice_command',{p_action:'professional',p_input:{contractor_id:cp.id,decision:'verify'},p_key:randomUUID()})).error);
    brochure=await upload({kind:'portfolio',portfolio_project_id:project.id,asset_kind:'brochure',mime_type:'application/pdf',original_name:'brochure.pdf',public_consent:true},pdf);
    assert.equal((await api('pro','finalize_upload',{kind:'portfolio',id:brochure.id})).status,200);await cmd('reviewer','review_file',{kind:'portfolio',id:brochure.id,approve:true,revision:2});
    const response=await api('client','download',{kind:'portfolio',id:brochure.id});assert.equal(response.status,200);assert.match(response.headers.get('Content-Disposition')!,/^attachment/);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.deepEqual(Buffer.from(await response.arrayBuffer()),pdf);
    assert.equal((await api('other','download',{kind:'portfolio',id:brochure.id})).status,403);
  });
  await t.test('withdrawal invalidates a previously downloadable photo and published portfolio access',async()=>{
    assert.equal((await api('client','download',{kind:'portfolio',id:photo.id})).status,200);
    await cmd('pro','file_withdraw',{kind:'portfolio',id:photo.id});assert.equal((await api('client','download',{kind:'portfolio',id:photo.id})).status,403);
    await cmd('pro','portfolio_hide',{id:project.id});assert.equal((await api('client','download',{kind:'portfolio',id:brochure.id})).status,403);assert.equal((await publicProfile()).portfolio.length,0);
  });
  await t.test('professional suspension preserved by legal edits; suspended actor denied',async()=>{
    assert.ifError((await users.admin.db.rpc('backoffice_command',{p_action:'professional',p_input:{contractor_id:cp.id,decision:'suspend',reason:'Test'},p_key:randomUUID()})).error);
    await cmd('pro','details',{tax_identifier:'NEW PRIVATE TAX'});assert.equal((await dossier()).profile.verification_status,'suspended');assert.ok((await users.client.db.rpc('professional_public_profile',{p_id:cp.id})).error);
    const audits=(await admin.from('audit_events').select('metadata').eq('entity_id',cp.id)).data!;assert.equal(JSON.stringify(audits).includes('PRIVATE TAX'),false);
    await insert('account_states',{user_id:users.pro.id,status:'suspended'});assert.equal((await users.pro.db.rpc('professional_dossier',{p_id:cp.id})).error!.code,'42501');
  });
});
