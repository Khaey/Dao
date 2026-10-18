import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// #161 lot B / #211 — owner/staff preview shows in-review media with moderation state; nobody else does.
test('owner preview: in-review media for owner and staff only, never legal files or storage paths',async()=>{
  const url=process.env.DAO_SUPABASE_URL!,key=process.env.DAO_SUPABASE_PUBLISHABLE_KEY!,secret=process.env.DAO_SUPABASE_SECRET_KEY!;
  assert.equal(url,'http://127.0.0.1:54321','Only disposable Supabase is authorized');
  const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});const password='Prev!'+randomUUID();const users:any={};
  for(const [name,role] of Object.entries({pro:'contractor',client:'client',other:'contractor',staff:'dao_admin'})){
    const email=`prev161-${name}-${randomUUID()}@example.invalid`;const created=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ifError(created.error);
    const id=created.data.user!.id;assert.ifError((await admin.from('profiles').insert({user_id:id,display_name:name})).error);assert.ifError((await admin.from('user_roles').insert({user_id:id,role})).error);
    const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});assert.ifError((await db.auth.signInWithPassword({email,password})).error);users[name]={id,db};
  }
  async function insert(table:string,row:any){const r=await admin.from(table).insert(row).select('*').single();assert.ifError(r.error);return r.data;}
  const cp=await insert('contractor_profiles',{user_id:users.pro.id,business_name:'Pro privé aperçu',public_trade_name:'Pro Aperçu',public_presentation:'Menuiserie sur mesure',contractor_type:'artisan',verification_status:'verified'});
  const sha=(c:string)=>c.repeat(64);
  const logo=await insert('contractor_files',{contractor_id:cp.id,purpose:'logo',original_name:'logo.png',object_path:`professional/${cp.id}/${randomUUID()}`,mime_type:'image/png',size_bytes:10,public_consent:true,status:'ready',content_sha256:sha('a')});
  const tax=await insert('contractor_files',{contractor_id:cp.id,purpose:'tax',original_name:'PRIVATE-tax.pdf',object_path:`professional/${cp.id}/${randomUUID()}`,mime_type:'application/pdf',size_bytes:10,status:'approved',content_sha256:sha('b')});
  const project=await insert('portfolio_projects',{contractor_id:cp.id,title:'Réalisation en revue',description:'x',status:'pending_review',publication_consent:true});
  await insert('portfolio_projects',{contractor_id:cp.id,title:'Réalisation masquée',description:'x',status:'hidden',publication_consent:true});
  const asset=await insert('portfolio_assets',{portfolio_project_id:project.id,contractor_id:cp.id,object_path:`portfolio/${project.id}/${randomUUID()}`,mime_type:'image/png',size_bytes:10,status:'ready',original_name:'avant.png',asset_kind:'before',public_consent:true,content_sha256:sha('c')});
  await insert('portfolio_assets',{portfolio_project_id:project.id,contractor_id:cp.id,object_path:`portfolio/${project.id}/${randomUUID()}`,mime_type:'image/png',size_bytes:10,status:'quarantined',original_name:'non-inspecte.png',asset_kind:'photo',public_consent:true});
  const preview=async(name:string,flag=true)=>users[name].db.rpc('professional_public_profile',{p_id:cp.id,p_preview:flag});

  for(const name of ['pro','staff']){
    const r=await preview(name);assert.ifError(r.error);
    assert.equal(r.data.preview,true);assert.equal(r.data.logo_id,logo.id);assert.equal(r.data.logo_status,'ready');assert.equal(r.data.logo_public_consent,true);
    assert.deepEqual(r.data.portfolio.map((p:any)=>p.title),['Réalisation en revue'],`${name}: hidden project excluded`);
    assert.equal(r.data.portfolio[0].status,'pending_review');assert.deepEqual(r.data.portfolio[0].assets.map((a:any)=>[a.id,a.status]),[[asset.id,'ready']]);
    const text=JSON.stringify(r.data);for(const leak of ['object_path',tax.id,'PRIVATE-tax','non-inspecte'])assert.equal(text.includes(leak),false,`${name}: ${leak}`);
  }
  // Unpublished profile: a Client or another professional gets nothing, even forging preview=true.
  for(const name of ['client','other']){const r=await preview(name);assert.ok(r.error);assert.equal(r.error.code,'42501');}
  // Once published, a Client still gets only the public projection (no review states, no in-review media).
  assert.ifError((await admin.from('contractor_trades').insert({contractor_id:cp.id,trade_id:(await admin.from('trades').select('id').eq('active',true).limit(1).single()).data!.id})).error);
  assert.ifError((await users.pro.db.rpc('professional_command',{p_action:'profile_submit',p_input:{}})).error);
  const dossier=(await users.pro.db.rpc('professional_dossier',{p_id:cp.id})).data;
  assert.ifError((await users.staff.db.rpc('professional_command',{p_action:'review_profile',p_input:{id:cp.id,approve:true,revision:dossier.details.revision}})).error);
  for(const flag of [false,true]){
    const r=await preview('client',flag);assert.ifError(r.error);
    assert.equal(r.data.preview,false);assert.deepEqual(r.data.portfolio,[]);assert.equal(r.data.logo_id,null);
    assert.equal('logo_status' in r.data,false);assert.equal(JSON.stringify(r.data).includes('pending_review'),false);
  }
});
