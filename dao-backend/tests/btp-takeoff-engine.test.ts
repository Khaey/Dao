import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTakeoff } from '../src/btp-takeoff/engine.js';
import type { TakeoffTemplate } from '../src/btp-takeoff/contract.js';
import { BtpTakeoffService } from '../src/services/BtpTakeoffService.js';
import { createBtpTakeoffHandler } from '../src/server/btpTakeoffHandler.js';

const P='11111111-1111-4111-8111-111111111111';
const W='22222222-2222-4222-8222-222222222222';
const T='33333333-3333-4333-8333-333333333333';
const V='44444444-4444-4444-8444-444444444444';
const source={kind:'manual' as const,reference:'Mesure confirmée sur site'};
function template(required:string[],formulaAst:Record<string,unknown>,outputUnitCode:TakeoffTemplate['outputUnitCode'],roundingScale=2):TakeoffTemplate {
  return {catalogVersionId:V,catalogVersionCode:'TN-2026.1',workId:W,workCode:'work',workLabel:'Ouvrage',templateId:T,
    outputUnitCode,inputSchema:{required,properties:Object.fromEntries(required.map(key=>[key,{type:'number',minimum:0}]))},
    formulaAst,roundingScale,assumptions:['Aucune valeur par défaut.'],sourceRef:'DAO test'};
}

test('deterministic engine calculates areas, volumes, lengths and counts with exact conversions',()=>{
  const area=evaluateTakeoff(template(['length_m','width_m'],{op:'multiply',args:['length_m','width_m']},'m2'),{
    length_m:{value:'1000',unit:'cm',source},width_m:{value:'6000',unit:'mm',source}});
  assert.deepEqual(area.result,{value:'60',unit:'m2',roundingScale:2});
  assert.equal(area.rawResult,'60');
  assert.deepEqual(area.steps[0],{op:'convert',field:'length_m',from:{value:'1000',unit:'cm'},to:{value:'10',unit:'m'},source});
  const volume=evaluateTakeoff(template(['length_m','width_m','depth_m'],{op:'multiply',args:['length_m','width_m','depth_m']},'m3',3),{
    length_m:{value:'10',unit:'m',source},width_m:{value:'60',unit:'cm',source},depth_m:{value:'400',unit:'mm',source}});
  assert.deepEqual(volume.result,{value:'2.4',unit:'m3',roundingScale:3});
  const identity=evaluateTakeoff(template(['surface_area_m2'],{op:'identity',arg:'surface_area_m2'},'m2'),{
    surface_area_m2:{value:'250000',unit:'cm2',source}});
  assert.equal(identity.result?.value,'25');
  const count=evaluateTakeoff(template(['fixture_count'],{op:'identity',arg:'fixture_count'},'unit',0),{
    fixture_count:{value:'3',unit:'unit',source}});
  assert.equal(count.result?.value,'3');
});
test('masonry deduction is exact and refuses negative or dimensionally incompatible results',()=>{
  const masonry=template(['wall_length_m','wall_height_m','openings_area_m2'],{op:'subtract',args:[{op:'multiply',args:['wall_length_m','wall_height_m']},'openings_area_m2']},'m2');
  delete masonry.inputSchema.properties; // Mirrors the published #541 seed.
  const result=evaluateTakeoff(masonry,{wall_length_m:{value:'12.5',unit:'m',source},wall_height_m:{value:'2.8',unit:'m',source},openings_area_m2:{value:'5.25',unit:'m2',source}});
  assert.equal(result.result?.value,'29.75');
  assert.throws(()=>evaluateTakeoff(masonry,{wall_length_m:{value:'1',unit:'m',source},wall_height_m:{value:'1',unit:'m',source},openings_area_m2:{value:'2',unit:'m2',source}}),/Déduction supérieure/);
  assert.throws(()=>evaluateTakeoff(masonry,{wall_length_m:{value:'1',unit:'m2',source},wall_height_m:{value:'1',unit:'m',source},openings_area_m2:{value:'0',unit:'m2',source}}),/Unité incompatible/);
});

test('missing data returns targeted questions and never invents a quantity',()=>{
  const result=evaluateTakeoff(template(['length_m','width_m'],{op:'multiply',args:['length_m','width_m']},'m2'),{
    length_m:{value:'10',unit:'m',source}});
  assert.equal(result.status,'insufficient_data');
  assert.deepEqual(result.missingFields,['width_m']);
  assert.match(result.questions[0],/width_m.*m.*provenance/);
  assert.equal(result.result,undefined);
});

test('input validation rejects unknown fields, excessive precision and missing provenance',()=>{
  const t=template(['length_m'],{op:'identity',arg:'length_m'},'m');
  assert.throws(()=>evaluateTakeoff(t,{other_m:{value:'1',unit:'m',source}}),/non supportée/);
  assert.throws(()=>evaluateTakeoff(t,{length_m:{value:'1.1234567',unit:'m',source}}),/Valeur/);
  assert.throws(()=>evaluateTakeoff(t,{length_m:{value:'1',unit:'m',source:{kind:'manual',reference:''}}}),/Entrée invalide/);
});

test('service normalizes inputs, calls only allowlisted RPCs and handler enforces JWT',async()=>{
  const calls:Array<{name:string,args:any}>=[];
  const tpl=template(['length_m','width_m'],{op:'multiply',args:['length_m','width_m']},'m2');
  const db={rpc:async(name:string,args:any)=>{calls.push({name,args});return name==='btp_takeoff_template_v1'?{data:tpl,error:null}:{data:{id:'takeoff',currentRevision:1},error:null};}};
  const service=new BtpTakeoffService(db);
  const I='a4c7e5c2-6a54-4d7f-9b8e-1f2a3b4c5d6e';
  // #577 : sans occurrence d'ouvrage du chantier, un nouveau métré est refusé avant tout appel.
  await assert.rejects(()=>service.command({action:'calculate',project_id:P,work_id:W,scope_key:'x1',label:'Sans occurrence',inputs:{},idempotency_key:'takeoff-noitem-001'}),/work_item_id requis/);
  assert.equal(calls.length,0);
  const input={action:'calculate',project_id:P,work_id:W,work_item_id:I,scope_key:'terrasse-principale',label:'Terrasse principale',
    inputs:{length_m:{value:'10',unit:'m',source},width_m:{value:'6',unit:'m',source}},idempotency_key:'takeoff-calc-001'};
  const result=await service.command(input);
  assert.equal(result.evaluation.result.value,'60');
  assert.deepEqual(calls.map(call=>call.name),['btp_takeoff_template_v1','btp_takeoff_command_v1']);
  assert.equal(calls[1].args.p_input.canonicalInputs.length_m.value,'10');
  assert.equal(calls[1].args.p_input.workItemId,I);
  // #577 (07/11/2026) : métré d'exécution par son propre point d'entrée ; type inconnu refusé avant tout appel.
  await service.command({...input,kind:'execution',idempotency_key:'takeoff-exec-001'});
  assert.equal(calls.at(-1)!.name,'btp_execution_takeoff_command_v1');
  await service.command({action:'submit',kind:'execution',takeoff_id:I,expected_revision:1,idempotency_key:'takeoff-exec-002'});
  assert.equal(calls.at(-1)!.name,'btp_execution_takeoff_command_v1');
  const before=calls.length;
  await assert.rejects(()=>service.command({...input,kind:'invoice',idempotency_key:'takeoff-exec-003'}),/Type de métré invalide/);
  assert.equal(calls.length,before);
  const api=createBtpTakeoffHandler(service,async auth=>auth==='Bearer valid'?{id:'actor'}:null);
  assert.equal((await api(new Request(`https://dao.test/api/btp/takeoffs?project_id=${P}`))).status,401);
  const response=await api(new Request('https://dao.test/api/btp/takeoffs',{method:'POST',headers:{authorization:'Bearer valid'},body:JSON.stringify(input)}));
  assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'private, no-store');
});
