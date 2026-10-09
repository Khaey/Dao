import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Independent fixtures: existing professional/award tests retain their own state.
export async function professionalCases(db, check) {
  const users = {};
  for (const [name,role] of Object.entries({pro:'contractor',other:'contractor',client:'client',reviewer:'dao_reviewer',admin:'dao_admin'})) {
    users[name]=randomUUID();
    await db.query('insert into auth.users(id,email) values($1,$2)',[users[name],`${name}-${users[name]}@example.invalid`]);
    await db.query('insert into public.profiles(user_id,display_name) values($1,$2)',[users[name],name]);
    await db.query('insert into public.user_roles(user_id,role) values($1,$2)',[users[name],role]);
  }
  const cp=(await db.query("insert into public.contractor_profiles(user_id,business_name,public_trade_name,public_presentation,contractor_type,verification_status) values($1,'Atelier','Atelier public','Travaux déclarés','artisan','verified') returning id",[users.pro])).rows[0].id;
  const trade=(await db.query('select id from public.trades where active limit 1')).rows[0].id;
  await db.query('insert into public.contractor_trades(contractor_id,trade_id) values($1,$2)',[cp,trade]);
  async function as(name,fn) { await db.query("select set_config('request.jwt.claim.sub',$1,false)",[users[name]||'']); await db.exec(`set role ${name==='service'?'service_role':'authenticated'}`); try { return await fn(); } finally { await db.exec("reset role;select set_config('request.jwt.claim.sub','',false)"); } }
  const rpc=(name,fn,args)=>as(name,async()=>(await db.query(`select public.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as value`,args)).rows[0].value);
  const cmd=(name,action,input)=>rpc(name,'professional_command',[action,input]);
  const deny=(fn,code)=>assert.rejects(fn,e=>e.code===code);
  const dossier=()=>rpc('pro','professional_dossier',[cp]);
  const publicProfile=()=>rpc('client','professional_public_profile',[cp,false]);
  const submit=()=>cmd('pro','profile_submit',{});
  const approveProfile=async()=>cmd('admin','review_profile',{id:cp,approve:true,revision:(await dossier()).details.revision});
  let project,photo,legal,brochure;
  await check('PRO private dossier: RNE optional, unknown fields/direct writes/cross-owner/anonymous denied',async()=>{
    await cmd('pro','details',{city:'Tunis',legal_name:'Identité privée',professional_phone:'+21620000001',office_address:'Adresse privée',show_phone:false});
    assert.equal((await dossier()).details.registration_identifier,'');
    assert.equal((await dossier()).profile.verification_status,'pending');
    await deny(()=>cmd('pro','details',{verification_status:'verified'}),'22023');
    await deny(()=>rpc('other','professional_dossier',[cp]),'42501');
    await as('client',async()=>assert.equal((await db.query('select * from public.contractor_profile_details where contractor_id=$1',[cp])).rows.length,0));
    await as('pro',()=>deny(()=>db.query("update public.contractor_profile_details set review_status='approved' where contractor_id=$1",[cp]),'42501'));
    await as('anon',()=>deny(()=>db.query('select public.professional_dossier($1)',[cp]),'42501'));
    await deny(()=>publicProfile(),'42501');
  });
  await check('PRO rejects non-HTTPS/contact injection and legal media public consent',async()=>{
    for(const website_url of ['javascript:alert(1)','http://example.com','https://example.com/<script>']) await deny(()=>cmd('pro','details',{website_url}),'23514');
    await deny(()=>cmd('pro','details',{social_links:['javascript:alert(1)']}),'22023');
    await deny(()=>cmd('pro','details',{professional_phone:'<script>'}),'23514');
    await deny(()=>cmd('pro','file_create',{kind:'professional',purpose:'tax',public_consent:true,object_path:`professional/${cp}/tax.pdf`,original_name:'tax.pdf',mime_type:'application/pdf',size_bytes:100}),'23514');
  });
  await check('PRO reviewer cannot publish identity, stale review rejected, public projection excludes legal fields',async()=>{
    await db.query("update public.contractor_profiles set verification_status='verified' where id=$1",[cp]);
    await submit(); const revision=(await dossier()).details.revision;
    await deny(()=>cmd('reviewer','review_profile',{id:cp,approve:true,revision}),'42501');
    await deny(()=>cmd('admin','review_profile',{id:cp,approve:true,revision:revision-1}),'23514');
    await approveProfile(); const view=await publicProfile();
    assert.equal(view.professional_phone,null); assert.equal(view.office_address,null);
    for(const field of ['legal_name','tax_identifier','registration_identifier','representative_name','files','object_path','user_id']) assert.equal(field in view,false);
    assert.equal(JSON.stringify(view).includes('Identité privée'),false);
    await deny(()=>rpc('other','professional_public_profile',[cp,true]),'42501');
  });
  await check('PRO contact consent and web edits need moderation without restarting verification',async()=>{
    await cmd('pro','details',{show_phone:true,website_url:'https://example.com',show_website:true});
    assert.equal((await dossier()).profile.verification_status,'verified'); await deny(()=>publicProfile(),'42501');
    await submit(); await approveProfile(); assert.equal((await publicProfile()).professional_phone,'+21620000001');
  });
  await check('PRO unpublished portfolio invisible; public media require consent and server inspection',async()=>{
    project=await cmd('pro','portfolio_save',{title:'Rénovation',description:'Réalisation déclarée',trade_id:trade,completed_year:2024,approximate_location:'Tunis',publication_consent:true});
    photo=await cmd('pro','file_create',{kind:'portfolio',portfolio_project_id:project.id,object_path:`portfolio/${project.id}/before.png`,original_name:'before.png',mime_type:'image/png',size_bytes:100,asset_kind:'before',public_consent:false});
    assert.equal((await publicProfile()).portfolio.length,0);
    await deny(()=>cmd('admin','review_file',{kind:'portfolio',id:photo.id,approve:true,revision:photo.revision}),'23514');
    await deny(()=>rpc('pro','professional_confirm_upload',['portfolio',photo.id,users.pro,'a'.repeat(64)]),'42501');
    await rpc('service','professional_confirm_upload',['portfolio',photo.id,users.pro,'a'.repeat(64)]);
    await deny(()=>cmd('admin','review_file',{kind:'portfolio',id:photo.id,approve:true,revision:2}),'23514');
    await cmd('pro','file_update',{kind:'portfolio',id:photo.id,public_consent:true,caption:'Avec accord'});
    await cmd('reviewer','review_file',{kind:'portfolio',id:photo.id,approve:true,revision:3});
    await cmd('pro','portfolio_submit',{id:project.id});
    await cmd('reviewer','review_portfolio',{id:project.id,approve:true,revision:2});
    assert.equal((await publicProfile()).portfolio[0].assets[0].id,photo.id);
  });
  await check('PRO file access rechecks withdrawal; another pro cannot download; no raw path in public projection',async()=>{
    assert.equal((await rpc('client','professional_file_access',['portfolio',photo.id,false])).id,photo.id);
    await deny(()=>rpc('other','professional_file_access',['portfolio',photo.id,false]),'42501');
    assert.equal(JSON.stringify(await publicProfile()).includes('object_path'),false);
    await cmd('pro','file_withdraw',{kind:'portfolio',id:photo.id});
    await deny(()=>rpc('client','professional_file_access',['portfolio',photo.id,false]),'42501');
    assert.equal((await publicProfile()).portfolio[0].assets.length,0);
  });
  await check('PRO brochure PDF distinct from private tax PDF; approved administrative file never public',async()=>{
    legal=await cmd('pro','file_create',{kind:'professional',purpose:'tax',object_path:`professional/${cp}/private.pdf`,original_name:'fiscal.pdf',mime_type:'application/pdf',size_bytes:100});
    await rpc('service','professional_confirm_upload',['professional',legal.id,users.pro,'c'.repeat(64)]);
    await cmd('reviewer','review_file',{kind:'professional',id:legal.id,approve:true,revision:2});
    assert.equal((await dossier()).profile.verification_status,'pending');
    await deny(()=>rpc('client','professional_file_access',['professional',legal.id,false]),'42501');
    await deny(()=>cmd('pro','file_update',{kind:'professional',id:legal.id,public_consent:true}),'22023');
    brochure=await cmd('pro','file_create',{kind:'portfolio',portfolio_project_id:project.id,object_path:`portfolio/${project.id}/brochure.pdf`,original_name:'brochure.pdf',mime_type:'application/pdf',size_bytes:100,asset_kind:'brochure',public_consent:true});
    await rpc('service','professional_confirm_upload',['portfolio',brochure.id,users.pro,'d'.repeat(64)]);
    await cmd('reviewer','review_file',{kind:'portfolio',id:brochure.id,approve:true,revision:2});
    await db.query("update public.contractor_profiles set verification_status='verified' where id=$1",[cp]);
    assert.equal((await publicProfile()).portfolio[0].assets[0].asset_kind,'brochure');
    await deny(()=>rpc('client','professional_file_access',['professional',legal.id,false]),'42501');
  });
  await check('PRO suspension survives legal edits and blocks publication; audit contains field names only',async()=>{
    await db.query("update public.contractor_profiles set verification_status='suspended' where id=$1",[cp]);
    await cmd('pro','details',{tax_identifier:'SECRET-TAX'}); assert.equal((await dossier()).profile.verification_status,'suspended');
    await submit(); await deny(()=>approveProfile(),'23514'); await deny(()=>publicProfile(),'42501');
    const events=(await db.query("select metadata from public.audit_events where entity_id=$1 and action like 'professional_%'",[cp])).rows;
    assert.equal(JSON.stringify(events).includes('SECRET-TAX'),false);
  });
}
