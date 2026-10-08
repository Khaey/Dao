'use client';
import { useEffect, useState } from 'react';
import { supabaseBrowser } from '../../lib/supabase-browser';
import { statusLabel } from '../../lib/utils';
import { actionLabels } from '../../lib/backoffice';
export default function ReviewHistory({projectId}:{projectId:string}){
 const [history,setHistory]=useState<any>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;void supabaseBrowser().rpc('project_review_history',{p_project_id:projectId}).then(({data,error})=>{if(!active)return;if(error){if(error.code!=='42501')setError('Historique des revues indisponible');}else setHistory(data);});return()=>{active=false;};},[projectId]);
 if(error)return <p role="alert">{error}</p>;if(!history)return null;
 return <section className="mt-5 space-y-4"><h2 className="text-xl font-bold">Modifications et revues DAO</h2>{history.events.map((e:any)=><article key={e.id} className="rounded-xl bg-sand p-3 text-sm"><p className="font-semibold">{actionLabels[e.action]||e.action}</p><p className="mt-1">{e.actor_name||'Auteur historique'} · {new Date(e.created_at).toLocaleString('fr-TN')}</p>{e.metadata.reason&&<p className="mt-1">Motif : {e.metadata.reason}</p>}{e.metadata.comment&&<p>{e.metadata.comment}</p>}</article>)}{history.versions.map((v:any)=><details key={v.id} className="rounded-xl border p-4"><summary className="cursor-pointer font-semibold">Version {v.version_no} · {v.title} · {v.author_name||'Version historique'}</summary><p className="mt-2 text-xs">{new Date(v.created_at).toLocaleString('fr-TN')} · {statusLabel[v.status]||v.status}</p><p className="mt-3 whitespace-pre-wrap text-sm">{v.description}</p>{v.lots.map((lot:any)=><div key={lot.id} className="mt-3 border-t pt-3"><h3 className="font-semibold">{lot.title} · v{lot.version_no}</h3><p className="text-sm">{lot.scope}</p>{lot.sub_lots.map((s:any)=><div key={s.id} className="mt-2 border-l-2 border-teal/20 pl-3"><h4 className="font-semibold">{s.title}</h4><p className="text-sm">{s.scope}</p>{s.budget_millimes!=null&&<p className="text-sm">{Number(s.budget_millimes)/1000} TND</p>}</div>)}</div>)}</details>)}</section>;
}
