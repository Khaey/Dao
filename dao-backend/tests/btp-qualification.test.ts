import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTakeoff } from '../src/btp-takeoff/engine.js';
import type { TakeoffTemplate } from '../src/btp-takeoff/contract.js';
import { btpQualificationFixtures as fx } from './fixtures/btp-qualification-fixtures.js';

const source={kind:'manual' as const,reference:'TEST — dimension fournie explicitement'};
function tpl(required:string[],ast:Record<string,unknown>,unit:TakeoffTemplate['outputUnitCode']):TakeoffTemplate {
  return {catalogVersionId:'test',catalogVersionCode:'TEST',workId:'test',workCode:'test',workLabel:'TEST',templateId:'test',outputUnitCode:unit,inputSchema:{required},formulaAst:ast,roundingScale:3,assumptions:['TEST: aucune valeur implicite'],sourceRef:'TEST #566'};
}

test('#566 fixtures: surface seule refuse toute quantité',()=>{
  const out=evaluateTakeoff(tpl(['length_m','width_m'],{op:'multiply',args:['length_m','width_m']},'m2'),{length_m:{value:'180',unit:'m',source}});
  assert.equal(out.status,'insufficient_data'); assert.deepEqual(out.missingFields,['width_m']); assert.equal(out.result,undefined);
});
test('#566 fixtures: dimensions explicites donnent un résultat reproductible',()=>{
  const out=evaluateTakeoff(tpl(['length_m','width_m'],{op:'multiply',args:['length_m','width_m']},'m2'),{length_m:{value:fx.villaMeasured.inputs.length_m,unit:'m',source},width_m:{value:fx.villaMeasured.inputs.width_m,unit:'m',source}});
  assert.equal(out.result?.value,fx.villaMeasured.expectedAreaM2); assert.equal(out.steps.filter(s=>s.op==='multiply').length,1);
});
test('#566 fixtures: rénovation pièce par pièce reste géométrique',()=>{
  const out=evaluateTakeoff(tpl(['length_m','width_m'],{op:'multiply',args:['length_m','width_m']},'m2'),{length_m:{value:fx.renovationRoom.inputs.length_m,unit:'m',source},width_m:{value:fx.renovationRoom.inputs.width_m,unit:'m',source}});
  assert.equal(out.result?.value,fx.renovationRoom.expectedAreaM2);
});
test('#566 controls: provenance, unités, coefficients implicites et bornes sont refusés',()=>{
  const t=tpl(['fixture_count'],{op:'identity',arg:'fixture_count'},'unit');
  assert.equal(evaluateTakeoff(t,{fixture_count:{value:fx.multiLot.inputs.fixture_count,unit:'unit',source}}).result?.value,fx.multiLot.expectedUnit);
  assert.throws(()=>evaluateTakeoff(t,{fixture_count:{value:'3',unit:'m',source}}),/Unité incompatible/);
  assert.throws(()=>evaluateTakeoff(t,{fixture_count:{value:'3',unit:'unit',source:{kind:'manual',reference:''}}}),/Entrée invalide/);
  assert.throws(()=>evaluateTakeoff(t,{fixture_count:{value:'3',unit:'unit',source},extra:{value:'1',unit:'unit',source}} as never),/non supportée/);
});
