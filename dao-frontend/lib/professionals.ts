import { projectApi } from './collaboration';
import { supabaseBrowser } from './supabase-browser';
export const professionalApi=(action:string,input:Record<string,unknown>)=>projectApi('/api/professionals',{action,input});
export const professionalRead=(query:Record<string,string>={})=>projectApi('/api/professionals?'+new URLSearchParams(query));
export const professionalStatus:Record<string,string>={draft:'Brouillon',pending_review:'En revue',approved:'Approuvé',rejected:'Corrections demandées',hidden:'Masqué',published:'Publié',quarantined:'Upload à finaliser',ready:'À contrôler',withdrawn:'Retiré'};
export const purposeLabels:Record<string,string>={logo:'Logo',tax:'Justificatif fiscal',registration:'Immatriculation / RNE',insurance:'Assurance déclarée',diploma:'Diplôme / qualification',identity:'Identité du représentant'};
export async function uploadProfessional(file:File,input:Record<string,unknown>) {
  const prepared=await professionalApi('prepare_upload',{...input,original_name:file.name,mime_type:file.type,size_bytes:file.size});
  const {error}=await supabaseBrowser().storage.from('dao-private').uploadToSignedUrl(prepared.path,prepared.token,file,{contentType:file.type,upsert:false});
  if(error) throw new Error('Upload impossible. Retirez le fichier incomplet puis réessayez.');
  return professionalApi('finalize_upload',{id:prepared.id,kind:input.kind});
}
export async function professionalBlob(kind:string,id:string) {
  const {data}=await supabaseBrowser().auth.getSession(); if(!data.session) throw new Error('Session expirée.');
  const response=await fetch('/api/professionals',{method:'POST',headers:{Authorization:'Bearer '+data.session.access_token,'Content-Type':'application/json'},body:JSON.stringify({action:'download',input:{kind,id}}),cache:'no-store'});
  if(!response.ok) throw new Error((await response.json()).error||'Fichier inaccessible.');
  return response.blob();
}
