'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { Card } from '../../../components/ui';
import { projectApi } from '../../../lib/collaboration';

type Conversation = { id:string; project_title:string; participant_name:string; last_message_at:string|null; last_message:string|null; unread_count:number };
const date=(value:string|null)=>value?new Intl.DateTimeFormat('fr-FR',{dateStyle:'short',timeStyle:'short'}).format(new Date(value)):'';

export default function MessagesPage(){
  const [rows,setRows]=useState<Conversation[]>([]); const [loading,setLoading]=useState(true); const [error,setError]=useState('');
  useEffect(()=>{projectApi<Conversation[]>('/api/messages/conversations').then(setRows).catch(e=>setError(e.message)).finally(()=>setLoading(false));},[]);
  return <section className="space-y-6"><div><p className="text-xs font-bold uppercase tracking-[.16em] text-teal">Communication privée</p><h1 className="mt-2 text-3xl font-bold">Mes messages</h1><p className="mt-2 text-sm text-black/55">Vos échanges avec les participants autorisés de vos chantiers.</p></div>
    {error&&<p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    {loading?<div className="h-32 animate-pulse rounded-2xl bg-black/5"/>:rows.length===0?<Card className="border-dashed py-14 text-center"><MessageCircle className="mx-auto text-black/25"/><h2 className="mt-3 font-bold">Aucune conversation</h2><p className="mt-2 text-sm text-black/55">Ouvrez un chantier confirmé pour démarrer un échange avec son professionnel.</p></Card>:<div className="space-y-3">{rows.map(row=><Link key={row.id} href={`/app/messages/${row.id}`} className="block"><Card className="p-4 transition hover:border-teal/20"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="font-bold">{row.participant_name}</p><p className="mt-1 text-xs font-semibold text-teal">{row.project_title}</p><p className="mt-2 truncate text-sm text-black/55">{row.last_message||'Conversation ouverte — écrivez votre premier message.'}</p></div><div className="shrink-0 text-right"><p className="text-xs text-black/40">{date(row.last_message_at)}</p>{Number(row.unread_count)>0&&<span className="mt-2 inline-flex min-w-6 justify-center rounded-full bg-clay px-2 py-1 text-xs font-bold text-white">{row.unread_count}</span>}</div></div></Card></Link>)}</div>}
  </section>;
}
