'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge, Button, Card } from '../../../../components/ui';
import { supabaseBrowser } from '../../../../lib/supabase-browser';

type Proposal = {
 id:string; project_title:string; lot_title:string; original_amount:number;
 amount_millimes:number; status:'pending'|'accepted'|'declined'; client_note:string|null; created_at:string;
};
const money=(mills:number)=>new Intl.NumberFormat('fr-TN',{style:'currency',currency:'TND',maximumFractionDigits:3}).format(mills/1000);
const labels={pending:'En attente de votre réponse',accepted:'Acceptée',declined:'Refusée'};
export default function CounterProposals() {
 const [rows,setRows]=useState<Proposal[]>([]);
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState<string|null>(null);
 const [error,setError]=useState('');
 async function load() {
   setError('');
   const {data,error}=await supabaseBrowser().rpc('my_artisan_counter_proposals');
   if(error || !Array.isArray(data)) setError('Impossible de charger vos contre-propositions.');
   else setRows(data as Proposal[]);
   setLoading(false);
 }
 useEffect(()=>{void load();},[]);
 async function respond(row:Proposal,accept:boolean) {
   if(!window.confirm(accept?`Accepter le nouveau prix de ${money(row.amount_millimes)} pour ${row.lot_title} ?`:`Refuser la contre-proposition pour ${row.lot_title} ?`))return;
   setBusy(row.id);setError('');
   const {error}=await supabaseBrowser().rpc('respond_bid_counter',{p_id:row.id,p_accept:accept,p_key:crypto.randomUUID()});
   if(error)setError('Réponse refusée. Vérifiez que le lot est encore disponible, puis réessayez.');
   await load();setBusy(null);
 }
 return <section className="mx-auto max-w-4xl space-y-6">
   <header><p className="text-xs font-bold uppercase tracking-widest text-teal">Espace Artisan</p>
     <h1 className="mt-2 text-3xl font-bold text-ink">Mes contre-propositions</h1>
     <p className="mt-2 text-sm text-black/60">Acceptez ou refusez les propositions des Clients. Aucune réponse ne change rétroactivement votre devis soumis ni ne signe un contrat.</p>
     <Link href="/app/settings" className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-teal hover:underline">Configurer mon autorisation de négociation</Link>
   </header>
   {error&&<p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
   {loading?<p role="status">Chargement…</p>:rows.length===0?<Card>Aucune contre-proposition reçue.</Card>:
    <div className="space-y-3">{rows.map(row=><Card key={row.id} className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs text-black/50">{row.project_title}</p>
        <h2 className="text-lg font-bold text-ink">{row.lot_title}</h2></div><Badge tone={row.status==='accepted'?'teal':row.status==='declined'?'neutral':'clay'}>{labels[row.status]}</Badge></div>
      <div className="flex flex-wrap gap-6 text-sm"><p>Devis initial : <strong>{money(row.original_amount)}</strong></p>
        <p>Montant proposé : <strong className="text-teal">{money(row.amount_millimes)}</strong></p></div>
      {row.client_note&&<p className="rounded-xl bg-sand/60 px-4 py-3 text-sm">{row.client_note}</p>}
      {row.status==='pending'&&<div className="flex flex-wrap gap-2">
        <Button disabled={busy===row.id} onClick={()=>void respond(row,true)}>Accepter ce montant</Button>
        <Button disabled={busy===row.id} onClick={()=>void respond(row,false)} className="bg-white text-ink ring-1 ring-black/10">Refuser</Button>
      </div>}
      {row.status==='accepted'&&<p className="text-xs text-black/55">Si le Client attribue ce lot, le montant accepté sera retenu pour l’attribution. La proposition ne constitue pas une signature.</p>}
    </Card>)}</div>}
 </section>;
}
