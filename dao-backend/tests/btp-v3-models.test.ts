import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTakeoff } from '../src/btp-takeoff/engine.js';
import { btpV3Models } from '../src/btp-takeoff/v3-models.js';

const source={kind:'manual' as const,reference:'TEST #571 — dimension explicitement fournie'};
const input=(value:string,unit:string)=>({value,unit,source});
test('#571 mur net : surface brute moins ouvertures fournies',()=>{
  const out=evaluateTakeoff(btpV3Models.wallNetArea,{wall_length_m:input('12.5','m'),wall_height_m:input('2.8','m'),openings_area_m2:input('5.25','m2')});
  assert.equal(out.result?.value,'29.75'); assert.equal(out.result?.unit,'m2');
});
test('#571 revêtements et peinture : surface par local/support',()=>{
  const room=evaluateTakeoff(btpV3Models.roomFinishArea,{room_length_m:input('4.25','m'),room_width_m:input('3.10','m')});
  const coat=evaluateTakeoff(btpV3Models.wallCoatingArea,{wall_length_m:input('10','m'),wall_height_m:input('2.5','m')});
  assert.equal(room.result?.value,'13.175'); assert.equal(coat.result?.value,'25');
});
test('#571 volume : trois dimensions explicites seulement',()=>{
  const out=evaluateTakeoff(btpV3Models.knownVolume,{length_m:input('10','m'),width_m:input('60','cm'),depth_m:input('400','mm')});
  assert.equal(out.result?.value,'2.4'); assert.equal(out.result?.unit,'m3');
});
test('#571 refus : surface seule, ouverture excessive et unité incohérente',()=>{
  assert.equal(evaluateTakeoff(btpV3Models.wallNetArea,{wall_length_m:input('12.5','m'),wall_height_m:input('2.8','m')}).status,'insufficient_data');
  assert.throws(()=>evaluateTakeoff(btpV3Models.wallNetArea,{wall_length_m:input('1','m'),wall_height_m:input('1','m'),openings_area_m2:input('2','m2')}),/Déduction supérieure/);
  assert.throws(()=>evaluateTakeoff(btpV3Models.roomFinishArea,{room_length_m:input('4','m2'),room_width_m:input('3','m')}),/Unité incompatible/);
});
