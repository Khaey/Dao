import type { TakeoffTemplate } from './contract.js';

// #571 — modèles géométriques V3 proposés. Ils sont purs, version-agnostiques
// et destinés à être attachés au brouillon catalogue après validation #555.
const base={catalogVersionId:'fixture-v3',catalogVersionCode:'TN-2026.4',sourceRef:'D.A.O. #571 — géométrie explicite'};
function model(workCode:string, unit:TakeoffTemplate['outputUnitCode'], required:string[], formulaAst:Record<string,unknown>, assumptions:string):TakeoffTemplate {
  return {...base,workId:`v3-${workCode}`,workCode,workLabel:workCode,templateId:`v3-template-${workCode}`,outputUnitCode:unit,inputSchema:{required,properties:Object.fromEntries(required.map(key=>[key,{type:'number',minimum:0}]))},formulaAst,roundingScale:3,assumptions:[assumptions],sourceRef:base.sourceRef};
}

export const btpV3Models: Record<string,TakeoffTemplate>={
  wallNetArea:model('btp_work_wall_net_area','m2',['wall_length_m','wall_height_m','openings_area_m2'],{op:'subtract',args:[{op:'multiply',args:['wall_length_m','wall_height_m']},'openings_area_m2']},'Ouvertures déduites uniquement si leur surface est fournie.'),
  roomFinishArea:model('btp_work_room_finish_area','m2',['room_length_m','room_width_m'],{op:'multiply',args:['room_length_m','room_width_m']},'Local mesuré ; aucune surface globale ou perte implicite.'),
  wallCoatingArea:model('btp_work_wall_coating_area','m2',['wall_length_m','wall_height_m'],{op:'multiply',args:['wall_length_m','wall_height_m']},'Support mesuré ; préparation, rendement et épaisseur hors calcul.'),
  knownVolume:model('btp_work_known_volume','m3',['length_m','width_m','depth_m'],{op:'multiply',args:['length_m','width_m','depth_m']},'Trois dimensions explicites ; aucun dimensionnement technique.'),
};
