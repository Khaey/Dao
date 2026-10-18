import Link from 'next/link';
import { Bell } from 'lucide-react';

/** Secondary navigation stays separate from the RoleNav owned by #222. */
export default function NotificationShortcut() {
  return <nav aria-label="Notifications" className="mb-4 flex justify-end">
    <Link href="/app/notifications" aria-label="Ouvrir mes notifications"
      className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-black/10 bg-white px-3 text-sm font-semibold text-teal transition hover:bg-teal/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal">
      <Bell size={18} aria-hidden="true" />Notifications
    </Link>
  </nav>;
}
