'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Activity, Menu, X, LayoutDashboard, FolderKanban, HardHat, Megaphone, LogOut, Mail, ReceiptText, MessageCircle, UserRound, FileText, Settings, Star, LifeBuoy, ClipboardCheck, Contact, History, UserCog, type LucideIcon } from 'lucide-react';
import { supabaseBrowser } from '../../lib/supabase-browser';
import { isDaoStaff, type AppRole } from '../../lib/roles';
import { onUnreadChanged } from '../../lib/unread-events';
import { expiredSessionLoginUrl, noteDeliberateSignOut, wasDeliberateSignOut } from '../../lib/session-return';

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
  const [supportUnread, setSupportUnread] = useState(0);

  useEffect(() => {
    const supabase = supabaseBrowser();
    let active = true;
    let authReloadTimer: ReturnType<typeof setTimeout> | null = null;
    const load = async (knownSession?: Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session']) => {
      const data = knownSession === undefined ? (await supabase.auth.getSession()).data : { session: knownSession };
      if (!active) return;
      if (!data.session && knownSession === undefined) {
        // A transient storage/refresh hiccup must not look like an expiry: confirm once before leaving.
        await new Promise(resolve => setTimeout(resolve, 600));
        if (!active) return;
        const retry = (await supabase.auth.getSession()).data;
        if (retry.session) { void load(retry.session); return; }
      }
      if (!data.session) { setRoles([]);setEmail('');setReady(false);router.replace(wasDeliberateSignOut() ? '/auth/login' : expiredSessionLoginUrl(window.location.pathname + window.location.search));return; }
      const userId=data.session.user.id;
      setReady(false);setRoles([]);setEmail(data.session.user.email ?? '');setSupportUnread(0);
      const [{ data: roleRows }, { data: profile }] = await Promise.all([
        supabase.from('user_roles').select('role').eq('user_id', userId),
        supabase.from('profiles').select('last_workspace').eq('user_id', userId).maybeSingle(),
      ]);
      if (!active) return;
      const current=(await supabase.auth.getSession()).data.session?.user.id;
      if(current!==userId)return;
      setRoles((roleRows ?? []).map((row: { role: AppRole }) => row.role));
      setWorkspace(profile?.last_workspace === 'contractor' ? 'contractor' : 'client');
      setReady(true);
    };
    void load();
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      // Supabase API calls made synchronously from this callback can deadlock
      // the auth client and swallow the next cross-tab identity event.
      if (authReloadTimer) clearTimeout(authReloadTimer);
      authReloadTimer = setTimeout(() => {
        authReloadTimer = null;
        void load(session);
      }, 0);
    });
    return () => {
      active = false;
      if (authReloadTimer) clearTimeout(authReloadTimer);
      subscription.subscription.unsubscribe();
    };
  }, [router]);

  useEffect(() => { setOpen(false); }, [pathname]);
  // Unread D.A.O. support replies (Client/Artisan). Silent when the support API is not deployed or fails.
  const supportUser = ready && !roles.some(role => role === 'dao_admin' || role === 'dao_reviewer') && (roles.includes('client') || roles.includes('contractor'));
  useEffect(() => {
    if (!supportUser) return;
    let active = true;
    const refresh = () => void import('../../lib/support-client').then(({ supportAvailability }) => supportAvailability())
      .then(result => { if (active) setSupportUnread(result.state === 'available' ? result.summary.unread : 0); }).catch(() => undefined);
    refresh();
    const stopUnread = onUnreadChanged(refresh);
    return () => { active = false; stopUnread(); };
  }, [supportUser, pathname]);


  useLayoutEffect(() => {
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
    closeOnDesktop();
    document.addEventListener('keydown', onKeyDown);
    return () => {
      desktop.removeEventListener('change', closeOnDesktop);
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      menuButton.current?.focus();
    };
  }, [open]);

  async function signOut() { noteDeliberateSignOut(); await supabaseBrowser().auth.signOut(); router.replace('/auth/login'); }
  async function switchWorkspace(next:'client'|'contractor') { setSwitching(true); const {error}=await supabaseBrowser().rpc('set_my_workspace',{p_workspace:next}); if(!error){setWorkspace(next);setOpen(false);router.push('/app');router.refresh()} setSwitching(false); }
  const has = (role: AppRole) => roles.includes(role);
  const staff = isDaoStaff(roles);
  const homeHref = staff ? '/app/dao' : '/app';
  const active = (href: string) => href==='/app/artisan'
    ? pathname===href||pathname.startsWith('/app/artisan/publications/')
    : pathname === href || (!['/app', '/app/dao'].includes(href) && pathname.startsWith(`${href}/`));
  // Staff links are grouped by intent: Admin governs the platform, Gestionnaire moves dossiers forward.
  const admin = has('dao_admin');
  const links: Array<{ href: string; label: string; icon: LucideIcon; show: boolean; group?: string }> = [
    { href: '/app', label: 'Tableau de bord', icon: LayoutDashboard, show: !staff && (has('client') || has('contractor')) },
    { href: '/app/dao', label: 'Tableau de bord', icon: LayoutDashboard, show: staff },
    { href: '/app/projects', label: 'Mes chantiers', icon: FolderKanban, show: has('client') || has('contractor') },
    { href: '/app/artisan', label: 'DAO disponibles', icon: HardHat, show: has('contractor') },
    { href: '/app/artisan/offers', label: 'Mes offres', icon: ReceiptText, show: has('contractor') },
    { href: '/app/artisan/profile', label: 'Mon dossier professionnel', icon: HardHat, show: has('contractor') },
    { href: '/app/professionals', label: 'Trouver un professionnel', icon: HardHat, show: has('client') },
    { href: '/app/invitations', label: 'Mes invitations', icon: Mail, show: !staff && (has('client') || has('contractor')) },
    { href: '/app/messages', label: 'Messages & Assistance', icon: MessageCircle, show: !staff && (has('client') || has('contractor')) },
    { href: '/app/dao/review', label: 'Revues', icon: ClipboardCheck, show: staff, group: 'Dossiers' },
    { href: '/app/dao/projects', label: 'Chantiers', icon: FolderKanban, show: staff, group: 'Dossiers' },
    { href: '/app/dao/tracking', label: 'Suivi terrain', icon: Activity, show: staff, group: 'Dossiers' },
    { href: '/app/dao/publications', label: 'Publications', icon: Megaphone, show: staff, group: 'Dossiers' },
    { href: '/app/contracts', label: 'Mes contrats', icon: FileText, show: has('client') || has('contractor') || admin, group: staff ? 'Dossiers' : undefined },
    { href: '/app/dao/professionals', label: 'Professionnels', icon: HardHat, show: staff, group: 'Relations' },
    { href: '/app/dao/clients', label: 'Clients', icon: Contact, show: staff, group: 'Relations' },
    { href: '/app/dao/reviews', label: 'Avis', icon: Star, show: staff, group: 'Relations' },
    { href: '/app/dao/support', label: 'Assistance', icon: LifeBuoy, show: staff, group: 'Relations' },
    { href: '/app/dao/users', label: 'Utilisateurs & rôles', icon: UserCog, show: admin, group: 'Gouvernance' },
    { href: '/app/dao/history', label: 'Historique', icon: History, show: staff, group: admin ? 'Gouvernance' : 'Traçabilité' },
  ];

  const workspaceLabel = staff ? (admin ? 'Espace Admin DAO' : 'Espace Gestionnaire DAO') : 'Espace de travail';
  const workspacePurpose = staff ? (admin ? 'Gouvernance de la plateforme' : 'Suivi opérationnel des dossiers') : '';
  const workspaceSwitch = has('client') && has('contractor') && <div className="mb-3 grid grid-cols-2 rounded-xl bg-sand p-1 text-xs font-semibold">
    <button disabled={switching} onClick={() => void switchWorkspace('client')} className={['min-h-11 rounded-lg px-2 py-2', workspace === 'client' ? 'bg-white text-teal shadow-sm' : 'text-black/50'].join(' ')}>Client</button>
    <button disabled={switching} onClick={() => void switchWorkspace('contractor')} className={['min-h-11 rounded-lg px-2 py-2', workspace === 'contractor' ? 'bg-white text-teal shadow-sm' : 'text-black/50'].join(' ')}>Artisan</button>
  </div>;
  const renderLink = (item: typeof links[number], dark = false) => {
    const Icon = item.icon;
    return <Link key={item.href} href={item.href} onClick={() => setOpen(false)} aria-current={active(item.href) ? 'page' : undefined}
      className={['flex min-h-11 items-center gap-3 rounded-control px-3 py-3 text-sm font-semibold transition lg:py-2.5', active(item.href) ? (dark ? 'bg-white/10 text-white' : 'bg-teal/10 text-teal') : (dark ? 'text-white/65 hover:bg-white/5 hover:text-white' : 'text-black/60 hover:bg-sand hover:text-ink')].join(' ')}>
      <Icon size={18} strokeWidth={1.8} className="shrink-0" /><span>{item.label}</span>
      {item.href === '/app/messages' && supportUnread > 0 && <span className="ml-auto rounded-full bg-clay px-2 py-0.5 text-xs font-bold text-white">
        {supportUnread}<span className="sr-only"> réponse{supportUnread > 1 ? 's' : ''} de D.A.O. non lue{supportUnread > 1 ? 's' : ''}</span></span>}
    </Link>;
  };
  const visibleLinks = links.filter(item => item.show);
  const groups = [...new Set(visibleLinks.map(item => item.group).filter((group): group is string => !!group))];
  const navigationLinks = (dark = false) => <>
    {visibleLinks.filter(item => !item.group).map(item => renderLink(item, dark))}
    {groups.map(group => <div key={group} role="group" aria-label={group} className="pt-3">
      <p aria-hidden="true" className={['px-3 pb-1 text-[11px] font-bold uppercase tracking-[0.14em]', dark ? 'text-white/40' : 'text-black/35'].join(' ')}>{group}</p>
      <div className="space-y-1">{visibleLinks.filter(item => item.group === group).map(item => renderLink(item, dark))}</div>
    </div>)}
  </>;
  // Personal account and platform settings (Admin) or delegations share one entry, with tabs on the page.
  const settingsActive = active('/app/settings') || pathname === '/app/dao/settings' || pathname === '/app/profile';
  const account = (dark = false) => <div className={['shrink-0 border-t pt-3', dark ? 'border-white/10' : 'border-black/5'].join(' ')}>
    <Link href="/app/settings" onClick={() => setOpen(false)} aria-current={settingsActive ? 'page' : undefined}
      className={['flex min-h-11 items-center gap-3 rounded-control px-3 py-3 text-sm font-semibold transition', settingsActive ? (dark ? 'bg-white/10 text-white' : 'bg-teal/10 text-teal') : (dark ? 'text-white/65 hover:bg-white/5 hover:text-white' : 'text-black/60 hover:bg-sand hover:text-ink')].join(' ')}>
      <Settings size={18} className="shrink-0" aria-hidden="true" />Paramètres
    </Link>
    <div className="flex min-w-0 items-center gap-3 p-3">
      <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-white">{email.slice(0, 1).toUpperCase() || 'D'}</span>
      <span className="min-w-0 flex-1"><span className="sr-only">Connecté en tant que </span><span className={['block truncate text-xs', dark ? 'text-white/55' : 'text-black/45'].join(' ')}>{email}</span></span>
    </div>
    <button type="button" onClick={() => void signOut()} className={['flex min-h-11 w-full items-center gap-3 rounded-control px-3 py-3 text-sm font-semibold', dark ? 'text-white/65 hover:bg-white/5 hover:text-white' : 'text-black/55 hover:bg-red-50 hover:text-red-700'].join(' ')}><LogOut size={18} className="shrink-0" />Déconnexion</button>
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
    <aside className={['hidden w-64 shrink-0 border-r lg:flex lg:flex-col', admin ? 'border-night bg-night text-white' : 'border-black/5 bg-white'].join(' ')}>
      <div className="sticky top-0 flex h-dvh min-h-0 flex-col p-4">
        <Link href={homeHref} className="shrink-0 px-3 py-3 text-xl font-bold tracking-tight">D.A.O<span className="text-clay">.</span></Link>
        <div className="shrink-0 px-3 pb-3">
          <p className={['inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em]', staff ? (admin ? 'bg-white/10 text-white' : 'bg-teal/10 text-teal') : 'px-0 text-black/35'].join(' ')}>{workspaceLabel}</p>
          {workspacePurpose && <p className={['mt-1.5 text-xs', admin ? 'text-white/55' : 'text-black/45'].join(' ')}>{workspacePurpose}</p>}
        </div>
        <nav aria-label={workspaceLabel} className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pb-3">{workspaceSwitch}{navigationLinks(admin)}</nav>
        {account(admin)}
      </div>
    </aside>
    {open && <div className="fixed inset-0 z-50 lg:hidden">
      <button type="button" tabIndex={-1} aria-label="Fermer la navigation" className="absolute inset-0 bg-ink/30" onClick={() => setOpen(false)} />
      <aside id="mobile-workspace-menu" ref={menuPanel} role="dialog" aria-modal="true" aria-label="Menu de navigation" className="relative flex h-dvh max-h-full w-[min(86vw,20rem)] min-w-0 flex-col bg-white shadow-2xl">
        <div className="shrink-0 border-b border-black/5 p-4">
          <div className="flex items-center justify-between gap-3"><Link href={homeHref} onClick={() => setOpen(false)} className="text-xl font-bold">D.A.O<span className="text-clay">.</span></Link><button ref={closeButton} type="button" aria-label="Fermer le menu" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl hover:bg-sand" onClick={() => setOpen(false)}><X size={21} /></button></div>
          <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.12em] text-black/45">{workspaceLabel}</p>
          {workspacePurpose && <p className="mt-0.5 text-xs text-black/45">{workspacePurpose}</p>}
        </div>
        <nav aria-label={workspaceLabel} className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain p-3">{workspaceSwitch}{navigationLinks()}</nav>
        <div className="shrink-0 px-3 pb-3">{account()}</div>
      </aside>
    </div>}
  </>;
}
