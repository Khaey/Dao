'use client';

import Link from 'next/link';
import { useEffect,useRef,useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft,Bell } from 'lucide-react';
import { Card } from '../../../../components/ui';
import { fetchNotificationPreferences,NotificationApiError,updateNotificationPreferences } from '../../../../lib/notifications';

export default function NotificationPreferencesPage(){
  const router=useRouter(),controller=useRef<AbortController|null>(null);
  const [enabled,setEnabled]=useState<boolean|null>(null),[workspace,setWorkspace]=useState(''),[saving,setSaving]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('');
  useEffect(()=>{const c=new AbortController();controller.current=c;fetchNotificationPreferences(c.signal).then(data=>{if(!data||!['client','contractor'].includes(data.workspace)||typeof data.invitation_expiring!=='boolean')throw new NotificationApiError(503);setEnabled(data.invitation_expiring);setWorkspace(data.workspace);}).catch(e=>{if(c.signal.aborted)return;if(e instanceof NotificationApiError&&e.status===401)router.replace('/auth/login');else setError('Impossible de charger les préférences. Réessayez.');});return()=>c.abort();},[router]);
  async function change(value:boolean){const c=new AbortController();controller.current?.abort();controller.current=c;setSaving(true);setError('');setStatus('');try{const data=await updateNotificationPreferences(value,c.signal);if(data?.invitation_expiring!==value)throw new Error();setEnabled(value);setStatus('Préférence enregistrée pour cet espace.');}catch{if(!c.signal.aborted)setError('Préférence non enregistrée. Réessayez.');}finally{if(!c.signal.aborted)setSaving(false);}}
  return <section className="mx-auto w-full max-w-2xl space-y-6" aria-labelledby="preferences-title">
    <Link href="/app/notifications" className="inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-semibold text-teal focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal"><ArrowLeft size={18}/>Retour aux notifications</Link>
    <div><p className="text-xs font-bold uppercase tracking-[.16em] text-teal">{workspace==='contractor'?'Espace Artisan':'Espace Client'}</p><h1 id="preferences-title" className="mt-2 text-3xl font-bold">Préférences de notifications</h1><p className="mt-2 text-sm leading-relaxed text-black/60">Les événements transactionnels restent visibles. Vous contrôlez uniquement les rappels facultatifs de l’espace courant.</p></div>
    {error&&<p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}<p role="status" aria-live="polite" className="sr-only">{status}</p>
    <Card className="flex flex-wrap items-center justify-between gap-4 p-5"><div className="flex min-w-0 flex-1 gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal/10 text-teal"><Bell size={20}/></span><div><h2 className="font-bold">Invitation bientôt expirée</h2><p className="mt-1 text-sm text-black/60">Rappel dans les 24 heures précédant l’échéance, uniquement si l’invitation reste valide.</p></div></div><button type="button" role="switch" aria-checked={enabled??false} disabled={enabled===null||saving} onClick={()=>void change(!enabled)} className={`min-h-11 min-w-24 rounded-xl px-4 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal disabled:opacity-50 ${enabled?'bg-teal text-white':'bg-black/10 text-black/70'}`}>{saving?'Enregistrement…':enabled?'Activé':'Désactivé'}</button></Card>
  </section>;
}
