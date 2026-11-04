import { DomainError } from '../lib/errors.js';
import { BtpTakeoffService } from '../services/BtpTakeoffService.js';

const headers={'Cache-Control':'private, no-store','Vary':'Authorization'};
const fail=(status:number,code:string,error:string,extra:Record<string,string>={})=>Response.json({error,code},{status,headers:{...headers,...extra}});

export function createBtpTakeoffHandler(service:BtpTakeoffService,resolveActor:(authorization:string|null)=>Promise<{id:string}|null>) {
  return async(request:Request)=>{
    if(!await resolveActor(request.headers.get('authorization'))) return fail(401,'UNAUTHENTICATED','Authentification requise.');
    try {
      if(request.method==='GET') {
        const query=new URL(request.url).searchParams;
        if([...query.keys()].some(key=>!['project_id','takeoff_id'].includes(key))||query.getAll('project_id').length!==1||query.getAll('takeoff_id').length>1) {
          return fail(400,'BAD_REQUEST','Paramètres de métré invalides.');
        }
        return Response.json({data:await service.snapshot(query.get('project_id'),query.get('takeoff_id'))},{headers});
      }
      if(request.method!=='POST') return fail(405,'METHOD_NOT_ALLOWED','Méthode refusée.',{Allow:'GET, POST'});
      const raw=await request.text(); if(raw.length>131_072) return fail(413,'PAYLOAD_TOO_LARGE','Commande trop volumineuse.');
      let input:unknown; try{input=JSON.parse(raw);}catch{return fail(400,'BAD_REQUEST','Corps JSON invalide.');}
      if(!input||Array.isArray(input)||typeof input!=='object') return fail(400,'BAD_REQUEST','Commande de métré invalide.');
      return Response.json({data:await service.command(input as Record<string,unknown>)},{headers});
    } catch(error:any) {
      if(error instanceof DomainError||['22023','22P02','23503','23514'].includes(error?.code)) return fail(400,'BAD_REQUEST',error?.message??'Commande de métré invalide.');
      if(error?.code==='42501') return fail(403,'FORBIDDEN','Action non autorisée.');
      if(error?.code==='40001'||error?.code==='23505') return fail(409,'CONFLICT','Le métré a changé. Rechargez-le.');
      if(error?.code==='P0002') return fail(404,'NOT_FOUND','Métré ou modèle introuvable.');
      return fail(503,'UNAVAILABLE','Moteur de métrés temporairement indisponible.');
    }
  };
}
