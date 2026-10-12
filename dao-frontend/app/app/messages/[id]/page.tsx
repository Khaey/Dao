'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { Send } from 'lucide-react';
import { Button, Card } from '../../../../components/ui';
import { supabaseBrowser } from '../../../../lib/supabase-browser';

type Message={id:string;created_at:string;author_id:string;body:string};
async function api(path:string,init?:RequestInit){const {data}=await supabaseBrowser().auth.getSession();if(!data.session)throw new Error('Session expirée.');const response=await fetch(path,{...init,headers:{'Content-Type':'application/json',Authorization:`Bearer ${data.session.access_token}`,...(init?.headers||{})}});const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||'Opération refusée.');return payload.data;}

export default function ThreadPage(){
 const {id}=useParams<{id:string}>(); const [messages,setMessages]=useState<Message[]>([]); const [userId,setUserId]=useState(''); const [body,setBody]=useState(''); const [loading,setLoading]=useState(true); const [sending,setSending]=useState(false); const [error,setError]=useState(''); const end=useRef<HTMLDivElement>(null);
 const load=useCallback(async()=>{setError('');try{const [rows,session]=await Promise.all([api(`/api/messages?conversation_id=${id}&limit=50`),supabaseBrowser().auth.getSession()]);setMessages(rows);setUserId(session.data.session?.user.id||'');await api('/api/messages',{method:'PATCH',body:JSON.stringify({conversation_id:id})});}catch(e:any){setError(e.message);}finally{setLoading(false);}},[id]);
 useEffect(()=>{void load();},[load]); useEffect(()=>{end.current?.scrollIntoView({behavior:'smooth'});},[messages]);
 async function send(event:FormEvent){event.preventDefault();if(!body.trim()||sending)return;setSending(true);setError('');const value=body;setBody('');try{await api('/api/messages',{method:'POST',body:JSON.stringify({conversation_id:id,body:value,idempotency_key:crypto.randomUUID()})});await load();}catch(e:any){setBody(value);setError(e.message);}finally{setSending(false);}}
 return <section className="mx-auto max-w-4xl space-y-4"><div><Link href="/app/messages" className="text-xs font-semibold text-teal">← Mes messages</Link><h1 className="mt-3 text-2xl font-bold">Discussion du chantier</h1><p className="mt-1 text-sm text-black/50">Messages privés, horodatés et conservés dans l’historique.</p></div>{error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
 <Card className="flex min-h-[60vh] flex-col p-0"><div aria-live="polite" className="flex-1 space-y-3 overflow-y-auto p-4 sm:p-6">{loading?<p className="text-sm text-black/45">Chargement…</p>:messages.length===0?<p className="py-16 text-center text-sm text-black/45">Aucun message. Vous pouvez commencer la discussion.</p>:messages.map(message=><div key={message.id} className={`flex ${message.author_id===userId?'justify-end':'justify-start'}`}><div className={`max-w-[85%] rounded-2xl px-4 py-3 ${message.author_id===userId?'bg-teal text-white':'bg-sand text-ink'}`}><p className="whitespace-pre-wrap break-words text-sm">{message.body}</p><p className={`mt-2 text-[10px] ${message.author_id===userId?'text-white/70':'text-black/40'}`}>{new Intl.DateTimeFormat('fr-FR',{dateStyle:'short',timeStyle:'short'}).format(new Date(message.created_at))}</p></div></div>)}<div ref={end}/></div>
 <form onSubmit={send} className="border-t border-black/5 p-3 sm:p-4"><label className="sr-only" htmlFor="message-body">Votre message</label><div className="flex items-end gap-2"><textarea id="message-body" aria-label="Votre message" maxLength={4000} rows={2} className="min-h-12 flex-1 resize-y rounded-xl border border-black/10 px-3 py-3 text-sm" placeholder="Écrire un message…" value={body} onChange={e=>setBody(e.target.value)}/><Button disabled={sending||!body.trim()} aria-label="Envoyer le message"><Send size={17}/><span className="ml-2 hidden sm:inline">Envoyer</span></Button></div><p className="mt-2 text-right text-xs text-black/35">{body.length}/4000</p></form></Card></section>;
}
