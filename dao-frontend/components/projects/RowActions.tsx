'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';

export type RowAction = { label: string; href: string };

/**
 * Optional compact « ⋯ »-only mode for clickable chantier rows, preserving all authorised links.
 * Only real, authorised destinations are passed in: nothing here invents an action.
 */
export default function RowActions({ title, primary, more, menuOnly = false }: { title: string; primary: RowAction | null; more: RowAction[]; menuOnly?: boolean }) {
  const menuActions = menuOnly
    ? [...(primary ? [{ ...primary, label: primary.label === 'Ouvrir' ? 'Ouvrir le chantier' : primary.label }] : []), ...more]
      .filter((action, index, list) => list.findIndex(other => other.href === action.href) === index)
    : more;
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); toggle.current?.focus(); } };
    // Fixed popover: escapes the scrollable table without being clipped. It follows its button when the page moves
    // (late data, layout shift, mobile scroll) and closes only once the button has left the viewport.
    const place = () => {
      const rect = toggle.current?.getBoundingClientRect();
      if (!rect || rect.bottom < 0 || rect.top > window.innerHeight) { setOpen(false); return; }
      setPosition({ top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) });
    };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', escape);
    window.addEventListener('scroll', place, true); window.addEventListener('resize', place);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape); window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open]);
  return <div ref={root} onClick={event => { if (menuOnly) event.stopPropagation(); }} className="relative z-10 flex items-center justify-end gap-1">
    {!menuOnly && (primary ? <Link href={primary.href} aria-label={`${primary.label} — ${title}`} className="inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-xl bg-teal px-3.5 text-sm font-semibold text-white transition hover:bg-tealdark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal">{primary.label}</Link>
      : <span className="px-2 text-xs text-ink/55">Aucune action disponible</span>)}
    {menuActions.length > 0 && <>
      <button ref={toggle} type="button" aria-label={`Autres actions — ${title}`} aria-expanded={open} aria-controls={menuId} onClick={() => { const rect = toggle.current?.getBoundingClientRect(); if (rect) setPosition({ top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) }); setOpen(value => !value); }} className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-ink/60 transition hover:bg-sand hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal"><MoreHorizontal aria-hidden="true" size={18} /></button>
      {open && position && <ul id={menuId} aria-label={`Autres actions — ${title}`} style={{ top: position.top, right: position.right }} className="fixed z-50 w-max min-w-[14rem] max-w-[calc(100vw-1rem)] rounded-xl border border-black/10 bg-white p-1 text-left shadow-lg">{menuActions.map(action => <li key={action.href + action.label}><Link href={action.href} onClick={() => setOpen(false)} className="flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-ink hover:bg-sand focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal">{action.label}</Link></li>)}</ul>}
    </>}
  </div>;
}
