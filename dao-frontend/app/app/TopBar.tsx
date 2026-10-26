'use client';

import { CircleHelp } from 'lucide-react';
import NotificationShortcut from './NotificationShortcut';

/** Desktop top bar: help and notifications live here instead of floating over the page. On mobile the bell stays in the fixed header. */
export default function TopBar() {
  return <div className="contents lg:sticky lg:top-0 lg:z-30 lg:flex lg:h-14 lg:items-center lg:justify-end lg:gap-2 lg:border-b lg:border-black/5 lg:bg-sand/95 lg:px-10 lg:backdrop-blur print:hidden">
    <button type="button" onClick={() => window.dispatchEvent(new Event('dao:open-assistant'))}
      className="hidden min-h-11 items-center gap-2 rounded-control px-3 text-sm font-semibold text-black/60 transition hover:bg-white hover:text-teal focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal lg:inline-flex">
      <CircleHelp size={18} aria-hidden="true" />Aide
    </button>
    <NotificationShortcut />
  </div>;
}
