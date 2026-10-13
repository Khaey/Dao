'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Menu, X, LayoutDashboard, FolderKanban, HardHat, ShieldCheck, Megaphone, LogOut, Mail, ReceiptText, MessageCircle, UserRound } from 'lucide-react';
import { supabaseBrowser } from '../../lib/supabase-browser';
import { isDaoStaff, type AppRole } from '../../lib/roles';

export default function RoleNav() {
  const router = useRouter();
  const pathname = usePathname();
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [email, setEmail] = useState('');
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const menuPanel = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
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

  useEffect(() => { setOpen(false); }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    const desktop = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = () => { if (desktop.matches) setOpen(false); };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); return; }
      if (event.key !== 'Tab') return;
      const controls = Array.from(menuPanel.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? [])
        .filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0);
      const first = controls[0], last = controls[controls.length - 1];
      if (!first || !last) return;
      if (!menuPanel.current?.contains(document.activeElement)) {
        event.preventDefault(); first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    desktop.addEventListener('change', closeOnDesktop);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      desktop.removeEventListener('change', closeOnDesktop);
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      menuButton.current?.focus();
    };
  }, [open]);

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
    { href: '/app/artisan/profile', label: 'Mon dossier professionnel', icon: HardHat, show: has('contractor') },
    { href: '/app/professionals', label: 'Trouver un professionnel', icon: HardHat, show: has('client') },
    { href: '/app/invitations', label: 'Mes invitations', icon: Mail, show: !staff && (has('client') || has('contractor')) },
    { href: '/app/messages', label: 'Mes messages', icon: MessageCircle, show: !staff && (has('client') || has('contractor')) },
    { href: '/app/dao/review', label: 'Revues', icon: ShieldCheck, show: staff },
    { href: '/app/dao/publications', label: 'Publications', icon: Megaphone, show: staff },
    { href: '/app/dao/projects', label: 'Chantiers', icon: FolderKanban, show: staff },
    { href: '/app/dao/professionals', label: 'Professionnels', icon: HardHat, show: staff },
    { href: '/app/dao/clients', label: 'Clients', icon: ShieldCheck, show: staff },
    { href: '/app/dao/history', label: 'Historique', icon: ShieldCheck, show: staff },
    { href: '/app/dao/users', label: 'Utilisateurs & rôles', icon: ShieldCheck, show: has('dao_admin') },
  ];

  const workspaceLabel = staff ? (has('dao_admin') ? 'Espace Admin DAO' : 'Espace Gestionnaire DAO') : 'Espace de travail';
  const workspaceSwitch = has('client') && has('contractor') && <div className="mb-3 grid grid-cols-2 rounded-xl bg-sand p-1 text-xs font-semibold">
    <button disabled={switching} onClick={() => void switchWorkspace('client')} className={['min-h-11 rounded-lg px-2 py-2', workspace === 'client' ? 'bg-white text-teal shadow-sm' : 'text-black/50'].join(' ')}>Client</button>
    <button disabled={switching} onClick={() => void switchWorkspace('contractor')} className={['min-h-11 rounded-lg px-2 py-2', workspace === 'contractor' ? 'bg-white text-teal shadow-sm' : 'text-black/50'].join(' ')}>Artisan</button>
  </div>;
  const navigationLinks = links.filter(item => item.show).map(item => {
    const Icon = item.icon;
    return <Link key={item.href} href={item.href} onClick={() => setOpen(false)} aria-current={active(item.href) ? 'page' : undefined}
      className={['flex min-h-11 items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition lg:py-2.5', active(item.href) ? 'bg-teal/10 text-teal' : 'text-black/60 hover:bg-sand hover:text-ink'].join(' ')}>
      <Icon size={18} strokeWidth={1.8} className="shrink-0" /><span>{item.label}</span>
    </Link>;
  });
  const account = <div className="shrink-0 border-t border-black/5 pt-3">
    <Link href="/app/profile" onClick={() => setOpen(false)} className="flex min-w-0 items-center gap-3 rounded-xl p-3 hover:bg-sand">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-white">{email.slice(0, 1).toUpperCase() || 'D'}</span>
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">Mon compte</span><span className="block truncate text-xs text-black/45">{email}</span></span>
    </Link>
    <button type="button" onClick={() => void signOut()} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold text-black/55 hover:bg-red-50 hover:text-red-700"><LogOut size={18} className="shrink-0" />Déconnexion</button>
  </div>;

  if (!ready) return <div className="h-10 w-10 animate-pulse rounded-xl bg-sand" aria-label="Chargement de la navigation" />;
  return <>
    <header className="fixed inset-x-0 top-0 z-40 border-b border-black/5 bg-sand/95 backdrop-blur lg:hidden">
      <div className="grid h-16 grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-3 px-4">
        <button ref={menuButton} type="button" className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-black/10 bg-white" aria-label="Ouvrir le menu" aria-haspopup="dialog" aria-expanded={open} aria-controls="mobile-workspace-menu" onClick={() => setOpen(true)}><Menu size={21} /></button>
        <Link href={homeHref} className="min-w-0 justify-self-center text-center"><span className="block text-xl font-bold tracking-tight">D.A.O<span className="text-clay">.</span></span><span className="block truncate text-[10px] font-semibold text-black/55">{workspaceLabel}</span></Link>
        <Link href="/app/profile" aria-label="Mon compte" className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-black/10 bg-white text-teal"><UserRound size={21} /></Link>
      </div>
    </header>
    <aside className="hidden w-64 shrink-0 border-r border-black/5 bg-white lg:flex lg:flex-col">
      <div className="sticky top-0 flex h-dvh min-h-0 flex-col p-4">
        <Link href={homeHref} className="shrink-0 px-3 py-3 text-xl font-bold tracking-tight">D.A.O<span className="text-clay">.</span></Link>
        <p className="shrink-0 px-3 pb-3 text-[11px] font-bold uppercase tracking-[0.16em] text-black/35">{workspaceLabel}</p>
        <nav aria-label={workspaceLabel} className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pb-3">{workspaceSwitch}{navigationLinks}</nav>
        {account}
      </div>
    </aside>
    {open && <div className="fixed inset-0 z-50 lg:hidden">
      <button type="button" tabIndex={-1} aria-label="Fermer la navigation" className="absolute inset-0 bg-ink/30" onClick={() => setOpen(false)} />
      <aside id="mobile-workspace-menu" ref={menuPanel} role="dialog" aria-modal="true" aria-label="Menu de navigation" className="relative flex h-dvh max-h-full w-[min(86vw,20rem)] min-w-0 flex-col bg-white shadow-2xl">
        <div className="shrink-0 border-b border-black/5 p-4">
          <div className="flex items-center justify-between gap-3"><Link href={homeHref} onClick={() => setOpen(false)} className="text-xl font-bold">D.A.O<span className="text-clay">.</span></Link><button ref={closeButton} type="button" aria-label="Fermer le menu" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl hover:bg-sand" onClick={() => setOpen(false)}><X size={21} /></button></div>
          <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.12em] text-black/45">{workspaceLabel}</p>
        </div>
        <nav aria-label={workspaceLabel} className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain p-3">{workspaceSwitch}{navigationLinks}</nav>
        <div className="shrink-0 px-3 pb-3">{account}</div>
      </aside>
    </div>}
  </>;
}
