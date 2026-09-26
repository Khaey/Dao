import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const db=new PGlite();const results=[];let fails=0;
async function test(name,fn){try{await fn();results.push({name,result:'PASS'});}catch(e){results.push({name,result:'FAIL',code:e.code,message:e.message});fails++;}}
function eq(a,b){if(a!==b)throw Error(`Expected ${b}, received ${a}`)}
async function denied(sql,code){try{await db.exec(sql)}catch(e){eq(e.code,code);return}throw Error('Unexpected success')}
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;
create schema storage; create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated;grant select,insert,update,delete on storage.objects to anon,authenticated;create policy test_broad_policy on storage.objects for all to anon,authenticated using(true) with check(true); create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
await db.exec(`create function public.rls_auto_enable() returns trigger language plpgsql as $$ begin return new; end $$;`);
for(const f of readdirSync(new URL('../supabase/migrations/',import.meta.url)).sort())await test('migration '+f,()=>db.exec(readFileSync(new URL('../supabase/migrations/'+f,import.meta.url),'utf8')));
if(fails)throw Error(JSON.stringify(results));
await test('canonical trade seed is idempotent by code',async()=>{
 await db.exec(readFileSync(new URL('../supabase/migrations/20260926092748_enforce_draft_withdrawal_and_approved_publication.sql',import.meta.url),'utf8'));
 const rows=(await db.query("select code,name_fr,active,count(*) over(partition by code)::int as copies from public.trades where code in ('general_contractor','plumbing','electrical') order by code")).rows;
 eq(rows.length,3);for(const row of rows){eq(row.active,true);eq(row.copies,1);}
 eq(rows.find(row=>row.code==='general_contractor')?.name_fr,'Entreprise générale');
 eq(rows.find(row=>row.code==='plumbing')?.name_fr,'Plomberie');
 eq(rows.find(row=>row.code==='electrical')?.name_fr,'Électricité');
});
async function insert(t,values){const v={id:randomUUID(),...values};const keys=Object.keys(v);await db.query(`insert into public.${t}(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(v));return v.id;}
const U={};for(const n of ['clientA','clientB','proA','proB','general','admin']){U[n]=randomUUID();await db.query('insert into auth.users values($1)',[U[n]]);await insert('profiles',{user_id:U[n],display_name:n});await insert('user_roles',{user_id:U[n],role:n==='admin'?'dao_admin':n.startsWith('client')?'client':'contractor'});}
await insert('user_roles',{user_id:U.proA,role:'client'});
// Synthetic local-only fixtures, explicitly NOT a verified Tunisia seed.
const gov=await insert('governorates',{code:'TEST_ONLY',name_fr:'Territoire synthétique',name_ar:'اختبار'});
const trade=await insert('trades',{code:'TEST_ONLY',name_fr:'Métier synthétique'});
const C={};for(const n of ['proA','proB','general'])C[n]=await insert('contractor_profiles',{user_id:U[n],business_name:n,verification_status:'verified',contractor_type:n==='general'?'general_contractor':'artisan'});
const P=await insert('projects',{client_id:U.clientA});const Q=await insert('projects',{client_id:U.clientB});
const V=await insert('project_versions',{project_id:P,version_no:1,title:'Test',description:'Test',governorate_id:gov});
const rev=await insert('project_reviews',{project_version_id:V,actor_id:U.clientA,actor_role:'client',decision:'approved'});
const run=await insert('ai_runs',{project_id:P,status:'succeeded',provider:'test'});const proposal=await insert('ai_proposals',{run_id:run,trade_id:trade,proposed_scope:'Test',status:'proposed'});
const requests=[];for(let i=0;i<4;i++){const r=await insert('project_requests',{project_id:P});const rv=await insert('project_request_versions',{request_id:r,project_id:P,version_no:1,trade_id:trade,title:'Test '+i,scope:'Test'});requests.push({r,rv});}
const withdrawalProject=await insert('projects',{client_id:U.clientA});
const withdrawalProjectVersion=await insert('project_versions',{project_id:withdrawalProject,version_no:1,title:'Withdrawal test',description:'Test',governorate_id:gov,status:'draft'});
const withdrawalRequests=[];
for(let i=0;i<2;i++){
 const request=await insert('project_requests',{project_id:withdrawalProject});
 const requestVersion=await insert('project_request_versions',{request_id:request,project_id:withdrawalProject,version_no:1,trade_id:trade,title:'Withdrawal lot '+i,scope:'Test'});
 await insert('project_version_requests',{project_id:withdrawalProject,project_version_id:withdrawalProjectVersion,request_version_id:requestVersion});
 withdrawalRequests.push({request,requestVersion});
}
const staleDraftProject=await insert('projects',{client_id:U.clientA});
const staleDraftVersion=await insert('project_versions',{project_id:staleDraftProject,version_no:1,title:'Old draft',description:'Test',governorate_id:gov,status:'draft'});
await insert('project_versions',{project_id:staleDraftProject,version_no:2,title:'Current review',description:'Test',governorate_id:gov,status:'client_review'});
const staleDraftRequest=await insert('project_requests',{project_id:staleDraftProject});
const staleDraftRequestVersion=await insert('project_request_versions',{request_id:staleDraftRequest,project_id:staleDraftProject,version_no:1,trade_id:trade,title:'Stale draft lot',scope:'Test'});
await insert('project_version_requests',{project_id:staleDraftProject,project_version_id:staleDraftVersion,request_version_id:staleDraftRequestVersion});
const nonDraftWithdrawal=[];
nonDraftWithdrawal.push({status:'client_review',request:staleDraftRequest});
for(const status of ['dao_review','approved']){
 const project=await insert('projects',{client_id:U.clientA});
 const version=await insert('project_versions',{project_id:project,version_no:1,title:status+' test',description:'Test',governorate_id:gov,status});
 const request=await insert('project_requests',{project_id:project});
 const requestVersion=await insert('project_request_versions',{request_id:request,project_id:project,version_no:1,trade_id:trade,title:status+' lot',scope:'Test'});
 await insert('project_version_requests',{project_id:project,project_version_id:version,request_version_id:requestVersion});
 nonDraftWithdrawal.push({status,request});
}
const correctionProject=await insert('projects',{client_id:U.clientA});
const rejectedProjectVersion=await insert('project_versions',{project_id:correctionProject,version_no:1,title:'Rejected version',description:'Test',governorate_id:gov,status:'rejected'});
const correctionRequest=await insert('project_requests',{project_id:correctionProject});
const rejectedRequestVersion=await insert('project_request_versions',{request_id:correctionRequest,project_id:correctionProject,version_no:1,trade_id:trade,title:'Rejected lot',scope:'Test'});
await insert('project_version_requests',{project_id:correctionProject,project_version_id:rejectedProjectVersion,request_version_id:rejectedRequestVersion});
const publicationProject=await insert('projects',{client_id:U.clientA});
const approvedPublicationVersion=await insert('project_versions',{project_id:publicationProject,version_no:1,title:'Publication test',description:'Test',governorate_id:gov,status:'approved'});
const activePublicationRequest=await insert('project_requests',{project_id:publicationProject});
const approvedRequestSnapshot=await insert('project_request_versions',{request_id:activePublicationRequest,project_id:publicationProject,version_no:1,trade_id:trade,title:'Approved lot snapshot',scope:'Approved scope'});
const latestRequestSnapshot=await insert('project_request_versions',{request_id:activePublicationRequest,project_id:publicationProject,version_no:2,trade_id:trade,title:'Later lot edit',scope:'Later scope'});
await insert('project_version_requests',{project_id:publicationProject,project_version_id:approvedPublicationVersion,request_version_id:approvedRequestSnapshot});
const unlinkedPublicationRequest=await insert('project_requests',{project_id:publicationProject});
await insert('project_request_versions',{request_id:unlinkedPublicationRequest,project_id:publicationProject,version_no:1,trade_id:trade,title:'Unlinked lot',scope:'Test'});
const withdrawnPublicationRequest=await insert('project_requests',{project_id:publicationProject,status:'withdrawn'});
const withdrawnRequestSnapshot=await insert('project_request_versions',{request_id:withdrawnPublicationRequest,project_id:publicationProject,version_no:1,trade_id:trade,title:'Withdrawn lot',scope:'Test'});
await insert('project_version_requests',{project_id:publicationProject,project_version_id:approvedPublicationVersion,request_version_id:withdrawnRequestSnapshot});
const B={};for(const n of ['proA','proB','general']){
 const b=await insert('bids',{project_id:P,contractor_id:C[n]});const v=await insert('bid_versions',{bid_id:b,project_id:P,contractor_id:C[n],version_no:1,expires_at:'2099-01-01T00:00:00Z'});
 const items=[];for(const rq of requests)items.push(await insert('bid_items',{bid_version_id:v,project_id:P,contractor_id:C[n],request_id:rq.r,request_version_id:rq.rv,price_millimes:11500000,duration_days:15,inclusions:'Test'}));
 const g=await insert('bid_groups',{bid_version_id:v,indivisible:n==='general'});for(const it of items.slice(0,2))await insert('bid_group_items',{group_id:g,bid_version_id:v,bid_item_id:it});
 const doc=await insert('bid_documents',{bid_version_id:v,project_id:P,contractor_id:C[n],object_path:'bid/'+v+'/test.pdf',original_name:'devis.pdf',mime_type:'application/pdf',size_bytes:100,status:'approved'});
 B[n]={b,v,items,g,doc};
}
async function as(n,fn){await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${U[n]}',false);`);try{return await fn()}finally{await db.exec('reset role;')}}
async function rows(t,id){return (await db.query(`select * from public.${t} where id=$1`,[id])).rows.length}
for(const n of ['proA','proB']){const other=n==='proA'?'proB':'proA';for(const [t,id] of [['bids',B[other].b],['bid_versions',B[other].v],['bid_items',B[other].items[0]],['bid_groups',B[other].g],['bid_documents',B[other].doc]])await test(n+' cannot read competing draft '+t,()=>as(n,async()=>eq(await rows(t,id),0)));}
await test('client cannot discover draft bid',()=>as('clientA',async()=>eq(await rows('bids',B.proA.b),0)));
await test('client cannot see draft items',()=>as('clientA',async()=>eq(await rows('bid_items',B.proA.items[0]),0)));
await db.exec(`update public.bid_versions set status='submitted',submitted_at=now() where id in ('${B.proA.v}','${B.proB.v}','${B.general.v}')`);
for(const n of ['proA','proB']){const other=n==='proA'?'proB':'proA';for(const [t,id] of [['bids',B[other].b],['bid_versions',B[other].v],['bid_items',B[other].items[0]],['bid_groups',B[other].g],['bid_documents',B[other].doc]])await test(n+' cannot read competing submitted '+t,()=>as(n,async()=>eq(await rows(t,id),0)));}
for(const n of ['clientA','proA','admin'])await test(n+' reads authorized submitted items',()=>as(n,async()=>eq(await rows('bid_items',B.proA.items[0]),1)));
for(const n of ['clientB','proA','proB','general'])for(const [t,id] of [['project_reviews',rev],['ai_proposals',proposal]])await test(n+' cannot read '+t,()=>as(n,async()=>eq(await rows(t,id),0)));
await test('bid group children follow own version only',()=>as('proA',async()=>{const r=await db.query('select distinct bid_version_id from public.bid_group_items');eq(r.rows.length,1);eq(r.rows[0].bid_version_id,B.proA.v)}));
await test('direct authenticated write denied',()=>as('proA',()=>denied(`update public.bid_items set price_millimes=1 where id='${B.proB.items[0]}'`,'42501')));
await test('submitted content immutable even privileged',()=>denied(`update public.bid_items set price_millimes=1 where id='${B.proA.items[0]}'`,'23514'));
await test('submitted timestamp cannot be erased',()=>denied(`update public.bid_versions set status='draft',submitted_at=null where id='${B.proA.v}'`,'23514'));
await test('dual roles one user',async()=>{const r=await db.query('select count(*)::int as n from public.user_roles where user_id=$1',[U.proA]);eq(r.rows[0].n,2)});
await test('client can withdraw an open request while the project version is draft',()=>as('clientA',async()=>{
 await db.query('select public.withdraw_project_request($1)',[withdrawalRequests[0].request]);
 const request=await db.query('select status from public.project_requests where id=$1',[withdrawalRequests[0].request]);eq(request.rows[0].status,'withdrawn');
 const link=await db.query('select id from public.project_version_requests where project_version_id=$1 and request_version_id=$2',[withdrawalProjectVersion,withdrawalRequests[0].requestVersion]);eq(link.rows.length,0);
}));
await test('project review submission still requires and preserves an open request',()=>as('clientA',async()=>{
 const submitted=await db.query('select (public.submit_project_for_review($1)).status as status',[withdrawalProject]);eq(submitted.rows[0].status,'client_review');
 const request=await db.query('select status from public.project_requests where id=$1',[withdrawalRequests[1].request]);eq(request.rows[0].status,'open');
}));
await test('client cannot withdraw a request after the project version leaves draft',()=>as('clientA',()=>denied(`select public.withdraw_project_request('${withdrawalRequests[1].request}')`,'23514')));
await test('withdrawal after review leaves the request active and linked',async()=>{
 const request=await db.query('select status from public.project_requests where id=$1',[withdrawalRequests[1].request]);eq(request.rows[0].status,'open');
 const link=await db.query('select id from public.project_version_requests where project_version_id=$1 and request_version_id=$2',[withdrawalProjectVersion,withdrawalRequests[1].requestVersion]);eq(link.rows.length,1);
});
await test('withdrawal cannot use an older draft when the latest project version is in review',()=>as('clientA',()=>denied(`select public.withdraw_project_request('${staleDraftRequest}')`,'23514')));
await test('withdrawal is refused in client_review, dao_review, and approved',()=>as('clientA',async()=>{
 for(const item of nonDraftWithdrawal)await denied(`select public.withdraw_project_request('${item.request}')`,'23514');
}));
await test('older-draft requests remain active and linked after rejected commands',async()=>{
 const request=await db.query('select status from public.project_requests where id=$1',[staleDraftRequest]);eq(request.rows[0].status,'open');
 const link=await db.query('select id from public.project_version_requests where project_version_id=$1 and request_version_id=$2',[staleDraftVersion,staleDraftRequestVersion]);eq(link.rows.length,1);
});
await test('correction creates an editable draft and restores lot update and withdrawal',()=>as('clientA',async()=>{
 const corrected=await db.query('select (public.create_project_correction($1)).id as id',[correctionProject]);const draftId=corrected.rows[0].id;
 const draft=await db.query('select status,version_no from public.project_versions where id=$1',[draftId]);eq(draft.rows[0].status,'draft');eq(draft.rows[0].version_no,2);
 const updated=await db.query('select (public.update_project_request($1,$2,$3,$4,$5)).version_no as version_no',[correctionRequest,trade,'Corrected lot','Corrected scope',12000000]);eq(updated.rows[0].version_no,2);
 const withdrawn=await db.query('select (public.withdraw_project_request($1)).status as status',[correctionRequest]);eq(withdrawn.rows[0].status,'withdrawn');
 const currentLink=await db.query('select id from public.project_version_requests where project_version_id=$1',[draftId]);eq(currentLink.rows.length,0);
 const historyLink=await db.query('select id from public.project_version_requests where project_version_id=$1',[rejectedProjectVersion]);eq(historyLink.rows.length,1);
}));
await test('publication rejects empty, null, duplicate, inactive, and unlinked request selections',()=>as('admin',async()=>{
 const project=publicationProject, active=activePublicationRequest, unlinked=unlinkedPublicationRequest, withdrawn=withdrawnPublicationRequest;
 await denied(`select public.publish_project('${project}','public',null,null,null)`,'23514');
 await denied(`select public.publish_project('${project}','public',array[]::uuid[],null,null)`,'23514');
 await denied(`select public.publish_project('${project}','public',array[null]::uuid[],null,null)`,'23514');
 await denied(`select public.publish_project('${project}','public',array['${active}','${active}']::uuid[],null,null)`,'23514');
 await denied(`select public.publish_project('${project}','public',array['${unlinked}']::uuid[],null,null)`,'23514');
 await denied(`select public.publish_project('${project}','public',array['${randomUUID()}']::uuid[],null,null)`,'23514');
 await denied(`select public.publish_project('${project}','public',array['${requests[0].r}']::uuid[],null,null)`,'23514');
 await denied(`select public.publish_project('${project}','public',array['${withdrawn}']::uuid[],null,null)`,'23514');
 await denied(`select public.publish_project('${project}','public',array['${active}','${unlinked}']::uuid[],null,null)`,'23514');
}));
await test('invalid publication selection creates no partial publication',async()=>{
 const publications=await db.query('select id from public.publications where project_id=$1',[publicationProject]);eq(publications.rows.length,0);
});
await test('publication uses the exact lot snapshot attached to the approved project version',()=>as('admin',async()=>{
 await db.query('select public.publish_project($1,$2,$3::uuid[],$4::uuid[],$5)',[publicationProject,'public',[activePublicationRequest],null,null]);
}));
await test('publication keeps the approved snapshot instead of a later lot version',async()=>{
 const publication=await db.query('select id from public.publications where project_id=$1',[publicationProject]);eq(publication.rows.length,1);
 const publishedRequest=await db.query('select request_version_id from public.publication_requests where publication_id=$1',[publication.rows[0].id]);eq(publishedRequest.rows.length,1);eq(publishedRequest.rows[0].request_version_id,approvedRequestSnapshot);eq(publishedRequest.rows[0].request_version_id===latestRequestSnapshot,false);
});
const A=await insert('awards',{project_id:P,contractor_id:C.proA});const A2=await insert('awards',{project_id:P,contractor_id:C.proB});const AQ=await insert('awards',{project_id:Q,contractor_id:C.proA});const AG=await insert('awards',{project_id:P,contractor_id:C.general});
function awardSql(a,c,i,request,proj=P){return `insert into public.award_items(award_id,project_id,contractor_id,request_id,bid_item_id,agreed_millimes) values('${a}','${proj}','${c}','${request}','${i}',11500000)`}
await test('cross contractor award rejected by FK',()=>denied(awardSql(A,C.proA,B.proB.items[0],requests[0].r),'23503'));
await test('cross project award rejected by FK',()=>denied(awardSql(AQ,C.proA,B.proA.items[0],requests[0].r,Q),'23503'));
await test('cross request award rejected by FK',()=>denied(awardSql(A,C.proA,B.proA.items[0],requests[1].r),'23503'));
await test('indivisible partial group rejected',()=>denied(awardSql(AG,C.general,B.general.items[0],requests[0].r),'23514'));
await test('complete multi-request group accepted atomically',()=>db.exec('begin;'+awardSql(AG,C.general,B.general.items[0],requests[0].r)+';'+awardSql(AG,C.general,B.general.items[1],requests[1].r)+';commit;'));
await test('divisible partial offer accepted',()=>db.exec(awardSql(A,C.proA,B.proA.items[2],requests[2].r)));
await test('second active award rejected (sequential, not concurrent)',()=>denied(awardSql(A2,C.proB,B.proB.items[2],requests[2].r),'23505'));
await test('pro B cannot read award items of pro A',()=>as('proB',async()=>eq((await db.query('select * from public.award_items where award_id=$1',[A])).rows.length,0)));
await test('client B cannot read award items of client A',()=>as('clientB',async()=>eq((await db.query('select * from public.award_items where award_id=$1',[A])).rows.length,0)));
await test('private storage bucket metadata',async()=>eq((await db.query("select public from storage.buckets where id='dao-private'")).rows[0].public,false));
await db.exec("insert into storage.objects(bucket_id,name) values('dao-private','secret.pdf')");
await test('bucket read blocked despite permissive policy',()=>as('proA',async()=>eq((await db.query("select * from storage.objects where bucket_id='dao-private'")).rows.length,0)));
await test('bucket insert blocked despite permissive policy',()=>as('proA',()=>denied("insert into storage.objects(bucket_id,name) values('dao-private','attack.pdf')",'42501')));
await test('anon cannot read private bid documents',async()=>{await db.exec("set role anon; select set_config('request.jwt.claim.sub','',false)");try{await denied('select * from public.bid_documents','42501')}finally{await db.exec('reset role')}});
await test('negative surface rejected',()=>denied(`update public.projects set surface_m2=-1 where id='${P}'`,'23514'));
await test('invalid deadline rejected',()=>denied(`insert into public.publications(project_id,project_version_id,visibility,safe_title,safe_description,governorate_id,published_at,submission_deadline) values('${P}','${V}','public','Test','Test','${gov}','2026-09-20','2026-09-19')`,'23514'));
await test('generic document cannot point to bid namespace',()=>denied(`insert into public.documents(project_id,owner_id,object_path,original_name,mime_type,size_bytes) values('${P}','${U.proA}','bid/${B.proA.v}/test.pdf','test','application/pdf',100)`,'23514'));
await db.exec(`update public.bid_versions set validity='obsolete' where id='${B.proB.v}'`);
await test('obsolete offer cannot be awarded',()=>denied(awardSql(A2,C.proB,B.proB.items[3],requests[3].r),'23514'));
await db.exec(`update public.bid_versions set validity='current' where id='${B.proB.v}'`);
const portfolio=await insert('portfolio_projects',{contractor_id:C.proA,title:'Portfolio test',description:'Synthetic',status:'published'});
await test('portfolio hidden until commercial identity approved',()=>as('clientB',async()=>eq(await rows('portfolio_projects',portfolio),0)));
await db.exec(`update public.contractor_profiles set public_identity_status='approved' where id='${C.proA}'`);
await test('approved public portfolio visible',()=>as('clientB',async()=>eq(await rows('portfolio_projects',portfolio),1)));
const asset=await insert('portfolio_assets',{portfolio_project_id:portfolio,contractor_id:C.proA,object_path:'portfolio/'+portfolio+'/asset.jpg',mime_type:'image/jpeg',size_bytes:100});
await test('quarantined portfolio asset hidden',()=>as('clientB',async()=>eq(await rows('portfolio_assets',asset),0)));
await db.exec(`update public.portfolio_assets set status='approved' where id='${asset}'`);
await test('approved portfolio asset visible',()=>as('clientB',async()=>eq(await rows('portfolio_assets',asset),1)));
writeFileSync(new URL('./local-results.json',import.meta.url),JSON.stringify({engine:'PGlite PostgreSQL WASM',auth:'Simulated SQL sub claims; NO real JWT, NO Supabase Auth or HTTP gateway',concurrency:'NOT tested with independent sessions',fixtures:'Synthetic local only, not verified geographic seed',results,passed:results.filter(x=>x.result==='PASS').length,failed:fails},null,2));
console.log(JSON.stringify({passed:results.length-fails,failed:fails,failures:results.filter(x=>x.result==='FAIL')}));await db.close();process.exitCode=fails?1:0;
