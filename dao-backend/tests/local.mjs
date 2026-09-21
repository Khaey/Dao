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
for(const f of readdirSync(new URL('../migrations/',import.meta.url)).sort())await test('migration '+f,()=>db.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8')));
if(fails)throw Error(JSON.stringify(results));
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
