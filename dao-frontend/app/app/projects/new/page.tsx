'use client';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '../../../../lib/supabase-browser';
import { Button, Card, Input } from '../../../../components/ui';

type Territory={id:string;name_fr:string;governorate_id?:string;delegation_id?:string};
const moneyToMillimes=(value:string)=>value?Math.round(Number(value)*1000):null;

export default function NewProject(){
 const router=useRouter();
 const [form,setForm]=useState({title:'',description:'',type:'renovation',surface:'',budget:'',date:'',governorate:'',delegation:'',locality:''});
 const [governorates,setGovernorates]=useState<Territory[]>([]); const [delegations,setDelegations]=useState<Territory[]>([]); const [localities,setLocalities]=useState<Territory[]>([]);
 const [error,setError]=useState(''); const [saving,setSaving]=useState(false);
 const update=(key:string,value:string)=>setForm(v=>({...v,[key]:value,...(key==='governorate'?{delegation:'',locality:''}:{}),...(key==='delegation'?{locality:''}:{})}));
 useEffect(()=>{void (async()=>{const s=supabaseBrowser();const {data}=await s.from('governorates').select('id,name_fr').order('name_fr');setGovernorates(data??[]);})();},[]);
 useEffect(()=>{if(!form.governorate){setDelegations([]);return;}void (async()=>{const {data}=await supabaseBrowser().from('delegations').select('id,name_fr,governorate_id').eq('governorate_id',form.governorate).order('name_fr');setDelegations(data??[]);})();},[form.governorate]);
 useEffect(()=>{if(!form.delegation){setLocalities([]);return;}void (async()=>{const {data}=await supabaseBrowser().from('localities').select('id,name_fr,delegation_id').eq('delegation_id',form.delegation).order('name_fr');setLocalities(data??[]);})();},[form.delegation]);
 async function submit(e:FormEvent){e.preventDefault();setError('');
  if(!form.title.trim()||!form.governorate){setError('Renseignez au minimum le titre et le gouvernorat.');return;}
  setSaving(true);const s=supabaseBrowser();const {data:sd}=await s.auth.getSession();const session=sd.session;
  if(!session){router.push('/auth/login');return;}
  const headers={'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`};
  const created=await fetch('/api/projects',{method:'POST',headers,body:JSON.stringify({project_type:form.type,surface_m2:form.surface?Number(form.surface):null,desired_start_date:form.date||null,indicative_budget_millimes:moneyToMillimes(form.budget),governorate_id:form.governorate,delegation_id:form.delegation||null,locality_id:form.locality||null})});
  const payload=await created.json(); if(!created.ok||!payload.data?.id){setError(payload.error||'Impossible de créer le projet.');setSaving(false);return;}
  const updated=await fetch('/api/projects',{method:'PATCH',headers,body:JSON.stringify({project_id:payload.data.id,title:form.title,description:form.description,project_type:form.type,surface_m2:form.surface?Number(form.surface):null,desired_start_date:form.date||null,indicative_budget_millimes:moneyToMillimes(form.budget),governorate_id:form.governorate,delegation_id:form.delegation||null,locality_id:form.locality||null})});
  const updatePayload=await updated.json(); if(!updated.ok){setError(updatePayload.error||'Projet créé mais informations incomplètes.');setSaving(false);return;}
  router.push(`/app/projects/${payload.data.id}`);
 }
 const selectClass='mt-2 w-full rounded-xl border border-black/10 bg-white px-3.5 py-3';
 return <section className="mx-auto max-w-3xl"><p className="text-sm font-semibold text-teal">Nouveau projet</p><h1 className="mt-1 text-3xl font-bold">Décrivons votre chantier</h1><Card className="mt-8"><form onSubmit={submit} className="space-y-5">
  <label className="block text-sm font-semibold">Titre du projet<Input required value={form.title} onChange={e=>update('title',e.target.value)} placeholder="Ex. Maison S+3 à Sahloul"/></label>
  <label className="block text-sm font-semibold">Description<textarea className={selectClass} rows={4} value={form.description} onChange={e=>update('description',e.target.value)} placeholder="Décrivez le besoin global"/></label>
  <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-semibold">Type<select className={selectClass} value={form.type} onChange={e=>update('type',e.target.value)}><option value="construction">Construction</option><option value="renovation">Rénovation</option><option value="repair">Réparation</option><option value="extension">Extension</option><option value="other">Autre</option></select></label><label className="block text-sm font-semibold">Surface (m²)<Input type="number" min="1" value={form.surface} onChange={e=>update('surface',e.target.value)} placeholder="180"/></label></div>
  <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-semibold">Budget indicatif (TND)<Input type="number" min="0" step="0.001" value={form.budget} onChange={e=>update('budget',e.target.value)} placeholder="150000"/></label><label className="block text-sm font-semibold">Date souhaitée<Input type="date" value={form.date} onChange={e=>update('date',e.target.value)}/></label></div>
  <div className="grid gap-4 sm:grid-cols-3"><label className="block text-sm font-semibold">Gouvernorat<select required className={selectClass} value={form.governorate} onChange={e=>update('governorate',e.target.value)}><option value="">Choisir…</option>{governorates.map(x=><option key={x.id} value={x.id}>{x.name_fr}</option>)}</select></label><label className="block text-sm font-semibold">Délégation<select className={selectClass} value={form.delegation} disabled={!form.governorate} onChange={e=>update('delegation',e.target.value)}><option value="">Choisir…</option>{delegations.map(x=><option key={x.id} value={x.id}>{x.name_fr}</option>)}</select></label><label className="block text-sm font-semibold">Localité<select className={selectClass} value={form.locality} disabled={!form.delegation} onChange={e=>update('locality',e.target.value)}><option value="">Choisir…</option>{localities.map(x=><option key={x.id} value={x.id}>{x.name_fr}</option>)}</select></label></div>
  {error&&<p className="text-sm text-red-600" role="alert">{error}</p>}<Button disabled={saving}>{saving?'Enregistrement…':'Créer le projet et ajouter les demandes'}</Button>
 </form></Card></section>;
}