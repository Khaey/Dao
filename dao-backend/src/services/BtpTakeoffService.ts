import { DomainError } from '../lib/errors.js';
import { evaluateTakeoff } from '../btp-takeoff/engine.js';
import type { TakeoffInput, TakeoffTemplate } from '../btp-takeoff/contract.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY=/^[A-Za-z0-9._:-]{8,100}$/;
const SCOPE=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

function uuid(value:unknown,field:string,optional=false):string|null {
  if(optional&&(value==null||value==='')) return null;
  if(typeof value!=='string'||!UUID.test(value)) throw new DomainError(`${field} invalide`,'BAD_REQUEST');
  return value.toLowerCase();
}
function revision(value:unknown,optional=false):number|null {
  if(optional&&(value==null||value==='')) return null;
  if(!Number.isSafeInteger(value)||Number(value)<0) throw new DomainError('Révision invalide','BAD_REQUEST');
  return Number(value);
}
function idempotency(value:unknown):string {
  if(typeof value!=='string'||!KEY.test(value)) throw new DomainError('Clé idempotente invalide','BAD_REQUEST');
  return value;
}
export class BtpTakeoffService {
  constructor(private readonly db:any) {}
  private async rpc(name:string,args:Record<string,unknown>) {
    const {data,error}=await this.db.rpc(name,args); if(error) throw error; return data;
  }
  async snapshot(projectId:unknown,takeoffId:unknown) {
    return this.rpc('btp_takeoff_snapshot_v1',{p_project_id:uuid(projectId,'project_id'),p_takeoff_id:uuid(takeoffId,'takeoff_id',true)});
  }
  async command(input:Record<string,unknown>) {
    const action=input.action;
    if(!['calculate','submit','validate'].includes(String(action))) throw new DomainError('Action de métré invalide','BAD_REQUEST');
    const allowed=action==='calculate'
      ? ['action','kind','project_id','work_id','work_item_id','takeoff_id','expected_revision','scope_key','label','inputs','idempotency_key']
      : ['action','kind','takeoff_id','expected_revision','note','idempotency_key'];
    if(Object.keys(input).some(key=>!allowed.includes(key))) throw new DomainError('Champ de commande non supporté','BAD_REQUEST');
    if(input.kind!==undefined&&input.kind!=='forecast'&&input.kind!=='execution') throw new DomainError('Type de métré invalide','BAD_REQUEST');
    // #577 (07/11/2026) : métré d'exécution après attribution, par un point d'entrée distinct ; la base revérifie tout.
    const rpcName=input.kind==='execution'?'btp_execution_takeoff_command_v1':'btp_takeoff_command_v1';
    const key=idempotency(input.idempotency_key);
    if(action==='calculate') {
      const projectId=uuid(input.project_id,'project_id')!; const workId=uuid(input.work_id,'work_id')!;
      const takeoffId=uuid(input.takeoff_id,'takeoff_id',true);
      const workItemId=uuid(input.work_item_id,'work_item_id',true);
      if(!takeoffId&&!workItemId) throw new DomainError('work_item_id requis : un métré est rattaché à un ouvrage du chantier','BAD_REQUEST');
      const expected=revision(input.expected_revision,true);
      if(takeoffId&&!expected) throw new DomainError('expected_revision requis pour un recalcul','BAD_REQUEST');
      if(typeof input.scope_key!=='string'||!SCOPE.test(input.scope_key)) throw new DomainError('Périmètre de métré invalide','BAD_REQUEST');
      if(typeof input.label!=='string'||!input.label.trim()||input.label.trim().length>160) throw new DomainError('Libellé de métré invalide','BAD_REQUEST');
      if(!input.inputs||Array.isArray(input.inputs)||typeof input.inputs!=='object') throw new DomainError('Entrées de métré invalides','BAD_REQUEST');
      const template=await this.rpc('btp_takeoff_template_v1',{p_project_id:projectId,p_work_id:workId}) as TakeoffTemplate;
      const evaluation=evaluateTakeoff(template,input.inputs as Record<string,TakeoffInput>);
      const data=await this.rpc(rpcName,{p_action:'calculate',p_input:{projectId,workId,...(workItemId?{workItemId}:{}),takeoffId,expectedRevision:expected,
        scopeKey:input.scope_key,label:input.label.trim(),canonicalInputs:evaluation.canonicalInputs},p_idempotency_key:key});
      return {...data,evaluation};
    }
    const takeoffId=uuid(input.takeoff_id,'takeoff_id')!; const expected=revision(input.expected_revision)!;
    if(typeof input.note!=='undefined'&&(typeof input.note!=='string'||input.note.trim().length>1000)) throw new DomainError('Note invalide','BAD_REQUEST');
    return this.rpc(rpcName,{p_action:action,p_input:{takeoffId,expectedRevision:expected,note:typeof input.note==='string'?input.note.trim()||null:null},p_idempotency_key:key});
  }
}
