'use client';

import Link from 'next/link';
import { Bell } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { supportAvailability } from '../../lib/support-client';
import { supabaseBrowser } from '../../lib/supabase-browser';

/** Support unread badge for every signed-in DAO role.
 * The authenticated summary determines authorized tickets and role-specific
 * unread counts. Client/Artisan use the same count as Messages & Assistance.
 */
export default function NotificationShortcut() {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    let active = true;
    const supabase = supabaseBrowser();
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setHasSession(Boolean(data.session));
    }).catch(() => { if (active) setHasSession(false); });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setHasSession(Boolean(session));
      if (!session) setUnread(0);
    });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!hasSession) { setUnread(0); return; }
    let active = true;
    const refresh = async () => {
      const state = await supportAvailability();
      if (active) setUnread(state.state === 'available' ? Math.max(0, state.summary.unread) : 0);
    };
    void refresh();
    const onFocus = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    const timer = window.setInterval(onFocus, 120_000);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [pathname, hasSession]);

  return <nav aria-label="Notifications" className="fixed right-[68px] top-[10px] z-[41] lg:absolute lg:right-10 lg:top-1 lg:z-30">
    <Link href="/app/notifications" aria-label="Ouvrir mes notifications" title={unread > 0 ? `${unread} demande(s) d’assistance non lue(s)` : 'Mes notifications'}
      className="relative inline-flex h-11 w-11 items-center justify-center rounded-xl border border-black/10 bg-white text-teal transition hover:bg-teal/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal">
      <Bell size={19} aria-hidden="true" />
      {unread > 0 && <span aria-hidden="true" data-testid="support-bell-count" className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-clay px-1 text-[11px] font-bold text-white">{unread > 99 ? '99+' : unread}</span>}
    </Link>
  </nav>;
}
