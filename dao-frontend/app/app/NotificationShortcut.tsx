'use client';

import Link from 'next/link';
import { Bell } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { supportAvailability } from '../../lib/support-client';
import { fetchUnreadNotificationCount } from '../../lib/notifications';
import { supabaseBrowser } from '../../lib/supabase-browser';

/** Total badge = JWT-scoped in-app events + authorized Support replies.
 * Never fetch message or question bodies for the global notification badge.
 */
export default function NotificationShortcut() {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const supabase = supabaseBrowser();
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setSessionId(data.session?.user.id ?? null);
    }).catch(() => { if (active) setSessionId(null); });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setSessionId(session?.user.id ?? null);
      setUnread(0);
    });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!sessionId) { setUnread(0); return; }
    let active = true;
    let generation = 0;
    const controller = new AbortController();
    const refresh = async () => {
      const current = ++generation;
      const [internal, support] = await Promise.allSettled([
        fetchUnreadNotificationCount(controller.signal),
        supportAvailability(),
      ]);
      if (!active || current !== generation) return;
      const internalCount = internal.status === 'fulfilled' ? internal.value : 0;
      const supportCount = support.status === 'fulfilled' && support.value.state === 'available'
        ? Math.max(0, support.value.summary.unread) : 0;
      setUnread(internalCount + supportCount);
    };
    void refresh();
    const onFocus = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    const timer = window.setInterval(onFocus, 30_000);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [pathname, sessionId]);

  return <nav aria-label="Notifications" className="fixed right-[68px] top-[10px] z-[41] lg:absolute lg:right-10 lg:top-1 lg:z-30">
    <Link href="/app/notifications" aria-label="Ouvrir mes notifications" title={unread > 0 ? `${unread} notification(s) non lue(s)` : 'Mes notifications'}
      className="relative inline-flex h-11 w-11 items-center justify-center rounded-xl border border-black/10 bg-white text-teal transition hover:bg-teal/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal">
      <Bell size={19} aria-hidden="true" />
      {unread > 0 && <span aria-hidden="true" data-testid="support-bell-count" className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-clay px-1 text-[11px] font-bold text-white">{unread > 99 ? '99+' : unread}</span>}
    </Link>
  </nav>;
}
