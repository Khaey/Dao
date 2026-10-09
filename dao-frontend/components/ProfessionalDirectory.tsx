'use client';
import Link from 'next/link';
import { useEffect,useState } from 'react';
import { Badge,Card,Input } from './ui';
import { professionalRead,professionalStatus } from '../lib/professionals';
export default function ProfessionalDirectory({review=false}:{review?:boolean}) {
  const [rows,setRows]=useState<any[]|null>(null),[query,setQuery]=useState(''),[error,setError]=useState('');
  useEffect(()=>{void professionalRead({view:'directory',review:String(review)}).then(setRows).catch(e=>setError(e.message));},[review]);
  const visible=(rows||[]).filter(r=>`${r.name} ${r.city||''}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="mx-auto max-w-5xl space-y-5"><h1 className="text-3xl font-bold">{review?'Dossiers professionnels à contrôler':'Professionnels vérifiés'}</h1><p className="text-sm text-black/60">{review?'Contrôlez les informations déclarées, la visibilité et les médias avant publication.':'Consultez les fiches approuvées et les réalisations déclarées par les professionnels.'}</p><label className="block text-sm font-semibold">Rechercher par nom ou ville<Input value={query} onChange={e=>setQuery(e.target.value)}/></label>{error&&<p role="alert" className="text-red-700">{error}</p>}{!rows&&!error&&<p role="status">Chargement des professionnels…</p>}{rows&&!visible.length&&<Card>Aucun professionnel disponible pour cette recherche.</Card>}<div className="grid gap-4 sm:grid-cols-2">{visible.map(r=><Link key={r.id} href={review?`/app/dao/professionals/${r.id}/dossier`:`/app/professionals/${r.id}`}><Card className="h-full transition hover:border-teal"><h2 className="font-bold">{r.name}</h2><p className="my-3 text-sm text-black/55">{r.city||'Ville non renseignée'}</p><div className="flex flex-wrap gap-2"><Badge tone={r.verification_status==='verified'?'teal':r.verification_status==='suspended'?'red':'clay'}>{r.verification_status==='verified'?'Vérifié par DAO':r.verification_status==='suspended'?'Suspendu':'Vérification en attente / à corriger'}</Badge>{review&&<Badge>{professionalStatus[r.review_status]||'Dossier à compléter'}</Badge>}</div></Card></Link>)}</div></section>;
}
