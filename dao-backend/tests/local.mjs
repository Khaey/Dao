import { backofficeCases } from './backoffice-cases.mjs';
import { professionalCases } from './professional-cases.mjs';
import { awardLifecycleCases } from './award-lifecycle-cases.mjs';
import { projectAssistantCases, projectAssistantRealReferentialCases } from './project-assistant-cases.mjs';
import { btpAdminCases } from './btp-admin-cases.mjs';
import { btpEstimateCases } from './btp-estimate-cases.mjs';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const db=new PGlite();const results=[];let fails=0;
async function test(name,fn){try{await fn();results.push({name,result:'PASS'});}catch(e){results.push({name,result:'FAIL',code:e.code,message:e.message});fails++;}}
function eq(a,b){if(a!==b)throw Error(`Expected ${b}, received ${a}`)}
async function denied(sql,code){try{await db.exec(sql)}catch(e){eq(e.code,code);return}throw Error('Unexpected success')}
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;
create schema storage; create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated;grant select,insert,update,delete on storage.objects to anon,authenticated;create policy test_broad_policy on storage.objects for all to anon,authenticated using(true) with check(true); create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
for(const f of readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(f=>!f.startsWith('20261028000000_provider_secret_vault_bridge') && !f.startsWith('20261028100000_provider_connection_secret_binding')).sort())await test('migration '+f,()=>db.exec(readFileSync(new URL('../supabase/migrations/'+f,import.meta.url),'utf8')));
if(fails)throw Error(JSON.stringify(results));
// PGlite does not create Supabase CLI's migration ledger; this metadata-only
// fixture lets the shared schema contract validate the actual DAO migrations.
await db.exec('create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key);');
for(const f of readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())await db.query('insert into supabase_migrations.schema_migrations(version) values($1)',[f.split('_',1)[0]]);
await db.exec(readFileSync(new URL('../supabase/seed.sql',import.meta.url),'utf8'));
await test('bid sub-lots contract (#325)',async()=>{await db.exec('begin');try{await db.exec(readFileSync(new URL('./bid-sub-lots-contract.sql',import.meta.url),'utf8'));}finally{await db.exec('rollback');}});
await test('project plan contract (#325 B)',async()=>{await db.exec('begin');try{await db.exec(readFileSync(new URL('./project-plan-contract.sql',import.meta.url),'utf8'));}finally{await db.exec('rollback');}});
await test('shared fresh-database schema contract',()=>db.exec(readFileSync(new URL('./schema-contract.sql',import.meta.url),'utf8')));
await test('contract preparation configuration and trigger contract',()=>db.exec(readFileSync(new URL('./contract-preparation-contract.sql',import.meta.url),'utf8')));
await test('technical RFI schema and grants contract',()=>db.exec(readFileSync(new URL('./technical-rfi-contract.sql',import.meta.url),'utf8')));
await test('add_project_request overloads resolve at exact four- and five-argument arities',async()=>{
 const functions=(await db.query(`select n.nspname as schema_name,p.pronargs::int as argument_count,p.pronargdefaults::int as default_count
 ,pg_get_userbyid(p.proowner) as owner,p.prosecdef as security_definer,p.proconfig as config,p.proacl::text as acl
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','dao_private') and p.proname='add_project_request'
 order by n.nspname,p.pronargs`)).rows;
 eq(functions.length,4);
 eq(JSON.stringify(functions.map(fn=>`${fn.schema_name}:${Number(fn.argument_count)}`).sort()),JSON.stringify(['dao_private:4','dao_private:5','public:4','public:5']));
 for(const fn of functions){
  eq(Number(fn.default_count),0);eq(fn.owner,'postgres');eq(fn.security_definer,true);
  eq(JSON.stringify(fn.config),JSON.stringify(['search_path=""']));
  eq(fn.acl,'{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}');
 }
 const calls=[
  `select dao_private.add_project_request(NULL::uuid,NULL::uuid,NULL::text,NULL::text)`,
  `select dao_private.add_project_request(NULL::uuid,NULL::uuid,NULL::text,NULL::text,NULL::bigint)`,
  `select public.add_project_request(NULL::uuid,NULL::uuid,NULL::text,NULL::text)`,
  `select public.add_project_request(NULL::uuid,NULL::uuid,NULL::text,NULL::text,NULL::bigint)`,
 ];
 for(const sql of calls)await denied(sql,'42501');
});
await test('repository RLS bootstrap matches the DEV event trigger contract',async()=>{
 const fn=(await db.query(`select n.nspname as schema_name,p.proname,p.prorettype::regtype::text as returns,p.prosecdef as security_definer,p.proconfig,p.proacl::text as acl,pg_get_userbyid(p.proowner) as owner,p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='rls_auto_enable'`)).rows;
 eq(fn.length,1);eq(fn[0].returns,'event_trigger');eq(fn[0].security_definer,true);eq(fn[0].owner,'postgres');eq(JSON.stringify(fn[0].proconfig),JSON.stringify(['search_path=pg_catalog']));eq(fn[0].acl,'{postgres=X/postgres}');
 if(!fn[0].prosrc.includes('pg_event_trigger_ddl_commands()')||!fn[0].prosrc.includes('alter table if exists %s enable row level security'))throw Error('real RLS event-trigger implementation is missing');
 const trigger=(await db.query(`select e.evtname,e.evtevent,e.evtenabled,e.evttags,n.nspname as function_schema,p.proname as function_name,pg_get_userbyid(e.evtowner) as owner from pg_event_trigger e join pg_proc p on p.oid=e.evtfoid join pg_namespace n on n.oid=p.pronamespace where e.evtname='ensure_rls'`)).rows;
 eq(trigger.length,1);eq(trigger[0].evtevent,'ddl_command_end');eq(trigger[0].evtenabled,'O');eq(JSON.stringify(trigger[0].evttags),JSON.stringify(['CREATE TABLE','CREATE TABLE AS','SELECT INTO']));eq(trigger[0].function_schema,'public');eq(trigger[0].function_name,'rls_auto_enable');eq(trigger[0].owner,'postgres');
});
await test('DAO public tables keep RLS enabled without FORCE RLS',async()=>{
 const state=(await db.query(`select count(*)::int as total,count(*) filter(where not relrowsecurity)::int as rls_disabled,count(*) filter(where relforcerowsecurity)::int as forced from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')`)).rows[0];
 eq(state.total,143);eq(state.rls_disabled,0);eq(state.forced,0);
});
await test('canonical trade seed is idempotent by code',async()=>{
 // Replay the canonical seed, preserving newer command definitions.
 const migration=readFileSync(new URL('../supabase/migrations/20260926092748_enforce_draft_withdrawal_and_approved_publication.sql',import.meta.url),'utf8');
 await db.exec(migration.slice(migration.indexOf('insert into public.trades'),migration.indexOf('create or replace function')));
 const rows=(await db.query("select code,name_fr,active,count(*) over(partition by code)::int as copies from public.trades where code in ('general_contractor','plumbing','electrical') order by code")).rows;
 eq(rows.length,3);for(const row of rows){eq(row.active,true);eq(row.copies,1);}
 eq(rows.find(row=>row.code==='general_contractor')?.name_fr,'Entreprise générale');
 eq(rows.find(row=>row.code==='plumbing')?.name_fr,'Plomberie');
 eq(rows.find(row=>row.code==='electrical')?.name_fr,'Électricité');
});
async function asCatalogReader(fn){
 await db.exec("set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000541',false);");
 try{return await fn()}finally{await db.exec("reset role;select set_config('request.jwt.claim.sub','',false);")}
}
async function catalogSnapshot(projectType){
 return asCatalogReader(async()=>{
  const result=await db.query('select public.btp_catalog_snapshot($1,$2) as value',[projectType,'TN']);
  return result.rows[0].value;
 });
}
await test('advanced BTP catalogue exposes canonical published hierarchy',async()=>{
 const snapshot=await catalogSnapshot(null);
 eq(snapshot.catalogVersion.code,'TN-2026.1');eq(snapshot.catalogVersion.countryCode,'TN');
 eq(snapshot.units.length,7);eq(snapshot.lots.length,10);eq(snapshot.rules.length,5);
 eq(snapshot.dependencies.length,5);eq(snapshot.measurementTemplates.length,5);eq(snapshot.priceSources.length,0);
 const works=snapshot.lots.flatMap(lot=>lot.subLots.flatMap(subLot=>subLot.works));
 eq(works.length,20);
 for(const work of works){
  if(!work.id||!work.code||!work.unitCode||!work.sourceRef)throw Error(`Incomplete canonical work ${work.code??'unknown'}`);
  if(!snapshot.units.some(unit=>unit.code===work.unitCode))throw Error(`Unknown unit ${work.unitCode}`);
 }
});
await test('project-type filters narrow lots and works without inventing scope',async()=>{
 const renovation=await catalogSnapshot('renovation');
 const renovationCodes=renovation.lots.flatMap(lot=>lot.subLots.flatMap(subLot=>subLot.works.map(work=>work.code)));
 const renovationIds=new Set(renovation.lots.flatMap(lot=>lot.subLots.flatMap(subLot=>subLot.works.map(work=>work.id))));
 eq(renovation.lots.some(lot=>lot.code==='btp_lot_earth_structure'),false);
 eq(renovationCodes.includes('btp_work_foundations'),false);
 eq(renovationCodes.includes('btp_work_selective_demolition'),true);
 eq(renovationCodes.includes('btp_work_existing_connections'),false);
 for(const dependency of renovation.dependencies){
  if(!renovationIds.has(dependency.predecessorWorkId)||!renovationIds.has(dependency.successorWorkId))throw Error('Filtered dependency references a hidden work');
 }
 for(const template of renovation.measurementTemplates)if(!renovationIds.has(template.workId))throw Error('Filtered measurement references a hidden work');
 const extension=await catalogSnapshot('extension');
 const extensionCodes=extension.lots.flatMap(lot=>lot.subLots.flatMap(subLot=>subLot.works.map(work=>work.code)));
 eq(extensionCodes.includes('btp_work_existing_connections'),true);
});
await test('measurement templates require explicit inputs and never embed defaults',async()=>{
 const snapshot=await catalogSnapshot(null);
 for(const template of snapshot.measurementTemplates){
  if(!Array.isArray(template.inputSchema.required)||template.inputSchema.required.length===0)throw Error('Measurement inputs must be explicit');
  if(JSON.stringify(template.inputSchema).includes('default'))throw Error('Measurement defaults are forbidden');
  if(!template.formulaAst?.op)throw Error('Formula AST operation is required');
  if(template.assumptions.length===0)throw Error('Measurement assumptions must be explicit');
 }
});
await test('BTP V2 is additive, versioned as an unpublished draft, and exposes generated-input metadata',async()=>{
 const draft=(await db.query(`select id,code,status,based_on_version_id
   from public.btp_catalog_versions where code='TN-2026.3'`)).rows[0];
 if(!draft)throw Error('TN-2026.3 draft is missing');
 eq(draft.status,'draft');
 const base=(await db.query('select code from public.btp_catalog_versions where id=$1',[draft.based_on_version_id])).rows[0];
 eq(base.code,'TN-2026.1');
 const counts=(await db.query(`select
   (select count(*)::int from public.btp_lots where catalog_version_id=$1) lots,
   (select count(*)::int from public.btp_sub_lots where catalog_version_id=$1) sub_lots,
   (select count(*)::int from public.btp_works where catalog_version_id=$1) works,
   (select count(*)::int from public.btp_measurement_templates where catalog_version_id=$1) templates,
   (select count(*)::int from public.btp_rules where catalog_version_id=$1) rules,
   (select count(*)::int from public.btp_work_dependencies where catalog_version_id=$1) dependencies`,[draft.id])).rows[0];
 if(counts.lots<11||counts.sub_lots<14||counts.works<29||counts.templates<14||counts.rules<8||counts.dependencies<7)throw Error('BTP V2 coverage is incomplete');
 const models=(await db.query(`select w.code,m.output_unit_code,m.input_schema
   from public.btp_measurement_templates m join public.btp_works w on w.id=m.work_id and w.catalog_version_id=m.catalog_version_id
   where m.catalog_version_id=$1 and m.active and w.code like 'btp_work_%' and w.id::text like '56110000-%'
   order by w.code`,[draft.id])).rows;
 eq(models.length,9);
 for(const model of models){
  if(!model.input_schema.required?.length||!model.input_schema['x-dao']?.support)throw Error(`Missing generated-input metadata for ${model.code}`);
  if(!model.input_schema.properties?.[model.input_schema.required[0]])throw Error(`Missing property contract for ${model.code}`);
  if(!['m','m2','unit'].includes(model.output_unit_code))throw Error(`Unexpected V2 output unit ${model.output_unit_code}`);
 }
 const published=await catalogSnapshot(null);
 eq(published.catalogVersion.code,'TN-2026.1');
 eq(published.measurementTemplates.length,5);
});
await test('advanced BTP dependencies are acyclic and never self-reference',async()=>{
 const invalid=(await db.query(`with recursive paths(origin,current,path,cycle) as (
   select predecessor_work_id,successor_work_id,array[predecessor_work_id,successor_work_id],predecessor_work_id=successor_work_id
   from public.btp_work_dependencies
   union all
   select p.origin,d.successor_work_id,p.path||d.successor_work_id,d.successor_work_id=any(p.path)
   from paths p join public.btp_work_dependencies d on d.predecessor_work_id=p.current where not p.cycle
 ) select count(*)::int as n from paths where cycle`)).rows[0].n;
 eq(invalid,0);
});
await test('catalogue is authenticated read-only and anonymous execution is denied',async()=>{
 await db.exec('set role anon');try{await denied("select public.btp_catalog_snapshot('construction','TN')",'42501')}finally{await db.exec('reset role')}
 await asCatalogReader(()=>denied("update public.btp_works set label_fr='altéré' where code='btp_work_masonry'",'42501'));
 await asCatalogReader(()=>denied("insert into public.btp_price_books(catalog_version_id,name,source_name,source_uri,country_code,currency,valid_from,verified_at,status) select id,'sans source','invalide','http://invalid','TN','TND',current_date,now(),'published' from public.btp_catalog_versions limit 1",'42501'));
});
await test('estimation scaffolding publishes no unverified price',async()=>{
 const counts=(await db.query('select (select count(*) from public.btp_price_books)::int as books,(select count(*) from public.btp_work_prices)::int as prices')).rows[0];
 eq(counts.books,0);eq(counts.prices,0);
});
await test('future prices must match catalogue version, work and canonical unit',async()=>{
 const version=(await db.query("select id from public.btp_catalog_versions where code='TN-2026.1'")).rows[0].id;
 const work=(await db.query("select id from public.btp_works where code='btp_work_masonry'")).rows[0];
 const book=randomUUID();
 await db.query("insert into public.btp_price_books(id,catalog_version_id,name,source_name,source_uri,country_code,currency,valid_from,verified_at,status) values($1,$2,'test','source','https://example.invalid/source','TN','TND',current_date,now(),'draft')",[book,version]);
 let rejected=false;
 try{await db.query("insert into public.btp_work_prices(catalog_version_id,price_book_id,work_id,unit_code,amount_minor,provenance_note) values($1,$2,$3,'m3',1000,'test')",[version,book,work.id])}
 catch(error){eq(error.code,'23503');rejected=true}
 if(!rejected)throw Error('Mismatched work unit was accepted');
});
async function insert(t,values){const v={id:randomUUID(),...values};const keys=Object.keys(v);await db.query(`insert into public.${t}(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(v));return v.id;}
const U={};for(const n of ['clientA','clientB','proA','proB','general','admin']){U[n]=randomUUID();await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[U[n],`${n.toLowerCase()}@example.invalid`]);await insert('profiles',{user_id:U[n],display_name:n});await insert('user_roles',{user_id:U[n],role:n==='admin'?'dao_admin':n.startsWith('client')?'client':'contractor'});}
await insert('user_roles',{user_id:U.proA,role:'client'});
// Synthetic local-only fixtures, explicitly NOT a verified Tunisia seed.
const gov=await insert('governorates',{code:'TEST_ONLY',name_fr:'Territoire synthétique',name_ar:'اختبار'});
const trade=await insert('trades',{code:'TEST_ONLY',name_fr:'Métier synthétique'});
const C={};for(const n of ['proA','proB','general'])C[n]=await insert('contractor_profiles',{user_id:U[n],business_name:n,public_trade_name:n,verification_status:'verified',contractor_type:n==='general'?'general_contractor':'artisan'});
for(const n of ['proA','proB','general'])await insert('contractor_trades',{contractor_id:C[n],trade_id:trade});
const P=await insert('projects',{client_id:U.clientA});const Q=await insert('projects',{client_id:U.clientB});
const V=await insert('project_versions',{project_id:P,version_no:1,title:'Test',description:'Test',governorate_id:gov});
const rev=await insert('project_reviews',{project_version_id:V,actor_id:U.clientA,actor_role:'client',decision:'approved'});
const run=await insert('ai_runs',{project_id:P,status:'succeeded',provider:'test'});const proposal=await insert('ai_proposals',{run_id:run,trade_id:trade,proposed_scope:'Test',status:'proposed'});
const requests=[];for(let i=0;i<4;i++){const r=await insert('project_requests',{project_id:P});const rv=await insert('project_request_versions',{request_id:r,project_id:P,version_no:1,trade_id:trade,title:'Test '+i,scope:'Test'});requests.push({r,rv});}
const withdrawalProject=await insert('projects',{client_id:U.clientA});
const withdrawalProjectVersion=await insert('project_versions',{project_id:withdrawalProject,version_no:1,title:'Withdrawal test',description:'Test',governorate_id:gov,status:'draft',desired_start_date:new Date(Date.now()+30*86400000).toISOString().slice(0,10),desired_end_date:new Date(Date.now()+60*86400000).toISOString().slice(0,10)});
const withdrawalRequests=[];
for(let i=0;i<2;i++){
 const request=await insert('project_requests',{project_id:withdrawalProject});
 const requestVersion=await insert('project_request_versions',{request_id:request,project_id:withdrawalProject,version_no:1,trade_id:trade,title:'Withdrawal lot '+i,scope:'Test'});
 await insert('project_version_requests',{project_id:withdrawalProject,project_version_id:withdrawalProjectVersion,request_version_id:requestVersion});
 withdrawalRequests.push({request,requestVersion});
}
const incompleteReviewProject=await insert('projects',{client_id:U.clientA});
const incompleteReviewVersion=await insert('project_versions',{project_id:incompleteReviewProject,version_no:1,title:'Incomplete review',description:'Test',governorate_id:gov,status:'draft'});
const incompleteReviewRequest=await insert('project_requests',{project_id:incompleteReviewProject});
const incompleteReviewRequestVersion=await insert('project_request_versions',{project_id:incompleteReviewProject,request_id:incompleteReviewRequest,version_no:1,trade_id:trade,title:'Incomplete dates lot',scope:'Test'});
await insert('project_version_requests',{project_id:incompleteReviewProject,project_version_id:incompleteReviewVersion,request_version_id:incompleteReviewRequestVersion});
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
const nativeSubProject=await insert('projects',{client_id:U.clientA});
const nativeSubProjectVersion=await insert('project_versions',{project_id:nativeSubProject,version_no:1,title:'Native sub-lots',description:'Test',governorate_id:gov,status:'draft'});
const nativeSubRequest=await insert('project_requests',{project_id:nativeSubProject});
const nativeSubRequestVersion=await insert('project_request_versions',{request_id:nativeSubRequest,project_id:nativeSubProject,version_no:1,trade_id:trade,title:'Lot with optional details',scope:'Test'});
await insert('project_version_requests',{project_id:nativeSubProject,project_version_id:nativeSubProjectVersion,request_version_id:nativeSubRequestVersion});
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
const takeoffProject=await insert('projects',{client_id:U.clientA});
const takeoffWork=(await db.query("select id from public.btp_works where code='btp_work_terrace'")).rows[0].id;
const takeoffCommand=(action,input,key)=>db.query('select public.btp_takeoff_command_v1($1,$2::jsonb,$3) as value',[action,JSON.stringify(input),key]);
let forecastTakeoff;
await test('forecast takeoff records insufficient data without inventing a quantity',()=>as('clientA',async()=>{
 const result=(await takeoffCommand('calculate',{projectId:takeoffProject,workId:takeoffWork,scopeKey:'terrace-main',label:'Terrasse principale',canonicalInputs:{
  length_m:{value:'10',unit:'m',source:{kind:'manual',reference:'Plan client'},original:{value:'10',unit:'m'}}
 }},'takeoff-missing-001')).rows[0].value;
 forecastTakeoff=result.id;eq(result.current.status,'insufficient_data');eq(result.current.justification.missingFields[0],'width_m');
 eq(result.current.justification.result,undefined);
}));
await test('foreign project actor cannot read or revise a forecast takeoff',()=>as('clientB',async()=>{
 await denied(`select public.btp_takeoff_snapshot_v1('${takeoffProject}','${forecastTakeoff}')`,'42501');
 await denied(`select public.btp_takeoff_command_v1('calculate','{"projectId":"${takeoffProject}","workId":"${takeoffWork}"}'::jsonb,'takeoff-denied-001')`,'42501');
}));
await test('database independently evaluates the published AST and idempotent replay',()=>as('clientA',async()=>{
 const input={projectId:takeoffProject,workId:takeoffWork,takeoffId:forecastTakeoff,expectedRevision:1,scopeKey:'terrace-main',label:'Terrasse principale',forgedResult:'999999',canonicalInputs:{
  length_m:{value:'10',unit:'m',source:{kind:'document',reference:'Plan A-12'},original:{value:'1000',unit:'cm'}},
  width_m:{value:'6',unit:'m',source:{kind:'survey',reference:'Relevé R1'},original:{value:'6000',unit:'mm'}}
 }};
 const first=(await takeoffCommand('calculate',input,'takeoff-calc-002')).rows[0].value;
 const replay=(await takeoffCommand('calculate',input,'takeoff-calc-002')).rows[0].value;
 eq(first.current.revision,2);eq(Number(first.current.justification.result.value),60);eq(first.current.justification.result.unit,'m2');
 eq(first.current.justification.conversions[0].from.value,'1000');eq(first.current.justification.conversions[0].to.value,'10');
 eq(first.current.resultSha256,replay.current.resultSha256);
 await denied(`select public.btp_takeoff_command_v1('calculate','${JSON.stringify({...input,label:'Altéré'}).replaceAll("'","''")}'::jsonb,'takeoff-calc-002')`,'22023');
}));
await test('database rejects forged normalization and duplicate scope creation',()=>as('clientA',async()=>{
 const forged={projectId:takeoffProject,workId:takeoffWork,takeoffId:forecastTakeoff,expectedRevision:2,scopeKey:'terrace-main',label:'Terrasse forgée',canonicalInputs:{
  length_m:{value:'999',unit:'m',source:{kind:'document',reference:'Plan A-12'},original:{value:'1000',unit:'cm'}},
  width_m:{value:'6',unit:'m',source:{kind:'survey',reference:'Relevé R1'},original:{value:'6000',unit:'mm'}}
 }};
 await denied(`select public.btp_takeoff_command_v1('calculate','${JSON.stringify(forged).replaceAll("'","''")}'::jsonb,'takeoff-forged-001')`,'22023');
 const duplicate={projectId:takeoffProject,workId:takeoffWork,scopeKey:'terrace-main',label:'Collision',canonicalInputs:{}};
 await denied(`select public.btp_takeoff_command_v1('calculate','${JSON.stringify(duplicate).replaceAll("'","''")}'::jsonb,'takeoff-duplicate-001')`,'23505');
}));
await test('authenticated users have no direct takeoff write grants',()=>as('clientA',()=>denied(`update public.btp_takeoffs set label='forged' where id='${forecastTakeoff}'`,'42501')));
await test('client submits and manager validates the exact current revision',async()=>{
 await as('clientA',async()=>eq((await takeoffCommand('submit',{takeoffId:forecastTakeoff,expectedRevision:2,note:'Prêt pour validation'},'takeoff-submit-001')).rows[0].value.status,'submitted'));
 await as('admin',async()=>{const result=(await takeoffCommand('validate',{takeoffId:forecastTakeoff,expectedRevision:2,note:'Dimensions vérifiées'},'takeoff-valid-001')).rows[0].value;eq(result.status,'validated');eq(result.validatedRevision,2)});
});
await test('recalculation preserves the validated result and immutable history',()=>as('clientA',async()=>{
 const result=(await takeoffCommand('calculate',{projectId:takeoffProject,workId:takeoffWork,takeoffId:forecastTakeoff,expectedRevision:2,scopeKey:'terrace-main',label:'Terrasse principale révisée',canonicalInputs:{
  length_m:{value:'11',unit:'m',source:{kind:'document',reference:'Plan A-13'},original:{value:'11',unit:'m'}},
  width_m:{value:'6',unit:'m',source:{kind:'survey',reference:'Relevé R2'},original:{value:'6',unit:'m'}}
 }},'takeoff-recalc-001')).rows[0].value;
 eq(result.currentRevision,3);eq(result.validatedRevision,2);eq(Number(result.validated.justification.result.value),60);eq(Number(result.current.justification.result.value),66);
 eq(result.history.length,3);eq(result.events.some(event=>event.type==='validation_invalidated'),true);
 await denied(`delete from public.btp_takeoff_revisions where takeoff_id='${forecastTakeoff}' and revision=1`,'42501');
}));
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
await test('dual-role workspace persists only an assigned role',()=>as('proA',async()=>{eq((await db.query("select public.set_my_workspace('contractor') as workspace")).rows[0].workspace,'contractor');eq((await db.query('select last_workspace from public.profiles where user_id=auth.uid()')).rows[0].last_workspace,'contractor');await denied("select public.set_my_workspace('dao_admin')",'42501')}));
await test('non-critical professional edits preserve verification',()=>as('proA',async()=>{await db.query(`select public.update_my_contractor_profile('proA','artisan','proA','Présentation enrichie',12,'available',null,array['${trade}']::uuid[])`);eq((await db.query('select verification_status from public.contractor_profiles where id=$1',[C.proA])).rows[0].verification_status,'verified')}));
await test('identity edits restart verification',()=>as('proA',async()=>{await db.query(`select public.update_my_contractor_profile('proA nouvelle','artisan','proA','Présentation enrichie',12,'available',null,array['${trade}']::uuid[])`);eq((await db.query('select verification_status from public.contractor_profiles where id=$1',[C.proA])).rows[0].verification_status,'pending')}));
await db.query("update public.contractor_profiles set verification_status='suspended' where id=$1",[C.proA]);
await test('professional self-edit cannot lift a DAO suspension',()=>as('proA',async()=>{await db.query(`select public.update_my_contractor_profile('proA suspendue','artisan','proA','Présentation enrichie',12,'available',null,array['${trade}']::uuid[])`);eq((await db.query('select verification_status from public.contractor_profiles where id=$1',[C.proA])).rows[0].verification_status,'suspended')}));
await db.query("update public.contractor_profiles set verification_status='verified' where id=$1",[C.proA]);
const inboxInvitation=await insert('project_invitations',{project_id:P,created_by:U.clientA,expected_role:'contractor',recipient_email:'prob@example.invalid',recipient_name:'Pro B',principal_request_id:requests[0].r,token_hash:'a'.repeat(64),expires_at:'2099-01-01T00:00:00Z'});
await test('recipient inbox is isolated and accepts without exposing a token',async()=>{await as('proA',async()=>eq((await db.query('select public.my_project_invitations() as rows')).rows[0].rows.length,0));await as('proB',async()=>{const inbox=(await db.query('select public.my_project_invitations() as rows')).rows[0].rows;eq(inbox.length,1);eq(inbox[0].id,inboxInvitation);await db.query('select public.respond_my_project_invitation($1,true)',[inboxInvitation]);const accepted=(await db.query('select public.my_project_invitations() as rows')).rows[0].rows;eq(accepted[0].status,'accepted')})});
const offerProject=await insert('projects',{client_id:U.clientA});const offerRequest=await insert('project_requests',{project_id:offerProject});const offerRequestVersion=await insert('project_request_versions',{request_id:offerRequest,project_id:offerProject,version_no:1,trade_id:trade,title:'Retrait',scope:'Test'});const offerBid=await insert('bids',{project_id:offerProject,contractor_id:C.proA});const offerVersion=await insert('bid_versions',{bid_id:offerBid,project_id:offerProject,contractor_id:C.proA,version_no:1,expires_at:'2099-01-01T00:00:00Z'});const offerItem=await insert('bid_items',{bid_version_id:offerVersion,project_id:offerProject,contractor_id:C.proA,request_id:offerRequest,request_version_id:offerRequestVersion,price_millimes:1000,duration_days:1,inclusions:'Historique'});await db.query("update public.bid_versions set status='submitted',submitted_at='2026-10-09T00:00:00Z' where id=$1",[offerVersion]);
await test('only the owner withdraws a submitted unawarded offer and content stays immutable',async()=>{await as('proB',()=>denied(`select public.withdraw_bid_version('${offerVersion}')`,'42501'));await as('proA',async()=>{await db.query('select public.withdraw_bid_version($1)',[offerVersion]);const state=(await db.query('select status,validity,withdrawn_at is not null as stamped from public.bid_versions where id=$1',[offerVersion])).rows[0];eq(state.status,'withdrawn');eq(state.validity,'obsolete');eq(state.stamped,true);eq((await db.query('select inclusions from public.bid_items where id=$1',[offerItem])).rows[0].inclusions,'Historique')});await denied(`update public.bid_items set inclusions='Muté' where id='${offerItem}'`,'23514')});
await test('client can withdraw an open request while the project version is draft',()=>as('clientA',async()=>{
 await db.query('select public.withdraw_project_request($1)',[withdrawalRequests[0].request]);
 const request=await db.query('select status from public.project_requests where id=$1',[withdrawalRequests[0].request]);eq(request.rows[0].status,'withdrawn');
 const link=await db.query('select id from public.project_version_requests where project_version_id=$1 and request_version_id=$2',[withdrawalProjectVersion,withdrawalRequests[0].requestVersion]);eq(link.rows.length,0);
}));
await test('project review submission requires both dates and preserves an open request',()=>as('clientA',async()=>{
 await denied(`select public.submit_project_for_review('${incompleteReviewProject}')`,'23514');
 const draft=await db.query('select status from public.project_versions where id=$1',[incompleteReviewVersion]);eq(draft.rows[0].status,'draft');
 const submitted=await db.query('select (public.submit_project_for_review($1)).status as status',[withdrawalProject]);eq(submitted.rows[0].status,'client_review');
 const request=await db.query('select status from public.project_requests where id=$1',[withdrawalRequests[1].request]);eq(request.rows[0].status,'open');
}));
await test('client cannot withdraw a request after the project version leaves draft',()=>as('clientA',()=>denied(`select public.withdraw_project_request('${withdrawalRequests[1].request}')`,'23514')));
await test('Client official sub-lots create immutable revisions and support reorder, edit and logical retirement',()=>as('clientA',async()=>{
 const initial=await db.query('select public.native_request_sub_lots_v1($1) as data',[nativeSubRequest]);
 eq(initial.rows[0].data.canEdit,true);eq(initial.rows[0].data.items.length,0);
 const first=await db.query('select public.replace_client_request_sub_lots_v1($1,$2,$3::jsonb) as data',[
   nativeSubRequest,nativeSubRequestVersion,JSON.stringify([
     {id:null,title:'Dépose',scope:'Retirer l’ancien équipement',budgetMillimes:null},
     {id:null,title:'Pose',scope:'Installer le nouvel équipement',budgetMillimes:'123456'},
   ]),
 ]);
 eq(first.rows[0].data.requestVersion,2);eq(first.rows[0].data.items.length,2);
 const firstItems=first.rows[0].data.items;
 const second=await db.query('select public.replace_client_request_sub_lots_v1($1,$2,$3::jsonb) as data',[
   nativeSubRequest,first.rows[0].data.requestVersionId,JSON.stringify([
     {...firstItems[1],title:'Pose finale'},
     firstItems[0],
   ]),
 ]);
 eq(second.rows[0].data.requestVersion,3);eq(second.rows[0].data.items[0].id,firstItems[1].id);
 eq(second.rows[0].data.items[0].title,'Pose finale');
 const third=await db.query('select public.replace_client_request_sub_lots_v1($1,$2,$3::jsonb) as data',[
   nativeSubRequest,second.rows[0].data.requestVersionId,JSON.stringify([second.rows[0].data.items[0]]),
 ]);
 eq(third.rows[0].data.requestVersion,4);eq(third.rows[0].data.items.length,1);
 const history=await db.query('select count(*)::int as n from public.request_sub_lot_versions where sub_lot_id=$1',[firstItems[0].id]);
 eq(history.rows[0].n,2);
 await denied(`select public.replace_client_request_sub_lots_v1('${nativeSubRequest}','${nativeSubRequestVersion}','[]'::jsonb)`,'40001');
}));
await test('another Client cannot read or mutate official sub-lots',()=>as('clientB',async()=>{
 await denied(`select public.native_request_sub_lots_v1('${nativeSubRequest}')`,'42501');
 await denied(`select public.replace_client_request_sub_lots_v1('${nativeSubRequest}','${nativeSubRequestVersion}','[]'::jsonb)`,'42501');
}));
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
const rfiPublication=(await db.query('select id from public.publications where project_id=$1',[publicationProject])).rows[0].id;
const rfiPublicationRequest=(await db.query('select id from public.publication_requests where publication_id=$1',[rfiPublication])).rows[0].id;
let rfiQuestion;
await test('eligible artisan creates one idempotent private technical question',()=>as('proA',async()=>{
 const first=(await db.query('select public.create_rfi_question($1,$2,$3) as value',[rfiPublicationRequest,'Quelle section de câble ?','rfi-create-0001'])).rows[0].value;
 const replay=(await db.query('select public.create_rfi_question($1,$2,$3) as value',[rfiPublicationRequest,'Texte ignoré','rfi-create-0001'])).rows[0].value;
 rfiQuestion=first.id;eq(replay.id,rfiQuestion);eq(first.mine,true);
}));
let pendingRfiDocument;
await test('RFI document owner can finalize only their own quarantined metadata',()=>as('proA',async()=>{
 const row=(await db.query("select (d).id,(d).owner_id,(d).status from (select public.create_rfi_document($1,null,$2,'plan.pdf','application/pdf',128) d) created",[rfiQuestion,`rfi/${rfiQuestion}/plan.pdf`])).rows[0];
 pendingRfiDocument=row.id;
 eq(row.owner_id,U.proA);eq(row.status,'quarantined');
 eq((await db.query('select id from public.technical_rfi_documents where id=$1',[pendingRfiDocument])).rows.length,1);
}));
await test('another artisan cannot observe quarantined RFI metadata',()=>as('proB',async()=>{
 eq((await db.query('select id from public.technical_rfi_documents where id=$1',[pendingRfiDocument])).rows.length,0);
}));
await test('question remains private before the official clarification',async()=>{
 await as('proB',async()=>eq((await db.query('select public.list_rfi_questions() as value')).rows[0].value.items.length,0));
 await as('clientB',async()=>eq((await db.query('select public.list_rfi_questions() as value')).rows[0].value.items.length,0));
 await as('clientA',async()=>eq((await db.query('select public.list_rfi_questions() as value')).rows[0].value.items[0].id,rfiQuestion));
});
await test('owner publishes immutable clarification versions for every eligible artisan',()=>as('clientA',async()=>{
 const first=(await db.query('select public.publish_rfi_clarification($1,$2,$3,$4) as value',[rfiQuestion,'Utiliser une section de 6 mm².',true,'rfi-answer-0001'])).rows[0].value;
 const second=(await db.query('select public.publish_rfi_clarification($1,$2,$3,$4) as value',[rfiQuestion,'Correction officielle : 10 mm².',true,'rfi-answer-0002'])).rows[0].value;
 eq(first.clarifications.length,1);eq(second.clarifications.length,2);eq(second.clarifications[0].body,'Utiliser une section de 6 mm².');eq(second.clarifications[1].version_no,2);
}));
await test('eligible competitor sees the same clarification with an anonymized author',()=>as('proB',async()=>{
 const item=(await db.query('select public.list_rfi_questions() as value')).rows[0].value.items[0];eq(item.id,rfiQuestion);eq(item.author_label,'Soumissionnaire');eq(item.clarifications.length,2);
}));
await test('unrelated client and direct authenticated mutations stay blocked',async()=>{
 await as('clientB',async()=>eq((await db.query('select * from public.technical_questions where id=$1',[rfiQuestion])).rows.length,0));
 await as('proB',()=>denied(`update public.technical_questions set body='altéré' where id='${rfiQuestion}'`,'42501'));
});
await test('suspended artisan immediately loses RFI visibility',async()=>{
 await db.query("update public.contractor_profiles set verification_status='suspended' where id=$1",[C.proB]);
 await as('proB',async()=>eq((await db.query('select public.list_rfi_questions() as value')).rows[0].value.items.length,0));
 await db.query("update public.contractor_profiles set verification_status='verified' where id=$1",[C.proB]);
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
const portfolio=await insert('portfolio_projects',{contractor_id:C.proA,title:'Portfolio test',description:'Synthetic',status:'published',publication_consent:true});
await db.query("insert into public.contractor_profile_details(contractor_id,review_status) values($1,'approved') on conflict(contractor_id) do update set review_status='approved'",[C.proA]);
await test('portfolio hidden until commercial identity approved',()=>as('clientB',async()=>eq(await rows('portfolio_projects',portfolio),0)));
await db.exec(`update public.contractor_profiles set public_identity_status='approved' where id='${C.proA}'`);
await test('approved portfolio uses public projection; direct review metadata private',()=>as('clientB',async()=>{eq(await rows('portfolio_projects',portfolio),0);eq((await db.query('select public.professional_public_profile($1,false) as p',[C.proA])).rows[0].p.portfolio[0].id,portfolio)}));
const asset=await insert('portfolio_assets',{portfolio_project_id:portfolio,contractor_id:C.proA,object_path:'portfolio/'+portfolio+'/asset.jpg',mime_type:'image/jpeg',size_bytes:100});
await test('quarantined portfolio asset hidden',()=>as('clientB',async()=>eq(await rows('portfolio_assets',asset),0)));
await db.query("update public.portfolio_assets set status='approved',public_consent=true,content_sha256=$1 where id=$2",['a'.repeat(64),asset]);
await test('approved asset uses public projection; direct Storage metadata private',()=>as('clientB',async()=>{eq(await rows('portfolio_assets',asset),0);eq((await db.query('select public.professional_public_profile($1,false) as p',[C.proA])).rows[0].p.portfolio[0].assets[0].id,asset)}));
await awardLifecycleCases(db,test);
await backofficeCases(db,test);
await professionalCases(db,test);
await projectAssistantCases(db,test,{U,gov,as});
await projectAssistantRealReferentialCases(db,test,{as});
await btpAdminCases(db,test,{as});
await btpEstimateCases(db,test,{U,P,Q,gov,as});
writeFileSync(new URL('./local-results.json',import.meta.url),JSON.stringify({engine:'PGlite PostgreSQL WASM',auth:'Simulated SQL sub claims; NO real JWT, NO Supabase Auth or HTTP gateway',concurrency:'NOT tested with independent sessions',fixtures:'Synthetic local only, not verified geographic seed',results,passed:results.filter(x=>x.result==='PASS').length,failed:fails},null,2));
console.log(JSON.stringify({passed:results.length-fails,failed:fails,failures:results.filter(x=>x.result==='FAIL')}));await db.close();process.exitCode=fails?1:0;
