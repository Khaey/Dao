import test from 'node:test';
import assert from 'node:assert/strict';
import { QuotePdfService } from '../src/services/QuotePdfService.js';
import { DocumentService } from '../src/services/DocumentService.js';

test('structured quote export is a private PDF with reconciled TND details',async()=>{
  const db={from(table:string){const rows:any={
    bid_versions:{id:'v',version_no:2,submitted_at:'2026-10-19T00:00:00Z',quote_valid_until:'2026-11-19',quote_terms:'Garantie annoncee',material_references:'Cuivre',contractor_profiles:{business_name:'Atelier Test'}},
    bid_items:[{id:'i',price_millimes:1000,duration_days:2,inclusions:'Pose',exclusions:null,project_request_versions:{title:'Plomberie'}}],
    bid_quote_lines:[{bid_item_id:'i',position:1,designation:'Tube',unit:'m',quantity_milli:2500,unit_price_millimes:400,total_millimes:1000}],
  };const chain:any={select:()=>chain,eq:()=>chain,in:()=>chain,order:()=>chain,single:async()=>({data:rows[table],error:null}),then:(resolve:any)=>resolve({data:rows[table],error:null})};return chain;}};
  const result=await new QuotePdfService(db).export('v');
  assert.equal(new TextDecoder().decode(result.bytes.slice(0,8)),'%PDF-1.4');
  assert.match(new TextDecoder().decode(result.bytes),/Tube.*2\.5 m x 0\.400 TND = 1\.000 TND/);
  assert.equal(result.filename,'devis-dao-v2.pdf');
});

test('quote upload completion rejects bytes that only claim the PDF MIME type',async()=>{
  let removed=false,deleted=false;
  const db:any={from:()=>({select:()=>({eq:()=>({single:async()=>({data:{id:'d',status:'quarantined',object_path:'bid/v/f.pdf',size_bytes:4},error:null})})})}),rpc:async(name:string)=>{if(name==='delete_owned_bid_quote_document')deleted=true;return {data:{},error:null}}};
  const storage:any={from:()=>({download:async()=>({data:new Blob(['nope'],{type:'application/pdf'}),error:null}),remove:async()=>{removed=true;return {error:null}}})};
  await assert.rejects(()=>new DocumentService(db,storage).completeBidQuoteUpload('actor','d'),(error:any)=>error.code==='INVALID_PDF');
  assert.equal(removed,true);assert.equal(deleted,true);
});
