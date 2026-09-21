'use client';
import {useEffect,useState} from 'react'; import {useParams} from 'next/navigation'; import {supabaseBrowser} from '../../../../lib/supabase-browser'; import {Badge,Card} from '../../../../components/ui'; import {statusLabel} from '../../../../lib/utils';

export default function ProjectDetail(){
 const {id}=useParams<{id:string}>(); const [project,setProject]=useState<any>(); const [requests,setRequests]=useState<any[]>([]);
 useEffect(()=>{const s=supabaseBrowser();s.from('projects').select('*').eq('id',id).single().then(({data})=>setProject(data));s.from('project_requests').select('id,status').eq('project_id',id).then(({data})=>setRequests(data??[]))},[id]);
 if(!project)return <p>Chargement…</p>;
 return <section><div className="flex items-end justify-between"><div><p className="text-sm font-semibold text-teal">Préparation du projet</p><h1 className="mt-1 text-3xl font-bold">{project.project_type} · {project.surface_m2??'—'} m²</h1></div><Badge>{statusLabel[project.status]??project.status}</Badge></div><Card className="mt-8"><h2 className="font-semibold">Demandes de travaux</h2>{requests.length===0?<p className="mt-5 text-sm text-black/50">Aucune demande enregistrée.</p>:<div className="mt-4 space-y-3">{requests.map((x,i)=><div key={x.id} className="flex justify-between rounded-xl bg-sand p-3 text-sm"><span>Demande {i+1}</span><Badge>{statusLabel[x.status]??x.status}</Badge></div>)}</div>}<p className="mt-6 rounded-xl bg-sand p-4 text-sm text-black/60">Les créations et modifications passent par les actions serveur D.A.O afin de préserver les transitions transactionnelles et les RLS.</p></Card></section>
}
