import { createClient } from '@supabase/supabase-js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { BidService } from '../../src/services/BidService.js';

test('autonomous Supabase integration', async () => {
  for (const name of ['DAO_SUPABASE_URL','DAO_SUPABASE_PUBLISHABLE_KEY','DAO_SUPABASE_SECRET_KEY']) assert.ok(process.env[name], 'missing '+name);
  const url=process.env.DAO_SUPABASE_URL!, pub=process.env.DAO_SUPABASE_PUBLISHABLE_KEY!, secret=process.env.DAO_SUPABASE_SECRET_KEY!;
  assert.equal(url,'http://127.0.0.1:54321','real integration tests are restricted to disposable local Supabase');
  const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
  const suffix=Date.now().toString(36), password='T!Dao-'+suffix+'-x9', actors:any={};
  const insert=async(table:string,row:any)=>{const r=await admin.from(table).insert(row).select('id').single();assert.ifError(r.error);return r.data.id;};
    for (const role of ['clientA','clientB','plumberA','plumberB','dual']) {
      const email='dao-'+role+'-'+suffix+'@example.invalid'; const r=await admin.auth.admin.createUser({email,password,email_confirm:true}); assert.ifError(r.error); actors[role]={id:r.data.user!.id,email};
      await insert('profiles',{user_id:actors[role].id,display_name:'DAO '+role}); await insert('user_roles',{user_id:actors[role].id,role:role.startsWith('client')?'client':'contractor'});
    }
    await insert('user_roles',{user_id:actors.dual.id,role:'client'});
    const g=await admin.from('governorates').select('id').limit(1); assert.ifError(g.error); assert.ok(g.data?.[0]);
    const t=await admin.from('trades').select('id').eq('active',true).limit(1); assert.ifError(t.error); assert.ok(t.data?.[0]);
    const gov=g.data![0].id, trade=t.data![0].id;
    for (const role of ['plumberA','plumberB']) actors[role].contractorId=await insert('contractor_profiles',{user_id:actors[role].id,business_name:'DAO '+role,verification_status:'verified',contractor_type:'artisan',public_presentation:'test',public_identity_status:'approved'});
    const project=await insert('projects',{client_id:actors.clientA.id,project_type:'renovation',surface_m2:100});
    const version=await insert('project_versions',{project_id:project,version_no:1,title:'Disposable',description:'test',governorate_id:gov,status:'approved'});
    const projectB=await insert('projects',{client_id:actors.clientA.id,project_type:'renovation',surface_m2:90});
    const versionB=await insert('project_versions',{project_id:projectB,version_no:1,title:'Targeted disposable',description:'test',governorate_id:gov,status:'approved'});
    const projectC=await insert('projects',{client_id:actors.clientA.id,project_type:'renovation',surface_m2:80});
    const versionC=await insert('project_versions',{project_id:projectC,version_no:1,title:'Invite disposable',description:'test',governorate_id:gov,status:'approved'});
    const request=await insert('project_requests',{project_id:project}); const rv=await insert('project_request_versions',{request_id:request,project_id:project,version_no:1,trade_id:trade,title:'Plomberie',scope:'test'});
    const publicPub=await insert('publications',{project_id:project,project_version_id:version,visibility:'public',safe_title:'Public',safe_description:'test',governorate_id:gov,project_type:'renovation',published_at:new Date().toISOString()});
    const publicRequest=await insert('publication_requests',{publication_id:publicPub,request_version_id:rv,trade_id:trade,safe_title:'Plomberie',safe_scope:'test'});
    const targeted=await insert('publications',{project_id:projectB,project_version_id:versionB,visibility:'targeted',safe_title:'Targeted',safe_description:'test',governorate_id:gov,project_type:'renovation',published_at:new Date().toISOString()});
    await insert('publication_recipients',{publication_id:targeted,contractor_id:actors.plumberA.contractorId,source:'targeted'});
    const bid=await insert('bids',{project_id:project,contractor_id:actors.plumberB.contractorId});
    const submitted=await insert('bid_versions',{bid_id:bid,project_id:project,contractor_id:actors.plumberB.contractorId,version_no:1,expires_at:'2099-01-01T00:00:00Z',status:'draft'}); actors.submittedVersion=submitted;
    const item=await insert('bid_items',{bid_version_id:submitted,project_id:project,contractor_id:actors.plumberB.contractorId,request_version_id:rv,request_id:request,price_millimes:1000,duration_days:1,inclusions:'test'});
    const bid2=await insert('bids',{project_id:project,contractor_id:actors.plumberA.contractorId});
    const submitted2=await insert('bid_versions',{bid_id:bid2,project_id:project,contractor_id:actors.plumberA.contractorId,version_no:1,expires_at:'2099-01-01T00:00:00Z',status:'draft'});
    const item2=await insert('bid_items',{bid_version_id:submitted2,project_id:project,contractor_id:actors.plumberA.contractorId,request_version_id:rv,request_id:request,price_millimes:1100,duration_days:1,inclusions:'test'});
    const login=async(a:any)=>{const userClient=createClient(url,pub);const r=await userClient.auth.signInWithPassword({email:a.email,password});assert.ifError(r.error);return createClient(url,pub,{global:{headers:{Authorization:'Bearer '+r.data.session!.access_token}}});};
    const registrationUser=async(label:string)=>{const email=`dao-registration-${label}-${suffix}@example.invalid`;const created=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ifError(created.error);return {id:created.data.user!.id,email};};
    const registrationClient=async(user:any)=>{const client=createClient(url,pub);const signed=await client.auth.signInWithPassword({email:user.email,password});assert.ifError(signed.error);return createClient(url,pub,{global:{headers:{Authorization:'Bearer '+signed.data.session!.access_token}}});};
    const registrationClientUser=await registrationUser('client'), registrationContractorUser=await registrationUser('contractor'), forgedRoleUser=await registrationUser('forged');
    const registrationClientApi=await registrationClient(registrationClientUser), registrationContractorApi=await registrationClient(registrationContractorUser), forgedRoleApi=await registrationClient(forgedRoleUser);
    const implicitClientType=await registrationClientApi.rpc('initialize_my_account',{p_display_name:'Implicit type',p_phone_e164:null});assert.ok(implicitClientType.error,'public registration requires an explicit account type');
    const initializedClient=await registrationClientApi.rpc('initialize_my_account',{p_display_name:'Client test',p_phone_e164:null,p_account_type:'client',p_business_name:null});
    assert.ifError(initializedClient.error);
    const clientRole=await admin.from('user_roles').select('role').eq('user_id',registrationClientUser.id).single();assert.ifError(clientRole.error);assert.equal(clientRole.data.role,'client');
    const clientProfile=await admin.from('profiles').select('display_name').eq('user_id',registrationClientUser.id).single();assert.ifError(clientProfile.error);assert.equal(clientProfile.data.display_name,'Client test');
    const initializedContractor=await registrationContractorApi.rpc('initialize_my_account',{p_display_name:'Contractor test',p_phone_e164:null,p_account_type:'contractor',p_business_name:'Atelier explicit'});
    assert.ifError(initializedContractor.error);
    const contractorRole=await admin.from('user_roles').select('role').eq('user_id',registrationContractorUser.id).single();assert.ifError(contractorRole.error);assert.equal(contractorRole.data.role,'contractor');
    const contractorProfile=await admin.from('contractor_profiles').select('id,business_name,verification_status,contractor_type').eq('user_id',registrationContractorUser.id).single();assert.ifError(contractorProfile.error);assert.equal(contractorProfile.data.business_name,'Atelier explicit');assert.equal(contractorProfile.data.verification_status,'pending');assert.equal(contractorProfile.data.contractor_type,null);
    const contractorTrades=await admin.from('contractor_trades').select('id').eq('contractor_id',contractorProfile.data.id);assert.ifError(contractorTrades.error);assert.deepEqual(contractorTrades.data,[]);
    for(const account_type of ['dao_admin','dao_reviewer','service_role','internal']){
      const rejected=await forgedRoleApi.rpc('initialize_my_account',{p_display_name:'Forged',p_phone_e164:null,p_account_type:account_type,p_business_name:null});
      assert.ok(rejected.error,`forged role ${account_type} must be rejected`);
    }
    const profileOnlyUpdate=await forgedRoleApi.rpc('update_my_profile',{p_display_name:'Profil sans rôle',p_phone_e164:null});assert.ifError(profileOnlyUpdate.error);assert.equal(profileOnlyUpdate.data.display_name,'Profil sans rôle');
    const noForgedRole=await admin.from('user_roles').select('role').eq('user_id',forgedRoleUser.id);assert.ifError(noForgedRole.error);assert.deepEqual(noForgedRole.data,[]);
    const directRoleInsert=await forgedRoleApi.from('user_roles').insert({user_id:forgedRoleUser.id,role:'dao_admin'});assert.ok(directRoleInsert.error,'authenticated signup cannot directly assign a role');
    const client=await login(actors.clientA), a=await login(actors.plumberA), b=await login(actors.plumberB), other=await login(actors.clientB), dual=await login(actors.dual);
    const createdProject=await client.rpc('create_project_draft',{p_project_type:'repair',p_surface_m2:42,p_desired_start_date:null,p_indicative_budget_millimes:null,p_governorate_id:gov});
    assert.ifError(createdProject.error); assert.ok(createdProject.data?.id);
    assert.equal((await admin.from('projects').select('client_id').eq('id',createdProject.data.id).single()).data?.client_id,actors.clientA.id);
    const createdRequest=await client.rpc('add_project_request',{
      p_project_id:createdProject.data.id,
      p_trade_id:trade,
      p_title:'Demande legacy autonome',
      p_scope:'test',
    });
    assert.ifError(createdRequest.error); assert.ok(createdRequest.data?.id);
    const linked=await admin.from('project_request_versions').select('id,request_id,project_id').eq('request_id',createdRequest.data.id).single(); assert.ifError(linked.error); assert.equal(linked.data?.project_id,createdProject.data.id);
    const createdVersion=await admin.from('project_versions').select('id').eq('project_id',createdProject.data.id).single(); assert.ifError(createdVersion.error); assert.ok(createdVersion.data?.id);
    const versionLink=await admin.from('project_version_requests').select('id').eq('project_id',createdProject.data.id).eq('project_version_id',createdVersion.data.id).eq('request_version_id',linked.data.id).single(); assert.ifError(versionLink.error); assert.ok(versionLink.data?.id);

    const createdRequestFive=await client.rpc('add_project_request',{p_project_id:createdProject.data.id,p_trade_id:trade,p_title:'Demande cinq paramètres',p_scope:'test',p_budget_millimes:null});
    assert.ifError(createdRequestFive.error); assert.ok(createdRequestFive.data?.id);
    const linkedFive=await admin.from('project_request_versions').select('id,budget_millimes').eq('request_id',createdRequestFive.data.id).single(); assert.ifError(linkedFive.error); assert.ok(linkedFive.data?.id); assert.equal(linkedFive.data?.budget_millimes,null);
    const versionLinkFive=await admin.from('project_version_requests').select('id').eq('project_id',createdProject.data.id).eq('project_version_id',createdVersion.data.id).eq('request_version_id',linkedFive.data.id).single(); assert.ifError(versionLinkFive.error); assert.ok(versionLinkFive.data?.id);

    const requestedBudget=1234567;
    const createdRequestWithBudget=await client.rpc('add_project_request',{p_project_id:createdProject.data.id,p_trade_id:trade,p_title:'Demande avec budget',p_scope:'test',p_budget_millimes:requestedBudget});
    assert.ifError(createdRequestWithBudget.error); assert.ok(createdRequestWithBudget.data?.id);
    const linkedBudget=await admin.from('project_request_versions').select('id,budget_millimes').eq('request_id',createdRequestWithBudget.data.id).single(); assert.ifError(linkedBudget.error); assert.ok(linkedBudget.data?.id); assert.equal(Number(linkedBudget.data?.budget_millimes),requestedBudget);
    const versionLinkBudget=await admin.from('project_version_requests').select('id').eq('project_id',createdProject.data.id).eq('project_version_id',createdVersion.data.id).eq('request_version_id',linkedBudget.data.id).single(); assert.ifError(versionLinkBudget.error); assert.ok(versionLinkBudget.data?.id);

    const submittedForReview=await client.rpc('submit_project_for_review',{p_project_id:createdProject.data.id});
    assert.ifError(submittedForReview.error); assert.equal(submittedForReview.data?.status,'client_review');
    const transitionedVersion=await admin.from('project_versions').select('status').eq('id',createdVersion.data.id).single(); assert.ifError(transitionedVersion.error); assert.equal(transitionedVersion.data?.status,'client_review');
    const projectRequestCounts=async()=>{
      const [requests,requestVersions,projectVersionRequests]=await Promise.all([
        admin.from('project_requests').select('id',{count:'exact',head:true}).eq('project_id',createdProject.data.id),
        admin.from('project_request_versions').select('id',{count:'exact',head:true}).eq('project_id',createdProject.data.id),
        admin.from('project_version_requests').select('id',{count:'exact',head:true}).eq('project_id',createdProject.data.id),
      ]);
      for(const result of [requests,requestVersions,projectVersionRequests]) assert.ifError(result.error);
      return {requests:requests.count??0,requestVersions:requestVersions.count??0,projectVersionRequests:projectVersionRequests.count??0};
    };
    const countsBeforeLegacyReject=await projectRequestCounts();
    const rejectedLegacyRequest=await client.rpc('add_project_request',{p_project_id:createdProject.data.id,p_trade_id:trade,p_title:'Interdit hors brouillon',p_scope:'test'});
    assert.ok(rejectedLegacyRequest.error,'legacy overload must reject a non-draft project version');
    assert.deepEqual(await projectRequestCounts(),countsBeforeLegacyReject,'rejected legacy RPC must not create a request, version, or project-version link');
    const deniedRequest=await other.rpc('add_project_request',{p_project_id:createdProject.data.id,p_trade_id:trade,p_title:'Interdit',p_scope:'test',p_budget_millimes:null}); assert.ok(deniedRequest.error);
    assert.equal((await client.from('bids').select('id').eq('id',bid)).data?.length,0);
    assert.equal((await b.from('bid_versions').select('id').eq('id',submitted)).data?.length,1);
    assert.equal((await a.from('bid_versions').select('id').eq('id',submitted2)).data?.length,1);
    await assert.rejects(()=>new BidService(a).submitForActor(submitted,actors.plumberA.contractorId));
    await new BidService(b).submitForActor(submitted,actors.plumberB.contractorId);
    await new BidService(a).submitForActor(submitted2,actors.plumberA.contractorId);
    const immutableVersionUpdate=await admin.from('bid_versions').update({expires_at:'2098-01-01T00:00:00Z'}).eq('id',submitted);
    assert.ok(immutableVersionUpdate.error,'submitted bid version update must be rejected');
    const immutableVersionDelete=await admin.from('bid_versions').delete().eq('id',submitted);
    assert.ok(immutableVersionDelete.error,'submitted bid version delete must be rejected');
    const immutableItemUpdate=await admin.from('bid_items').update({inclusions:'mutated'}).eq('id',item);
    assert.ok(immutableItemUpdate.error,'submitted bid item update must be rejected');
    const immutableItemDelete=await admin.from('bid_items').delete().eq('id',item);
    assert.ok(immutableItemDelete.error,'submitted bid item delete must be rejected');
    assert.equal((await client.from('bid_versions').select('id').eq('id',submitted)).data?.length,1);
    assert.equal((await other.from('bid_versions').select('id').eq('id',submitted)).data?.length,0);
    assert.equal((await other.from('publications').select('id').eq('id',publicPub)).data?.length,1);
    assert.equal((await a.from('publications').select('id').eq('id',targeted)).data?.length,1);
    assert.equal((await other.from('publications').select('id').eq('id',targeted)).data?.length,0);
    assert.equal((await dual.from('user_roles').select('role').in('role',['client','contractor'])).data?.length,2);
    const invite=await insert('publications',{project_id:projectC,project_version_id:versionC,visibility:'invite_only',safe_title:'Invite',safe_description:'test',governorate_id:gov,project_type:'renovation',published_at:new Date().toISOString()});
    await insert('publication_recipients',{publication_id:invite,contractor_id:actors.plumberB.contractorId,source:'invitation'});
    assert.equal((await b.from('publications').select('id').eq('id',invite)).data?.length,1);
    assert.equal((await other.from('publications').select('id').eq('id',invite)).data?.length,0);
    const objectPath='bid/'+submitted+'/autonomous-'+suffix+'.pdf';
    const upload=await admin.storage.from('dao-private').createSignedUploadUrl(objectPath); assert.ifError(upload.error); assert.ok(upload.data?.token);
    const put=await createClient(url,pub).storage.from('dao-private').uploadToSignedUrl(objectPath,upload.data!.token,new Blob(['test'],{type:'application/pdf'})); assert.ifError(put.error);
    const doc=await insert('bid_documents',{bid_version_id:submitted,project_id:project,contractor_id:actors.plumberB.contractorId,object_path:objectPath,original_name:'test.pdf',mime_type:'application/pdf',size_bytes:4,status:'approved'});
    assert.equal((await client.from('bid_documents').select('id').eq('id',doc)).data?.length,1);
    assert.equal((await a.from('bid_documents').select('id').eq('id',doc)).data?.length,0);
    const immutableDocumentUpdate=await admin.from('bid_documents').update({original_name:'mutated.pdf'}).eq('id',doc);
    assert.ok(immutableDocumentUpdate.error,'submitted bid document update must be rejected');
    const signed=await admin.storage.from('dao-private').createSignedUrl(objectPath,60); assert.ifError(signed.error); assert.ok(signed.data?.signedUrl);
    const nextDraft=await b.rpc('create_bid_draft',{p_publication_id:publicPub});assert.ifError(nextDraft.error);assert.equal(nextDraft.data.version_no,2);
    const nextItem=await b.rpc('upsert_bid_item',{p_publication_id:publicPub,p_version_id:nextDraft.data.id,p_publication_request_id:publicRequest,p_price_millimes:900,p_duration_days:2,p_inclusions:'latest',p_exclusions:null});assert.ifError(nextItem.error);
    const nextSubmitted=await b.rpc('submit_bid_version',{p_version_id:nextDraft.data.id});assert.ifError(nextSubmitted.error);
    const previousVersion=await admin.from('bid_versions').select('status,validity').eq('id',submitted).single();assert.ifError(previousVersion.error);assert.deepEqual(previousVersion.data,{status:'superseded',validity:'obsolete'});
    const staleAward=await client.rpc('award_bid_item_atomic',{p_idempotency_key:'stale-'+suffix,p_bid_item_id:item});assert.ok(staleAward.error,'a superseded offer version must not remain awardable');
    const key='autonomous-'+suffix, params={p_idempotency_key:key,p_bid_item_id:nextItem.data.id};
    const first=await client.rpc('award_bid_item_atomic',params); assert.ifError(first.error); const replay=await client.rpc('award_bid_item_atomic',params); assert.ifError(replay.error); assert.deepEqual(first.data,replay.data);
    const persistedAward=await admin.from('award_items').select('project_id,contractor_id,request_id,bid_item_id,agreed_millimes,active').eq('id',first.data.award_item_id).single();assert.ifError(persistedAward.error);assert.deepEqual(persistedAward.data,{project_id:project,contractor_id:actors.plumberB.contractorId,request_id:request,bid_item_id:nextItem.data.id,agreed_millimes:900,active:true});
    const awardedRequest=await admin.from('project_requests').select('status').eq('id',request).single();assert.ifError(awardedRequest.error);assert.equal(awardedRequest.data.status,'awarded');
    const denied=await other.rpc('award_bid_item_atomic',{...params,p_idempotency_key:key+'-other'}); assert.ok(denied.error);
    const second=await client.rpc('award_bid_item_atomic',{p_idempotency_key:key+'-second',p_bid_item_id:item2});
    assert.ok(second.error); assert.match((second.error?.code||'')+' '+(second.error?.message||''),/23505|one_active_award_per_request/i);
});
