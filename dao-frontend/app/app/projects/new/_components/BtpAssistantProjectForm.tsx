'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Bot, Check, ChevronDown, Loader2, RotateCcw, Send, ShieldCheck, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { AssistantProposal, ProposalItem, ProjectType } from '../../../../../../dao-backend/src/assistant/contract';
import { supabaseBrowser } from '../../../../../lib/supabase-browser';
import { cn } from '../../../../../lib/utils';
import { controlClass, CreationHeader, Field, FormAlert, Panel } from './CreationUi';

type Territory = { id:string; name_fr:string };
const typeLabels: Record<ProjectType,string> = { construction:'Construction',renovation:'Rénovation',extension:'Extension',other:'Autre' };
const relevanceLabels = { usual:'Habituel',conditional:'Conditionnel',optional:'Facultatif',verify:'À vérifier' } as const;
const relevanceTone = { usual:'bg-teal/10 text-teal',conditional:'bg-amber-50 text-amber-900',optional:'bg-sand text-ink/70',verify:'bg-clay/10 text-clay' } as const;

async function authorization() {
  const {data}=await supabaseBrowser().auth.getSession();
  if(!data.session) throw new Error('Votre session a expiré. Reconnectez-vous.');
  return {Authorization:`Bearer ${data.session.access_token}`,'Content-Type':'application/json'};
}

async function api<T>(url:string,init:RequestInit={}) {
  const response=await fetch(url,{...init,headers:{...(await authorization()),...(init.headers??{})}});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(payload.error||'Assistant indisponible pour le moment.');
  return payload.data as T;
}

function Tree({items,onRemove,busy}:{items:ProposalItem[];onRemove:(item:ProposalItem)=>void;busy:boolean}) {
  const children=useMemo(()=>{const map=new Map<string|null,ProposalItem[]>();for(const item of items){const group=map.get(item.parent_id)??[];group.push(item);map.set(item.parent_id,group);}return map;},[items]);
  const lots=children.get(null)??[];
  return <ol className="space-y-3">{lots.map((lot,index)=><li key={lot.id} className="rounded-2xl border border-black/[0.08] bg-white p-4">
    <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-teal">Lot {index+1}</p><h3 className="mt-0.5 font-bold text-ink">{lot.label_fr}</h3></div><button disabled={busy} type="button" onClick={()=>onRemove(lot)} className="min-h-11 rounded-xl px-3 text-sm font-semibold text-red-700 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-600">Retirer</button></div>
    <ul className="mt-3 space-y-2 border-l-2 border-teal/15 pl-3">{(children.get(lot.id)??[]).map(sub=><li key={sub.id} className="rounded-xl bg-sand/45 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-semibold">{sub.label_fr}</p><span className={cn('mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold',relevanceTone[sub.relevance])}>{relevanceLabels[sub.relevance]}</span></div><button disabled={busy} type="button" onClick={()=>onRemove(sub)} className="min-h-11 rounded-lg px-2 text-xs font-semibold text-red-700 hover:bg-red-50">Retirer</button></div>
      {(children.get(sub.id)??[]).length>0&&<ul className="mt-2 space-y-1.5">{(children.get(sub.id)??[]).map(work=><li key={work.id} className="flex items-start justify-between gap-2 rounded-lg bg-white px-3 py-2"><div><p className="text-sm font-medium">{work.label_fr}</p><p className="text-[11px] text-black/50">ID référentiel · {work.code}</p></div><button disabled={busy} type="button" onClick={()=>onRemove(work)} aria-label={`Retirer ${work.label_fr}`} className="min-h-11 shrink-0 rounded-lg px-2 text-xs font-semibold text-red-700 hover:bg-red-50">Retirer</button></li>)}</ul>}
    </li>)}</ul>
    <details className="mt-3 text-xs text-black/55"><summary className="flex min-h-11 cursor-pointer items-center gap-1 font-semibold"><ChevronDown size={14}/>Provenance</summary><p>{lot.source.label} · version {lot.source.version??'non indiquée'}. {lot.source.scope}</p></details>
  </li>)}</ol>;
}

export default function BtpAssistantProjectForm({onCancel}:{onCancel:()=>void}) {
  const router=useRouter(); const descriptionRef=useRef<HTMLTextAreaElement>(null);
  const [projectType,setProjectType]=useState<ProjectType>('construction');
  const [description,setDescription]=useState(''); const [command,setCommand]=useState('');
  const [proposal,setProposal]=useState<AssistantProposal|null>(null); const [governorates,setGovernorates]=useState<Territory[]>([]);
  const [governorate,setGovernorate]=useState(''); const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const [message,setMessage]=useState('');

  useEffect(()=>{void Promise.all([
    supabaseBrowser().from('governorates').select('id,name_fr').order('name_fr'),
    api<AssistantProposal|null>('/api/projects/assistant').catch(()=>null),
  ]).then(([territories,draft])=>{setGovernorates(territories.data??[]);if(draft){setProposal(draft);setDescription(draft.summary);setProjectType(draft.projectType);setGovernorate(draft.governorateId??'');setMessage('Votre dernier brouillon a été repris.');}});},[]);

  async function analyze(correction='') {
    if(!description.trim()){setError('Décrivez votre chantier en quelques mots.');descriptionRef.current?.focus();return;}
    setBusy(true);setError('');setMessage('');
    try{const next=await api<AssistantProposal>('/api/projects/assistant',{method:'POST',body:JSON.stringify({draft_id:proposal?.draftId,project_type:projectType,description,governorate_id:governorate||null,command:correction})});setProposal(next);setCommand('');setMessage(correction?'La proposition a été mise à jour sans perdre vos autres choix.':'Première proposition préparée depuis le référentiel D.A.O.');}
    catch(exception:any){setError(exception.message);}finally{setBusy(false);}
  }
  async function create() {
    if(!proposal)return;
    if(!governorate){setError('Choisissez le gouvernorat avant de créer le chantier.');document.getElementById('assistant-governorate')?.focus();return;}
    setBusy(true);setError('');
    try{
      let current=proposal;
      if(proposal.governorateId!==governorate) current=await api<AssistantProposal>('/api/projects/assistant',{method:'POST',body:JSON.stringify({draft_id:proposal.draftId,project_type:projectType,description,governorate_id:governorate})});
      const key=globalThis.crypto?.randomUUID?.()??`${Date.now()}-${current.draftId}`;
      const result=await api<{project_id:string}>('/api/projects/assistant/create',{method:'POST',body:JSON.stringify({draft_id:current.draftId,creation_key:key})});
      router.push(`/app/projects/${result.project_id}`);
    }catch(exception:any){setError(/fetch|network/i.test(exception.message)?'Connexion interrompue. Le serveur empêchera une création en double : vérifiez Mes chantiers avant de réessayer.':exception.message);}finally{setBusy(false);}
  }

  return <section className="mx-auto max-w-4xl space-y-6">
    <CreationHeader eyebrow="Assistant BTP" title="Décrivez votre chantier simplement" description="Une proposition immédiate fondée sur le référentiel D.A.O., que vous gardez sous votre contrôle." onBack={onCancel} backLabel="Changer de parcours" />
    <Panel title="1. Votre besoin" description="Écrivez librement en français. Les formulations tunisiennes pourront être enrichies progressivement.">
      <div className="grid gap-4 sm:grid-cols-[220px_1fr]"><Field id="assistant-type" label="Type de projet"><select id="assistant-type" className={controlClass()} value={projectType} onChange={event=>setProjectType(event.target.value as ProjectType)}>{Object.entries(typeLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></Field>
        <Field id="assistant-description" label="Description libre"><textarea ref={descriptionRef} id="assistant-description" className={cn(controlClass(), 'min-h-32 resize-y')} maxLength={8000} value={description} onChange={event=>setDescription(event.target.value)} placeholder="Ex. Villa R+1 à Sousse, 180 m² construits au total, cuisine séparée, garage, jardin et terrasse si possible, sans piscine. Plans non réalisés." /></Field></div>
      {error&&!proposal&&<FormAlert>{error}</FormAlert>}
      <button disabled={busy} type="button" onClick={()=>void analyze()} className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-teal px-5 font-semibold text-white hover:bg-tealdark disabled:opacity-60 sm:w-auto">{busy?<Loader2 className="animate-spin" size={17}/>:<Sparkles size={17}/>}Préparer une proposition</button>
    </Panel>

    {proposal&&<>
      <Panel title="2. Proposition éditable" description="Connu = lu dans votre texte. Proposé = référentiel D.A.O. À confirmer = information technique ou administrative manquante.">
        {message&&<p role="status" className="mb-4 flex items-center gap-2 rounded-xl bg-teal/[0.07] px-4 py-3 text-sm font-medium text-teal"><Check size={16}/>{message}</p>}
        <div className="rounded-xl bg-sand/60 p-4"><h3 className="font-bold">{proposal.title}</h3><p className="mt-1 whitespace-pre-wrap text-sm text-ink/70">{proposal.summary}</p><div className="mt-3 flex flex-wrap gap-2">{proposal.facts.map(fact=><span key={fact.key} className="rounded-full bg-white px-3 py-1 text-xs"><strong>{fact.label} :</strong> {fact.value} · {fact.confidence==='known'?'Connu':fact.confidence==='proposed'?'Proposé':'À confirmer'}</span>)}</div></div>
        {proposal.question&&<p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"><strong>Question utile :</strong> {proposal.question}</p>}
        <div className="mt-5"><Tree items={proposal.items} busy={busy} onRemove={item=>void analyze(`retire ${item.label_fr}`)}/></div>
        <div className="mt-5 rounded-xl border border-black/[0.08] p-4"><label htmlFor="assistant-command" className="font-semibold">Modifier avec vos mots</label><p className="mt-1 text-sm text-black/55">Ex. « ajoute terrasse », « retire garage », « ajoute cuisine ».</p><div className="mt-3 flex flex-col gap-2 sm:flex-row"><input id="assistant-command" className={controlClass()} value={command} onChange={event=>setCommand(event.target.value)} maxLength={500}/><button disabled={busy||!command.trim()} type="button" onClick={()=>void analyze(command)} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-ink px-4 font-semibold text-white disabled:opacity-50"><Send size={16}/>Appliquer</button></div></div>
        <div className="mt-5 rounded-xl bg-clay/[0.06] p-4 text-sm text-ink/75"><p className="flex items-center gap-2 font-semibold"><ShieldCheck size={16} className="text-clay"/>Limites affichées honnêtement</p><ul className="mt-2 list-disc space-y-1 pl-5">{proposal.limitations.map(item=><li key={item}>{item}</li>)}</ul><p className="mt-2 text-xs">Mode actuel : moteur déterministe annoncé. Aucun résultat n’est présenté comme provenant d’un LLM.</p></div>
      </Panel>
      <Panel title="3. Créer le chantier" description="Votre brouillon est déjà enregistré. Confirmez seulement la localisation nécessaire à la création.">
        <Field id="assistant-governorate" label="Gouvernorat" hint="Obligatoire pour le chantier, sans déduire une adresse précise."><select id="assistant-governorate" className={controlClass()} value={governorate} onChange={event=>setGovernorate(event.target.value)}><option value="">Choisir…</option>{governorates.map(item=><option key={item.id} value={item.id}>{item.name_fr}</option>)}</select></Field>
        {error&&<FormAlert>{error}</FormAlert>}
        <div className="mt-5 flex flex-col gap-2 sm:flex-row"><button disabled={busy} type="button" onClick={()=>void create()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-teal px-5 font-semibold text-white disabled:opacity-60">{busy?<Loader2 className="animate-spin" size={17}/>:<ArrowRight size={17}/>}Créer mon chantier</button><Link href="/app/projects" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-black/10 px-5 font-semibold"><RotateCcw size={16}/>Enregistrer comme brouillon</Link></div>
      </Panel>
    </>}
  </section>;
}
