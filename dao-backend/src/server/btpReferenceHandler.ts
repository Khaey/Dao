import { BtpReferenceService } from '../services/BtpReferenceService.js';
import { requireActor, type AuthenticatedActor } from './auth.js';

const allowed=new Set(['project_type','country']);

export function createBtpReferenceHandler(service:BtpReferenceService,resolveActor:(authorization:string|null)=>Promise<AuthenticatedActor|null>) {
  return {
    async catalog(request:Request) {
      try {
        requireActor(await resolveActor(request.headers.get('authorization')));
        const url=new URL(request.url);
        for(const key of url.searchParams.keys()) if(!allowed.has(key)) return Response.json({error:'Paramètre non autorisé',code:'BAD_REQUEST'},{status:400});
        for(const key of allowed) if(url.searchParams.getAll(key).length>1) return Response.json({error:'Paramètre dupliqué',code:'BAD_REQUEST'},{status:400});
        const projectType=url.searchParams.get('project_type');
        const country=(url.searchParams.get('country')??'TN').toUpperCase();
        const data=await service.snapshot(projectType,country);
        return Response.json({data},{headers:{'Cache-Control':'private, max-age=300','Vary':'Authorization'}});
      } catch(error:any) {
        const code=error?.code; const status=code==='UNAUTHENTICATED'?401:code==='BAD_REQUEST'||code==='22023'?400:code==='NOT_FOUND'?404:500;
        return Response.json({error:error?.message??'Référentiel indisponible',code},{status,headers:{'Cache-Control':'private, no-store'}});
      }
    }
  };
}
