'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Menu, X, LayoutDashboard, FolderKanban, HardHat, ShieldCheck, UserRound, LogOut } from 'lucide-react';
import { supabaseBrowser } from '../../lib/supabase-browser';

type Role = 'client' | 'contractor' | 'dao_reviewer' | 'dao_admin';

export default function RoleNav() {
  const router = useRouter();
  const pathname = usePathname();
  const [roles, setRoles] = useState<Role[]>([]);
  const [email, setEmail] = useState('');
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const supabase = supabaseBrowser();
    let active = true;
    const load = async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      if (!data.session) { router.replace('/auth/login'); return; }
      setEmail(data.session.user.email ?? '');
      await fetch('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` }, body: '{}' });
      const { data: roleRows } = await supabase.from('user_roles').select('role').eq('user_id', data.session.user.id);
      if (!active) return;
      setRoles((roleRows ?? []).map((row: { role: Role }) => row.role));
      setReady(true);
    };
    void load();
    const { data: subscription } = supabase.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') router.replace('/auth/login'); });
    return () => { active = false; subscription.subscription.unsubscribe(); };
  }, [router]);

  async function signOut() { await supabaseBrowser().auth.signOut(); router.replace('/auth/login'); }
  const has = (role: Role) => roles.includes(role);
  const active = (href: string) => pathname === href || (href !== '/app' && pathname.startsWith(href));
  const links = [
    { href: '/app', label: 'Tableau de bord', icon: LayoutDashboard, show: has('client') || has('contractor') || roles.length > 0 },
    { href: '/app/projects', label: 'Mes projets', icon: FolderKanban, show: has('client') },
    { href: '/app/artisan', label: 'Espace artisan', icon: HardHat, show: has('contractor') },
    { href: '/app/dao/review', label: 'Revue DAO', icon: ShieldCheck, show: has('dao_reviewer') || has('dao_admin') },
    { href: '/app/profile', label: 'Mon espace', icon: UserRound, show: true },
  ];

  if (!ready) return <div className="h-10 w-10 animate-pulse rounded-xl bg-sand" aria-label="Chargement de la navigation" />;
  return <>
    <button type="button" className="fixed left-4 top-3 z-40 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-black/10 bg-white lg:hidden" aria-label="Ouvrir le menu" onClick={() => setOpen(true)}><Menu size={20} /></button>
    <aside className="hidden w-64 shrink-0 border-r border-black/5 bg-white lg:flex lg:flex-col">
      <div className="sticky top-0 flex h-screen flex-col p-4">
        <Link href="/app" className="px-3 py-3 text-xl font-bold tracking-tight">D.A.O<span className="text-clay">.</span></Link>
        <p className="px-3 pb-3 text-[11px] font-bold uppercase tracking-[0.16em] text-black/35">Espace de travail</p>
        <nav className="space-y-1">{links.filter(item => item.show).map(item => { const Icon = item.icon; return <Link key={item.href} href={item.href} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${active(item.href) ? 'bg-teal/10 text-teal' : 'text-black/60 hover:bg-sand hover:text-ink'}`}><Icon size={17} strokeWidth={1.8} />{item.label}</Link>; })}</nav>
        <div className="mt-auto border-t border-black/5 pt-4"><Link href="/app/profile" className="flex items-center gap-3 rounded-xl p-3 hover:bg-sand"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-xs font-bold text-white">{email.slice(0, 1).toUpperCase() || 'D'}</span><span className="min-w-0"><span className="block truncate text-sm font-semibold">Mon compte</span><span className="block truncate text-xs text-black/45">{email}</span></span></Link><button type="button" onClick={() => void signOut()} className="mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-black/55 hover:bg-red-50 hover:text-red-700"><LogOut size={17} />Déconnexion</button></div>
      </div>
    </aside>
    <div className="fixed right-4 top-3 z-40 flex items-center gap-3 lg:hidden"><Link href="/app/profile" className="hidden text-right sm:block"><span className="block text-xs font-semibold">Mon espace</span><span className="block max-w-32 truncate text-[11px] text-black/45">{email}</span></Link><button type="button" onClick={() => void signOut()} className="hidden rounded-xl border border-black/10 bg-white px-3 py-2 text-xs font-semibold text-black/60 sm:inline-flex">Déconnexion</button></div>
    {open && <div className="fixed inset-0 z-50 lg:hidden"><button aria-label="Fermer le menu" className="absolute inset-0 bg-ink/30" onClick={() => setOpen(false)} /><aside className="relative flex h-full w-[min(86vw,20rem)] flex-col bg-white p-5 shadow-2xl"><div className="flex items-center justify-between"><Link href="/app" className="text-xl font-bold">D.A.O<span className="text-clay">.</span></Link><button type="button" aria-label="Fermer le menu" onClick={() => setOpen(false)}><X size={21} /></button></div><p className="mt-8 text-[11px] font-bold uppercase tracking-[0.16em] text-black/35">Espace de travail</p><nav className="mt-3 space-y-1">{links.filter(item => item.show).map(item => { const Icon = item.icon; return <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold ${active(item.href) ? 'bg-teal/10 text-teal' : 'text-black/60'}`}><Icon size={18} />{item.label}</Link>; })}</nav><div className="mt-auto"><button type="button" onClick={() => void signOut()} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold text-red-700"><LogOut size={18} />Déconnexion</button></div></aside></div>}
  </>;
}
