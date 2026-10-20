import { supabaseBrowser } from './supabase-browser';

export type RfiClarification={id:string;version_no:number;body:string;impacts_scope:boolean;published_at:string};
export type RfiDocument={id:string;clarification_id:string|null;original_name:string;mime_type:string;size_bytes:number;created_at:string};
export type RfiQuestion={id:string;created_at:string;project_id:string;publication_id:string;publication_request_id:string;request_id:string;project_title:string;lot_title:string;body:string;status:'new'|'in_progress'|'published'|'archived';mine:boolean;owner:boolean;author_label:string;unread:boolean;clarifications:RfiClarification[];documents:RfiDocument[]};
export type RfiPage={items:RfiQuestion[];has_more:boolean;unread:number};
async function call<T>(path:string,init:RequestInit={}){const supabase=supabaseBrowser();const {data}=await supabase.auth.getSession();if(!data.session)throw new Error('Authentification requise.');const response=await fetch(`/api/rfi${path}`,{...init,headers:{Authorization:`Bearer ${data.session.access_token}`,'Content-Type':'application/json',...(init.headers||{})}});const body=await response.json().catch(()=>null);if(!response.ok)throw new Error(body?.error||'Questions techniques indisponibles.');return body.data as T;}
const key=()=>crypto.randomUUID();
export const listRfi=(publicationRequestId?:string|null)=>call<RfiPage>(publicationRequestId?`?publication_request_id=${encodeURIComponent(publicationRequestId)}`:'');
export const createRfi=(publication_request_id:string,body:string)=>call<RfiQuestion>('',{method:'POST',body:JSON.stringify({publication_request_id,body,idempotency_key:key()})});
export const publishRfi=(id:string,body:string,impacts_scope:boolean)=>call<RfiQuestion>(`/${encodeURIComponent(id)}/clarifications`,{method:'POST',body:JSON.stringify({body,impacts_scope,idempotency_key:key()})});
export const markRfiRead=(id:string)=>call<{acknowledged:boolean}>(`/${encodeURIComponent(id)}/read`,{method:'POST',body:'{}'});
export const prepareRfiDocument=(input:{question_id:string;clarification_id:string|null;original_name:string;mime_type:string;size_bytes:number})=>call<{document:{id:string};path:string;token:string}>('/documents/upload',{method:'POST',body:JSON.stringify(input)});
export const completeRfiDocument=(document_id:string)=>call<RfiDocument>('/documents/complete',{method:'POST',body:JSON.stringify({document_id})});
export const downloadRfiDocument=(document_id:string)=>call<{url:string;filename:string}>('/documents/download',{method:'POST',body:JSON.stringify({document_id})});
export const rfiDate=(value:string)=>new Date(value).toLocaleString('fr-TN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
