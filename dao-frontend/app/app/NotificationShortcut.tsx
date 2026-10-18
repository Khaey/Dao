import Link from 'next/link';
import { Bell } from 'lucide-react';

/**
 * Secondary navigation, kept separate from the RoleNav owned by #222.
 * Out of the page flow so it never pushes content down: on mobile it sits in the fixed top bar
 * (left of "Mon compte"), from 1024 px it floats in the top-right corner of <main>.
 */
export default function NotificationShortcut() {
  return <nav aria-label="Notifications" className="fixed right-[68px] top-[10px] z-[41] lg:absolute lg:right-10 lg:top-1 lg:z-30">
    <Link href="/app/notifications" aria-label="Ouvrir mes notifications"
      className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-black/10 bg-white text-teal transition hover:bg-teal/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal">
      <Bell size={19} aria-hidden="true" />
    </Link>
  </nav>;
}
