import test from 'node:test';
import assert from 'node:assert/strict';
import { QuotePdfService } from '../src/services/QuotePdfService.js';
import { DocumentService } from '../src/services/DocumentService.js';

test('structured quote export is a private PDF with reconciled TND details',async()=>{
  const db={from(table:string){const rows:any={
    bid_versions:{id:'v',project_id:'chantier-1',version_no:2,submitted_at:'2026-10-19T00:00:00Z',quote_valid_until:'2026-11-19',quote_terms:'Garantie annoncée',material_references:'Cuivre certifié',contractor_profiles:{business_name:'Électricité & Bâtiment'}},
    bid_items:[{id:'i',price_millimes:1000,duration_days:2,inclusions:'Pose et essais',exclusions:null,project_request_versions:{title:'Plomberie',scope:'Rénovation complète'}}],
    bid_quote_lines:[{bid_item_id:'i',position:1,designation:'Tube cuivre renforcé',unit:'m',quantity_milli:2500,unit_price_millimes:400,total_millimes:1000}],
  };const chain:any={select:()=>chain,eq:()=>chain,in:()=>chain,order:()=>chain,single:async()=>({data:rows[table],error:null}),then:(resolve:any)=>resolve({data:rows[table],error:null})};return chain;}};
  const result=await new QuotePdfService(db).export('v');
  assert.equal(new TextDecoder().decode(result.bytes.slice(0,8)),'%PDF-1.4');
  const source=new TextDecoder('windows-1252').decode(result.bytes);
  assert.match(source,/Tube cuivre renforcé/);
  assert.match(source,/Montant proposé du lot/);
  assert.match(source,/1\.000 TND/);
  assert.match(source,/Électricité & Bâtiment/);
  assert.match(source,/Document informatif/);
  assert.match(source,/\/Encoding \/WinAnsiEncoding/);
  assert.equal(result.filename,'devis-dao-v2.pdf');
});

test('professional quote PDF paginates every detailed line, repeats table headers and keeps two lots',async()=>{
  const lines=Array.from({length:72},(_,index)=>({
    bid_item_id:index<60?'lot-a':'lot-b',position:index+1,
    designation:`POSTE-${String(index+1).padStart(3,'0')} câble électrique avec désignation détaillée`,
    unit:'u',quantity_milli:1000,unit_price_millimes:1250,total_millimes:1250,
  }));
  const rows:any={
    bid_versions:{id:'version-longue',project_id:'chantier-synthetique',version_no:7,submitted_at:'2026-10-21T10:00:00Z',quote_valid_until:'2026-12-01',quote_terms:'Garantie pièces et main-d’œuvre',material_references:'Références CE',contractor_profiles:{business_name:'Société Électricité Générale'}},
    bid_items:[
      {id:'lot-a',price_millimes:75000,duration_days:12,inclusions:'Fourniture, pose et essais',exclusions:'Peinture',project_request_versions:{title:'Électricité',scope:'Installation du rez-de-chaussée'}},
      {id:'lot-b',price_millimes:15000,duration_days:3,inclusions:'Mise en service',exclusions:null,project_request_versions:{title:'Tableau principal',scope:'Raccordement et contrôles'}},
    ],
    bid_quote_lines:lines,
  };
  const db={from(table:string){const chain:any={select:()=>chain,eq:()=>chain,in:()=>chain,order:()=>chain,single:async()=>({data:rows[table],error:null}),then:(resolve:any)=>resolve({data:rows[table],error:null})};return chain;}};
  const result=await new QuotePdfService(db).export('version-longue');
  const source=new TextDecoder('windows-1252').decode(result.bytes);
  for(let index=1;index<=72;index++)assert.match(source,new RegExp(`POSTE-${String(index).padStart(3,'0')}`));
  const count=Number(source.match(/\/Type \/Pages \/Kids \[[^\]]+\] \/Count (\d+)/)?.[1]);
  assert.ok(count>=3,`expected a multi-page PDF, got ${count} page(s)`);
  assert.ok((source.match(/\(Désignation\) Tj/g)||[]).length>=count);
  assert.match(source,/Lot 1 .* Électricité/);
  assert.match(source,/Lot 2 .* Tableau principal/);
  assert.match(source,/Montant total proposé/);
  assert.match(source,/90\.000 TND/);
  assert.match(source,new RegExp(`\\(Page ${count} / ${count}\\) Tj`));
});

test('quote upload completion rejects bytes that only claim the PDF MIME type',async()=>{
  let removed=false,deleted=false;
  const db:any={from:()=>({select:()=>({eq:()=>({single:async()=>({data:{id:'d',status:'quarantined',object_path:'bid/v/f.pdf',size_bytes:4},error:null})})})}),rpc:async(name:string)=>{if(name==='delete_owned_bid_quote_document')deleted=true;return {data:{},error:null}}};
  const storage:any={from:()=>({download:async()=>({data:new Blob(['nope'],{type:'application/pdf'}),error:null}),remove:async()=>{removed=true;return {error:null}}})};
  await assert.rejects(()=>new DocumentService(db,storage).completeBidQuoteUpload('actor','d'),(error:any)=>error.code==='INVALID_PDF');
  assert.equal(removed,true);assert.equal(deleted,true);
});
