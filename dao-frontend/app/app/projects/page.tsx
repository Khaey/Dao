'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {supabaseBrowser} from '../../../lib/supabase-browser';
import {Project} from '../../../lib/types';
import {Badge,Button,Card} from '../../../components/ui';
import {statusLabel} from '../../../lib/utils';

export default function Projects(){
 const [rows,setRows]=useState<Project[]>([]); const [loading,setLoading]=useState(true);
 useEffect(()=>{supabaseBrowser().from('projects').select('id,project_type,surface_m2,status,desired_start_date,indicative_budget_millimes').order('created_at',{ascending:false}).then(({data})=>{setRows((data??[]) as Project[]);setLoading(false)})},[]);
 return <section><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm font-semibold text-teal">Espace client</p><h1 className="mt-1 text-3xl font-bold">Mes projets</h1><p className="mt-2 text-black/60">Préparez vos travaux avant leur publication.</p></div><Link href="/app/projects/new"><Button>+ Nouveau projet</Button></Link></div>{loading?<p className="mt-10 text-black/50">Chargement…</p>:rows.length===0?<Card className="mt-8 border-dashed text-center"><h2 className="text-lg font-semibold">Votre premier projet commence ici</h2><p className="mt-2 text-sm text-black/60">Décrivez le chantier et les demandes à confier.</p><Link href="/app/projects/new"><Button className="mt-5 bg-clay">Créer un projet</Button></Link></Card>:<div className="mt-8 grid gap-4 md:grid-cols-2">{rows.map(p=><Link key={p.id} href={('/app/projects/'+p.id) as any}><Card className="transition hover:-translate-y-0.5 hover:shadow-md"><div className="flex items-start justify-between"><h2 className="font-semibold">Projet {p.project_type}</h2><Badge>{statusLabel[p.status]??p.status}</Badge></div><p className="mt-4 text-sm text-black/60">{p.surface_m2?String(p.surface_m2)+' m² · ':''}TND</p></Card></Link>)}</div>}</section>
}
