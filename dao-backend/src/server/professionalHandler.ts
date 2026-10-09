import { createHash, randomUUID } from 'node:crypto';

const maxBytes=20*1024*1024;
const allowed=['image/jpeg','image/png','image/webp','application/pdf'];
function invalid(message:string):never { throw {code:'22023',message}; }
export function inspectProfessionalBytes(bytes:Uint8Array,mime:string,size:number) {
  if(bytes.length!==size || bytes.length<1 || bytes.length>maxBytes) invalid('Taille du fichier incohérente ou supérieure à 20 Mo');
  const header=Buffer.from(bytes.subarray(0,16));
  const valid=mime==='image/png'?header.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):
    mime==='image/jpeg'?header[0]===255&&header[1]===216&&header[2]===255:
    mime==='image/webp'?header.toString('ascii',0,4)==='RIFF'&&header.toString('ascii',8,12)==='WEBP':
    mime==='application/pdf'?header.toString('ascii',0,5)==='%PDF-':false;
  if(!valid) invalid('Le contenu ne correspond pas au format annoncé');
  if(mime==='application/pdf' && /\/(?:JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA)\b/i.test(Buffer.from(bytes).toString('latin1')))
    invalid('PDF avec contenu actif non accepté');
  return createHash('sha256').update(bytes).digest('hex');
}

// Privileged Storage is instantiated only AFTER the JWT-scoped RPC authorizes
// this particular file. Download capabilities stay on the server: every request
// checks current consent/review/withdrawal and never returns a Storage read URL.
export function createProfessionalHandler(db:any,resolveActor:(header:string|null)=>Promise<any>,admin:()=>any,readUrl:typeof fetch=fetch) {
  async function rpc(name:string,input:Record<string,unknown>) {
    const {data,error}=await db.rpc(name,input); if(error) throw error; return data;
  }
  async function bytesFor(file:any,kind:string) {
    const client=admin();
    let path=file.object_path;
    if(!path) {
      const result=await client.from(kind==='portfolio'?'portfolio_assets':'contractor_files').select('object_path').eq('id',file.id).single();
      if(result.error||!result.data) throw {code:'42501',message:'Fichier inaccessible'};
      path=result.data.object_path;
    }
    const {data,error}=await client.storage.from('dao-private').createSignedUrl(path,20);
    if(error) throw error;
    const response=await readUrl(data.signedUrl,{cache:'no-store',redirect:'error'});
    if(!response.ok) throw {code:'FILE_UNAVAILABLE',message:'Fichier indisponible'};
    if(Number(response.headers.get('content-length'))>maxBytes) invalid('Fichier trop volumineux');
    const bytes=new Uint8Array(await response.arrayBuffer());
    const sha=inspectProfessionalBytes(bytes,file.mime_type,Number(file.size_bytes));
    return {client,bytes,sha};
  }
  return async(request:Request)=>{
    try {
      const actor=await resolveActor(request.headers.get('authorization'));
      if(!actor) return Response.json({error:'Authentification requise'},{status:401});
      if(request.method==='GET') {
        const p=new URL(request.url).searchParams; const view=p.get('view')||'dossier';
        const data=view==='directory'?await rpc('professional_directory',{p_review:p.get('review')==='true'}):
          view==='public'?await rpc('professional_public_profile',{p_id:p.get('id'),p_preview:p.get('preview')==='true'}):
          view==='dossier'?await rpc('professional_dossier',{p_id:p.get('id')||null}):invalid('Vue inconnue');
        return Response.json({data},{headers:{'Cache-Control':'private, no-store'}});
      }
      if(request.method!=='POST') return Response.json({error:'Méthode refusée'},{status:405});
      const body=await request.json();
      if(!body || typeof body!=='object' || Array.isArray(body) || !body.input || typeof body.input!=='object' || Array.isArray(body.input)) invalid('Commande invalide');
      const input=body.input;
      if(body.action==='prepare_upload') {
        if(!allowed.includes(input.mime_type) || !Number.isInteger(input.size_bytes) || input.size_bytes<1 || input.size_bytes>maxBytes) invalid('PDF ou image de 20 Mo maximum requis');
        if(typeof input.original_name!=='string' || !input.original_name.trim() || input.original_name.length>120) invalid('Nom de fichier invalide');
        const dossier=await rpc('professional_dossier',{p_id:null});
        const prefix=input.kind==='professional'?`professional/${dossier.profile.id}/`:
          input.kind==='portfolio'&&/^[0-9a-f-]{36}$/i.test(input.portfolio_project_id)?`portfolio/${input.portfolio_project_id}/`:invalid('Type de fichier invalide');
        const path=prefix+randomUUID();
        const file=await rpc('professional_command',{p_action:'file_create',p_input:{...input,object_path:path}});
        const {data,error}=await admin().storage.from('dao-private').createSignedUploadUrl(path,{upsert:false}); if(error) throw error;
        return Response.json({data:{id:file.id,path,token:data.token}});
      }
      if(body.action==='finalize_upload' || body.action==='download') {
        const file=await rpc('professional_file_access',{p_kind:input.kind,p_id:input.id,p_owner_only:body.action==='finalize_upload'});
        if(body.action==='finalize_upload' && file.status!=='quarantined') invalid('Fichier déjà finalisé ou retiré');
        if(body.action==='download' && (!file.content_sha256 || !['ready','approved','rejected'].includes(file.status))) throw {code:'42501',message:'Fichier non inspecté ou retiré'};
        const {client,bytes,sha}=await bytesFor(file,input.kind);
        if(body.action==='finalize_upload') {
          const {error}=await client.rpc('professional_confirm_upload',{p_kind:input.kind,p_id:input.id,p_actor:actor.id,p_sha256:sha}); if(error) throw error;
          return Response.json({data:{id:file.id,status:'ready'}});
        }
        if(sha!==file.content_sha256) throw {code:'42501',message:'Le fichier a changé depuis son inspection'};
        // Recheck after Storage IO to catch a withdrawal during the download.
        const current=await rpc('professional_file_access',{p_kind:input.kind,p_id:input.id,p_owner_only:false});
        if(current.revision!==file.revision) throw {code:'42501',message:'Fichier modifié ou retiré'};
        const name=String(file.original_name||'document').replace(/[^a-zA-Z0-9._-]/g,'-');
        return new Response(Buffer.from(bytes),{headers:{'Content-Type':file.mime_type,'Content-Disposition':`${file.mime_type==='application/pdf'?'attachment':'inline'}; filename="${name}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
      }
      return Response.json({data:await rpc('professional_command',{p_action:body.action,p_input:input})});
    } catch(error:any) {
      const status=error?.code==='42501'?403:['23505','23514'].includes(error?.code)?409:
        ['22023','22P02','23502','23503'].includes(error?.code)||error instanceof SyntaxError?400:500;
      return Response.json({error:status===500?'Opération indisponible. Réessayez.':error.message||'Opération refusée',code:error?.code},{status});
    }
  };
}
