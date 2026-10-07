'use client';
import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabaseBrowser } from '../../../lib/supabase-browser';
import { Button, Card, Input } from '../../../components/ui';
export default function ActivateStaff(){
 const [ready,setReady]=useState(false),[password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[error,setError]=useState(''),[saving,setSaving]=useState(false),[complete,setComplete]=useState(false);
 useEffect(()=>{let active=true;void(async()=>{// Supabase Auth invitations use an implicit token fragment, while the shared
 // SSR browser client uses PKCE. Consume it with the standard Auth session API
 // before client initialization, then remove credentials from the address bar.
 const fragment=new URLSearchParams(window.location.hash.slice(1));
 const access_token=fragment.get('access_token'),refresh_token=fragment.get('refresh_token');
 if(fragment.get('type')==='invite')window.history.replaceState(null,'',window.location.pathname+window.location.search);
 const db=supabaseBrowser();
 if(access_token&&refresh_token){const session=await db.auth.setSession({access_token,refresh_token});if(session.error){if(active)setError('Lien invalide ou expiré. Demandez une nouvelle invitation à l’Admin.');return;}}
 const {data,error}=await db.auth.getUser();if(error||!data.user){if(active)setError('Lien invalide ou expiré. Demandez une nouvelle invitation à l’Admin.');return;}const roles=await db.from('user_roles').select('role').eq('user_id',data.user.id);if(!roles.data?.some(r=>['dao_admin','dao_reviewer'].includes(r.role))){if(active)setError('L’affectation staff est encore en cours. Rechargez cette page dans quelques instants.');return;}if(active)setReady(true);})();return()=>{active=false;};},[]);
 async function submit(e:FormEvent){e.preventDefault();if(!ready||saving)return;setError('');if(password.length<8||password!==confirm){setError('Saisissez deux mots de passe identiques d’au moins 8 caractères.');return;}setSaving(true);try{const {error}=await supabaseBrowser().auth.updateUser({password});if(error)throw Error('Impossible de définir le mot de passe.');setPassword('');setConfirm('');setComplete(true);}catch(e:any){setError(e.message);}finally{setSaving(false);}}
 return <main className="flex min-h-screen items-center justify-center px-5"><Card className="w-full max-w-md"><h1 className="text-2xl font-bold">Activer votre accès D.A.O</h1>{error&&<p role="alert" className="mt-4 text-red-700">{error}</p>}{complete?<><p role="status" className="mt-4">Votre mot de passe est enregistré.</p><Link className="mt-4 inline-block text-teal" href="/app/dao">Ouvrir le back-office</Link></>:ready?<form onSubmit={submit} className="mt-5 space-y-4"><label>Nouveau mot de passe<Input required type="password" autoComplete="new-password" minLength={8} value={password} onChange={e=>setPassword(e.target.value)} /></label><label>Confirmer le mot de passe<Input required type="password" autoComplete="new-password" minLength={8} value={confirm} onChange={e=>setConfirm(e.target.value)} /></label><Button disabled={saving}>Activer mon accès</Button></form>:!error&&<p className="mt-4">Vérification de l’invitation…</p>}</Card></main>;
}
