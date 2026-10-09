'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Menu, X, LayoutDashboard, FolderKanban, HardHat, ShieldCheck, Megaphone, LogOut, Mail, ReceiptText } from 'lucide-react';
import { supabaseBrowser } from '../../lib/supabase-browser';
import { isDaoStaff, type AppRole } from '../../lib/roles';

export default function RoleNav() {
  const router = useRouter();
  const pathname = usePathname();
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [email, setEmail] = useState('');
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [workspace, setWorkspace] = useState<'client'|'contractor'>('client');
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    const supabase = supabaseBrowser();
    let active = true;
    const load = async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      if (!data.session) { router.replace('/auth/login'); return; }
      setEmail(data.session.user.email ?? '');
      const [{ data: roleRows }, { data: profile }] = await Promise.all([
        supabase.from('user_roles').select('role').eq('user_id', data.session.user.id),
        supabase.from('profiles').select('last_workspace').eq('user_id', data.session.user.id).maybeSingle(),
      ]);
      if (!active) return;
      setRoles((roleRows ?? []).map((row: { role: AppRole }) => row.role));
      setWorkspace(profile?.last_workspace === 'contractor' ? 'contractor' : 'client');
      setReady(true);
    };
    void load();
    const { data: subscription } = supabase.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') router.replace('/auth/login'); });
    return () => { active = false; subscription.subscription.unsubscribe(); };
  }, [router]);

  async function signOut() { await supabaseBrowser().auth.signOut(); router.replace('/auth/login'); }
  async function switchWorkspace(next:'client'|'contractor') { setSwitching(true); const {error}=await supabaseBrowser().rpc('set_my_workspace',{p_workspace:next}); if(!error){setWorkspace(next);setOpen(false);router.push('/app');router.refresh()} setSwitching(false); }
  const has = (role: AppRole) => roles.includes(role);
  const staff = isDaoStaff(roles);
  const homeHref = staff ? '/app/dao' : '/app';
  const active = (href: string) => href==='/app/artisan'
    ? pathname===href||pathname.startsWith('/app/artisan/publications/')
    : pathname === href || (!['/app', '/app/dao'].includes(href) && pathname.startsWith(`${href}/`));
  const links = [
    { href: '/app', label: 'Tableau de bord', icon: LayoutDashboard, show: !staff && (has('client') || has('contractor')) },
    { href: '/app/dao', label: 'Tableau de bord', icon: LayoutDashboard, show: staff },
    { href: '/app/projects', label: 'Mes chantiers', icon: FolderKanban, show: has('client') || has('contractor') },
    { href: '/app/artisan', label: 'DAO disponibles', icon: HardHat, show: has('contractor') },
    { href: '/app/artisan/offers', label: 'Mes offres', icon: ReceiptText, show: has('contractor') },
    { href: '/app/invitations', label: 'Mes invitations', icon: Mail, show: !staff && (has('client') || has('contractor')) },
    { href: '/app/dao/review', label: 'Revues', icon: ShieldCheck, show: staff },
    { href: '/app/dao/publications', label: 'Publications', icon: Megaphone, show: staff },
    { href: '/app/dao/projects', label: 'Chantiers', icon: FolderKanban, show: staff },
    { href: '/app/dao/professionals', label: 'Professionnels', icon: HardHat, show: staff },
    { href: '/app/dao/clients', label: 'Clients', icon: ShieldCheck, show: staff },
    { href: '/app/dao/history', label: 'Historique', icon: ShieldCheck, show: staff },
    { href: '/app/dao/users', label: 'Utilisateurs & rôles', icon: ShieldCheck, show: has('dao_admin') },
  ];

  if (!ready) return <div className="h-10 w-10 animate-pulse rounded-xl bg-sand" aria-label="Chargement de la navigation" />;
  return <>
    <button type="button" className="fixed left-4 top-3 z-40 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-black/10 bg-white lg:hidden" aria-label="Ouvrir le menu" onClick={() => setOpen(true)}><Menu size={20} /></button>
    <aside className="hidden w-64 shrink-0 border-r border-black/5 bg-white lg:flex lg:flex-col">
      <div className="sticky top-0 flex h-screen flex-col p-4">
        <Link href={homeHref} className="px-3 py-3 text-xl font-bold tracking-tight">D.A.O<span className="text-clay">.</span></Link>
        <p className="px-3 pb-3 text-[11px] font-bold uppercase tracking-[0.16em] text-black/35">Espace de travail</p>
        {has('client')&&has('contractor')&&<div className="mb-4 grid grid-cols-2 rounded-xl bg-sand p-1 text-xs font-semibold"><button disabled={switching} onClick={()=>void switchWorkspace('client')} className={`rounded-lg px-2 py-2 ${workspace==='client'?'bg-white text-teal shadow-sm':'text-black/50'}`}>Client</button><button disabled={switching} onClick={()=>void switchWorkspace('contractor')} className={`rounded-lg px-2 py-2 ${workspace==='contractor'?'bg-white text-teal shadow-sm':'text-black/50'}`}>Artisan</button></div>}
        <nav className="space-y-1">{links.filter(item => item.show).map(item => { const Icon = item.icon; return <Link key={item.href} href={item.href} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${active(item.href) ? 'bg-teal/10 text-teal' : 'text-black/60 hover:bg-sand hover:text-ink'}`}><Icon size={17} strokeWidth={1.8} />{item.label}</Link>; })}</nav>
        <div className="mt-auto border-t border-black/5 pt-4"><Link href="/app/profile" className="flex items-center gap-3 rounded-xl p-3 hover:bg-sand"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-xs font-bold text-white">{email.slice(0, 1).toUpperCase() || 'D'}</span><span className="min-w-0"><span className="block truncate text-sm font-semibold">Mon compte</span><span className="block truncate text-xs text-black/45">{email}</span></span></Link><button type="button" onClick={() => void signOut()} className="mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-black/55 hover:bg-red-50 hover:text-red-700"><LogOut size={17} />Déconnexion</button></div>
      </div>
    </aside>
    <div className="fixed right-4 top-3 z-40 flex items-center gap-3 lg:hidden"><button type="button" onClick={() => void signOut()} className="rounded-xl border border-black/10 bg-white px-3 py-2 text-xs font-semibold text-black/60">Déconnexion</button></div>
    {open && <div className="fixed inset-0 z-50 lg:hidden"><button aria-label="Fermer le menu" className="absolute inset-0 bg-ink/30" onClick={() => setOpen(false)} /><aside className="relative flex h-full w-[min(86vw,20rem)] flex-col bg-white p-5 shadow-2xl"><div className="flex items-center justify-between"><Link href={homeHref} className="text-xl font-bold">D.A.O<span className="text-clay">.</span></Link><button type="button" aria-label="Fermer le menu" onClick={() => setOpen(false)}><X size={21} /></button></div><p className="mt-8 text-[11px] font-bold uppercase tracking-[0.16em] text-black/35">Espace de travail</p>{has('client')&&has('contractor')&&<div className="mt-3 grid grid-cols-2 rounded-xl bg-sand p-1 text-xs font-semibold"><button disabled={switching} onClick={()=>void switchWorkspace('client')} className={`rounded-lg px-2 py-2 ${workspace==='client'?'bg-white text-teal shadow-sm':'text-black/50'}`}>Client</button><button disabled={switching} onClick={()=>void switchWorkspace('contractor')} className={`rounded-lg px-2 py-2 ${workspace==='contractor'?'bg-white text-teal shadow-sm':'text-black/50'}`}>Artisan</button></div>}<nav className="mt-3 space-y-1">{links.filter(item => item.show).map(item => { const Icon = item.icon; return <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold ${active(item.href) ? 'bg-teal/10 text-teal' : 'text-black/60'}`}><Icon size={18} />{item.label}</Link>; })}</nav><div className="mt-auto"><Link href="/app/profile" onClick={() => setOpen(false)} className="mb-2 flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold text-black/60"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-xs font-bold text-white">{email.slice(0, 1).toUpperCase() || 'D'}</span><span><span className="block">Mon compte</span><span className="block text-xs font-normal text-black/45">{email}</span></span></Link><button type="button" onClick={() => void signOut()} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold text-red-700"><LogOut size={18} />Déconnexion</button></div></aside></div>}
  </>;
}
