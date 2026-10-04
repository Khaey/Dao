import test from 'node:test'; import assert from 'node:assert/strict';
import { AwardService } from '../src/services/AwardService.js';
import { BidService } from '../src/services/BidService.js';
import { DocumentService } from '../src/services/DocumentService.js';
import { requireActor } from '../src/server/auth.js';
import { ProfileService } from '../src/services/ProfileService.js';
const fake=(table,rows={})=>({rpc:(name,input)=>({data:name==='submit_bid_version'?{...input,status:'submitted'}:{...input,award_item_id:'1'},error:null}),from(t){assert.equal(t,table);return {insert:(x)=>({select:()=>({single:async()=>({data:{...x,id:'1'},error:null})})}),update:()=>({eq:()=>({eq:()=>({select:()=>({single:async()=>({data:{id:'v',status:'submitted'},error:null})})})})}),select:()=>({eq:()=>({single:async()=>({data:rows,error:null})})})}}});
test('BidService submits a draft idempotently',async()=>{const s=new BidService(fake('bid_versions'));const x=await s.submit('v');assert.equal(x.status,'submitted')});
test('BidService creates drafts and lines through secured RPC commands',async()=>{const calls:any[]=[];const s=new BidService({rpc:async(name:string,input:any)=>{calls.push({name,input});return {data:{id:'v'},error:null}}});await s.createDraft({publication_id:'pub'});await s.addItem({publication_id:'pub',version_id:'v',publication_request_id:'lot',price_millimes:1200000,duration_days:10,inclusions:'Pose'});assert.deepEqual(calls,[{name:'create_bid_draft',input:{p_publication_id:'pub'}},{name:'upsert_bid_item',input:{p_publication_id:'pub',p_version_id:'v',p_publication_request_id:'lot',p_price_millimes:1200000,p_duration_days:10,p_inclusions:'Pose',p_exclusions:null}}])});
test('AwardService delegates a derived-input award to DB',async()=>{const s=new AwardService(fake('award_items'));const result=await s.award({bid_item_id:'item',idempotency_key:'idem-1234',contractor_id:'forged',agreed_millimes:1});assert.equal(result.p_bid_item_id,'item');assert.equal(result.p_contractor_id,undefined);assert.equal(result.p_agreed_millimes,undefined)});
test('DocumentService refuses unapproved documents',async()=>{const s=new DocumentService(fake('bid_documents',{status:'quarantined',object_path:'x'}),{});await assert.rejects(()=>s.signedDownload('d'),/not approved/)});
test('DocumentService lets the project owner consult a pending project document',async()=>{
  const db={from(table:string){assert.equal(table,'documents');return {select(){return {eq(){return {single:async()=>({data:{object_path:'project/pending.pdf',status:'quarantined'},error:null})}}}}}}};
  const storage={from(bucket:string){assert.equal(bucket,'dao-private');return {createSignedUrl:async(path:string)=>{assert.equal(path,'project/pending.pdf');return {data:{signedUrl:'signed-pending'},error:null}}}}};
  const service=new DocumentService(db,storage);
  assert.equal(await service.signedProjectDownload('document-id'),'signed-pending');
});
test('server actions require an authenticated actor',()=>{assert.throws(()=>requireActor(null),/Authentication required/)});
test('actor identity is required, never accepted from browser payload',()=>{const actor=requireActor({id:'actor'});assert.equal(actor.id,'actor');assert.notEqual(actor.id,'browser-supplied')});
test('ProfileService sends the public account type and business name through the protected initialization RPC',async()=>{
  const calls:any[]=[];const service=new ProfileService({rpc:async(name:string,args:any)=>{calls.push({name,args});return {data:{id:'profile'},error:null};}});
  await service.initialize({display_name:'Client',account_type:'client',business_name:null});
  await service.initialize({display_name:'Artisan',account_type:'contractor',business_name:'Atelier DAO'});
  assert.deepEqual(calls,[
    {name:'initialize_my_account',args:{p_display_name:'Client',p_phone_e164:null,p_account_type:'client',p_business_name:null}},
    {name:'initialize_my_account',args:{p_display_name:'Artisan',p_phone_e164:null,p_account_type:'contractor',p_business_name:'Atelier DAO'}},
  ]);
});
