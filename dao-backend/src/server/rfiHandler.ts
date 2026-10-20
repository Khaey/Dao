import { RfiContractError } from '../rfi/contract.js';
import type { RfiService } from '../services/RfiService.js';
import type { RfiDocumentService } from '../services/RfiDocumentService.js';

const headers={'Cache-Control':'private, no-store',Vary:'Authorization'};
export function createRfiHandler(service:RfiService,documents:RfiDocumentService,resolveActor:(header:string|null)=>Promise<{id:string}|null>){
  async function run(request:Request,operation:()=>Promise<unknown>){try{if(!await resolveActor(request.headers.get('authorization')))return fail('unauthenticated',401);return Response.json({data:await operation()},{headers});}catch(error:any){const code=error instanceof RfiContractError?error.code:error?.code;if(['invalid','22023','22P02'].includes(code)||error instanceof SyntaxError)return fail('invalid',400);if(code==='P0001')return fail('rate_limited',429);if(code==='42501')return fail('forbidden',403);return fail('unavailable',503);}}
  return {list:(request:Request)=>run(request,()=>service.list(new URL(request.url).searchParams)),create:(request:Request)=>run(request,async()=>service.create(await request.json())),publish:(request:Request,id:string)=>run(request,async()=>service.publish(id,await request.json())),markRead:(request:Request,id:string)=>run(request,()=>service.markRead(id)),prepareDocument:(request:Request)=>run(request,async()=>documents.prepare(await request.json())),completeDocument:(request:Request)=>run(request,async()=>documents.complete((await request.json()).document_id)),downloadDocument:(request:Request)=>run(request,async()=>documents.download((await request.json()).document_id))};
}
function fail(code:string,status:number){const labels:Record<string,string>={unauthenticated:'Authentification requise.',forbidden:'Accès refusé.',invalid:'Paramètres invalides.',rate_limited:'Trop de questions.',unavailable:'Questions techniques temporairement indisponibles.'};return Response.json({error:labels[code],code},{status,headers});}
