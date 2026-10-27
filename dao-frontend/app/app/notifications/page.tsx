'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Check, CheckCheck, ClipboardCheck, Mail, MessageCircle, RefreshCw, ArrowUpRight } from 'lucide-react';
import { Button, Card } from '../../../components/ui';
import { supabaseBrowser } from '../../../lib/supabase-browser';
import { fetchNotifications, markAllNotificationsRead, markNotificationRead, NotificationApiError, type NotificationItem, type NotificationPage } from '../../../lib/notifications';
import StaffSupportNotifications from './StaffSupportNotifications';
import { supportAvailability } from '../../../lib/support-client';
import { onUnreadChanged } from '../../../lib/unread-events';

const dates=new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeStyle:'short'});
const workspaceLabels={client:'Espace Client',contractor:'Espace Artisan',staff:'Espace D.A.O'};
const icons={review_approved:ClipboardCheck,review_rejected:ClipboardCheck,invitation_received:Mail,invitation_accepted:CheckCheck,project_message:MessageCircle,invitation_expiring:Bell,rfi_question:MessageCircle,rfi_clarification:ClipboardCheck,bid_result:ClipboardCheck};

export default function NotificationsPage() {
  const router=useRouter();
  const [filter,setFilter]=useState<'all'|'unread'|'action'>('all');
  const [identity,setIdentity]=useState<string|null>(null);
  const [page,setPage]=useState<NotificationPage|null>(null);
  const [supportUnread,setSupportUnread]=useState(0);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [marking,setMarking]=useState<string|null>(null);
  const [announcement,setAnnouncement]=useState('');
  const generation=useRef(0);
  const readRequest=useRef<AbortController|null>(null);
  const markRequest=useRef<AbortController|null>(null);
  const lastWorkspace=useRef<string|null>(null);

  useEffect(()=>{
    const {data}=supabaseBrowser().auth.onAuthStateChange((_event,session)=>{
      generation.current++;readRequest.current?.abort();markRequest.current?.abort();
      setPage(null);setError('');setMarking(null);setAnnouncement('');
      lastWorkspace.current=null;
      setIdentity(session?`${session.user.id}:${generation.current}`:'');
      if(!session)router.replace('/auth/login');
    });
    return()=>{generation.current++;readRequest.current?.abort();markRequest.current?.abort();data.subscription.unsubscribe();};
  },[router]);

  const load=useCallback(async(cursor:string|null=null)=>{
    if(!identity)return;
    const current=++generation.current;
    readRequest.current?.abort();const controller=new AbortController();readRequest.current=controller;
    setLoading(true);setError('');
    try {
      let result=await fetchNotifications(filter,cursor,controller.signal);
      if(current!==generation.current)return;
      // A workspace changed in another tab: discard any old cursor/page and load its first page.
      let append=Boolean(cursor);
      if(cursor&&lastWorkspace.current!==result.workspace){result=await fetchNotifications(filter,null,controller.signal);append=false;}
      if(current!==generation.current)return;
      lastWorkspace.current=result.workspace;
      setPage(previous=>append&&previous?.workspace===result.workspace?{...result,rows:[...previous.rows,...result.rows].filter((row,index,rows)=>rows.findIndex(x=>x.id===row.id)===index)}:result);
    } catch(e) {
      if(controller.signal.aborted||current!==generation.current)return;
      if(e instanceof NotificationApiError&&e.status===401){setPage(null);router.replace('/auth/login');return;}
      if(e instanceof NotificationApiError&&e.status===403)setPage(null);
      setError(e instanceof NotificationApiError?e.message:'Impossible de charger vos notifications. Vérifiez votre connexion et réessayez.');
    } finally {if(current===generation.current)setLoading(false);}
  },[identity,filter,router]);

  useEffect(()=>{setPage(null);setAnnouncement('');void load();return()=>{generation.current++;readRequest.current?.abort();};},[load]);
  useEffect(()=>{
    const refresh=()=>{if(document.visibilityState==='visible')void load();};
    window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
    return()=>{window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[load]);

  // The same JWT-scoped summary powers the Messages & Assistance badge.
  // Staff uses its separate queue; no private message content joins this feed.
  useEffect(()=>{
    if(!identity){setSupportUnread(0);return;}
    let active=true;
    const refresh=async()=>{
      const result=await supportAvailability();
      if(active)setSupportUnread(result.state==='available'?Math.max(0,result.summary.unread):0);
    };
    void refresh();
    const onFocus=()=>{if(document.visibilityState==='visible')void refresh();};
    window.addEventListener('focus',onFocus);
    document.addEventListener('visibilitychange',onFocus);
    const stopUnread=onUnreadChanged(()=>void refresh());
    return()=>{active=false;stopUnread();window.removeEventListener('focus',onFocus);document.removeEventListener('visibilitychange',onFocus);};
  },[identity]);

  async function markRead(item:NotificationItem) {
    const current=generation.current;
    markRequest.current?.abort();const controller=new AbortController();markRequest.current=controller;
    setMarking(item.id);setError('');setAnnouncement('');
    try {
      await markNotificationRead(item.id,controller.signal);
      if(current!==generation.current)return;
      setAnnouncement('Notification marquée comme lue.');
      await load();
    } catch(e) {
      if(!controller.signal.aborted&&current===generation.current){
        if(e instanceof NotificationApiError&&e.status===401){setPage(null);router.replace('/auth/login');}
        else {if(e instanceof NotificationApiError&&e.status===403)setPage(null);setError('Lecture non enregistrée. Réessayez.');}
      }
    } finally {if(!controller.signal.aborted)setMarking(null);}
  }
  async function markAll(){const controller=new AbortController();markRequest.current?.abort();markRequest.current=controller;setMarking('all');setError('');try{const data=await markAllNotificationsRead(controller.signal);setAnnouncement(`${data?.marked??0} notification(s) marquée(s) comme lue(s).`);await load();}catch{if(!controller.signal.aborted)setError('Lecture groupée non enregistrée. Réessayez.');}finally{if(!controller.signal.aborted)setMarking(null);}}

  const combinedUnread=(page?.unread_count??0)+(page?.workspace&&page.workspace!=='staff'?supportUnread:0);

  // The general notification RPC intentionally hides staff records. Staff sees its
  // own authenticated support queue instead, without changing private chat RLS.
  if (page?.workspace === 'staff') return <StaffSupportNotifications />;

  return <section className="mx-auto w-full max-w-4xl space-y-6" aria-labelledby="notifications-title">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold uppercase tracking-[.16em] text-teal">{page?workspaceLabels[page.workspace]:'Votre espace personnel'}</p>
        <h1 id="notifications-title" className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Mes notifications</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-black/60">Les événements utiles de vos dossiers, invitations et échanges, réunis ici.</p>
      </div>
      <div className="flex items-center gap-2"><Link href="/app/notifications/preferences" className="inline-flex min-h-11 items-center rounded-xl border border-black/10 bg-white px-3 text-sm font-semibold text-teal focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal">Préférences</Link><button type="button" onClick={()=>void load()} disabled={loading||Boolean(marking)||!identity} aria-label="Actualiser les notifications"
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-black/10 bg-white px-3 text-teal hover:bg-teal/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal disabled:opacity-50"><RefreshCw size={18} aria-hidden="true" className={loading?'animate-spin':''}/></button>
      </div>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div role="group" aria-label="Filtrer les notifications" className="inline-flex rounded-xl border border-black/5 bg-white p-1">
        {([['all','Toutes'],['unread','Non lues'],['action','Action à traiter']] as const).map(([value,label])=><button key={value} type="button" aria-pressed={filter===value} disabled={Boolean(marking)} onClick={()=>setFilter(value)}
          className={`min-h-11 rounded-lg px-4 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal ${filter===value?'bg-teal text-white':'text-black/60 hover:bg-sand'}`}>{label}</button>)}
      </div>
      <div className="flex flex-wrap items-center gap-2">{page&&page.unread_count>0&&<button type="button" onClick={()=>void markAll()} disabled={Boolean(marking)||loading} className="min-h-11 rounded-xl border border-black/10 px-3 text-sm font-semibold text-teal disabled:opacity-50">{supportUnread>0?'Marquer les autres notifications comme lues':'Tout marquer comme lu'}</button>}{page&&<span className="rounded-full bg-teal/10 px-3 py-2 text-sm font-semibold text-teal" aria-label={`${combinedUnread} notifications non lues`}>{combinedUnread} non lue{combinedUnread!==1?'s':''}</span>}</div>
    </div>
    <p role="status" aria-live="polite" className="sr-only">{loading?'Chargement des notifications…':announcement}</p>
    {error&&<div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-800"><p className="min-w-0 flex-1">{error}</p>
      <button type="button" onClick={()=>void load()} disabled={loading} className="min-h-11 rounded-xl border border-red-200 px-4 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-700">Réessayer</button></div>}
    {page&&supportUnread>0&&filter!=='action'&&<Card className="border-teal/15 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal/10 text-teal"><MessageCircle size={21} aria-hidden="true"/></span>
        <div className="min-w-0 flex-1">
          <h2 className="font-bold">Assistance D.A.O. — {supportUnread} réponse{supportUnread>1?'s':''} non lue{supportUnread>1?'s':''}</h2>
          <p className="mt-1 text-sm text-black/60">Consultez vos demandes pour lire les réponses de l’équipe D.A.O.</p>
        </div>
        <Link href="/app/messages?onglet=assistance" className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-black/10 bg-white px-4 text-sm font-semibold text-teal hover:bg-teal/5">Voir mes demandes d’assistance<ArrowUpRight size={15} aria-hidden="true"/></Link>
      </div>
    </Card>}
    {loading&&!page?<div aria-busy="true" className="space-y-3">{[0,1,2].map(i=><div key={i} aria-hidden="true" className="h-28 animate-pulse rounded-2xl bg-black/5"/>)}</div>
      :page&&page.rows.length===0&&!(supportUnread>0&&filter!=='action')?<Card className="flex flex-col items-center gap-3 border-dashed px-5 py-14 text-center">
        <span aria-hidden="true" className="flex h-14 w-14 items-center justify-center rounded-2xl bg-teal/10 text-teal"><Bell size={26}/></span>
        <h2 className="text-lg font-bold">{filter==='unread'?'Vous êtes à jour':filter==='action'?'Aucune action à traiter':'Aucune notification pour le moment'}</h2>
        <p className="max-w-md text-sm leading-relaxed text-black/60">{filter==='unread'?'Vous avez consulté toutes les notifications disponibles dans cet espace.':filter==='action'?'Aucun rappel facultatif ne demande votre attention.':'Vos prochaines notifications apparaîtront ici lorsqu’un événement vous concernera.'}</p>
      </Card>:page&&page.rows.length>0&&<Card className="overflow-hidden p-0"><ul aria-label="Notifications personnelles" className="divide-y divide-black/5">{page.rows.map(item=>{
        const Icon=icons[item.kind];const isUnread=!item.read_at;
        return <li key={item.id} className={`px-4 py-5 sm:px-6 ${isUnread?'bg-teal/[.035]':''}`}>
          <div className="flex items-start gap-3 sm:gap-4">
            <span aria-hidden="true" className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${isUnread?'bg-teal/10 text-teal':'bg-sand text-black/50'}`}><Icon size={21}/></span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><h2 className={`text-base ${isUnread?'font-bold':'font-semibold'}`}>{item.title}</h2>{item.action_required&&<span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-900">Action requise</span>}<span className={`text-xs font-semibold ${isUnread?'text-teal':'text-black/50'}`}>{isUnread?'Non lue':'Lue'}</span></div>
              {item.expires_at&&<p className="mt-1 text-sm font-semibold text-amber-900">Expire le <time dateTime={item.expires_at}>{dates.format(new Date(item.expires_at))}</time></p>}
              <time dateTime={item.created_at} className="mt-1 block text-xs text-black/55">{dates.format(new Date(item.created_at))}</time>
              <div className="mt-3 flex flex-wrap items-center gap-2 sm:gap-3">
                <Link href={item.href} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-black/10 bg-white px-3 text-sm font-semibold text-teal hover:bg-teal/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal">Consulter<span className="sr-only"> : {item.title}</span><ArrowUpRight size={15} aria-hidden="true"/></Link>
                {isUnread&&<button type="button" onClick={()=>void markRead(item)} disabled={Boolean(marking)||loading} aria-label={`Marquer comme lue : ${item.title}`}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-black/60 hover:bg-sand focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal disabled:opacity-50"><Check size={16} aria-hidden="true"/>{marking===item.id?'Enregistrement…':'Marquer comme lue'}</button>}
              </div>
            </div>
          </div>
        </li>;
      })}</ul></Card>}
    {page?.next_cursor&&<div className="flex justify-center"><Button className="min-h-11" disabled={loading||Boolean(marking)} onClick={()=>void load(page.next_cursor)}>{loading?'Chargement…':'Charger plus'}</Button></div>}
  </section>;
}
