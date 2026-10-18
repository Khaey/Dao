'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, LifeBuoy, MessageCircleQuestion, Search, X } from 'lucide-react';
import { contextOf, faqFor, searchFaq, type AssistantContext } from './faq';

const greetings: Record<AssistantContext, string> = {
  public: 'Questions fréquentes sur D.A.O., l’inscription et la connexion.',
  app: 'Aide pour vos chantiers, invitations, offres et avis.',
  contractor: 'Aide pour répondre aux DAO et suivre vos offres.',
  staff: 'Aide pour les revues, la modération et l’historique.',
};

/** Floating help assistant, present on every page. Static public FAQ only: no account data, no network call. */
export default function AssistantWidget() {
  const pathname = usePathname() ?? '/';
  const context = contextOf(pathname);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null); // element to refocus on close (null = the floating button)
  const titleId = useId();
  const panelId = useId();
  const entries = useMemo(() => searchFaq(faqFor(context), query), [context, query]);

  // Other parts of the app (e.g. the Assistance tab) can open the assistant.
  useEffect(() => {
    const openFromEvent = () => { opener.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null; setOpen(true); };
    window.addEventListener('dao:open-assistant', openFromEvent);
    return () => window.removeEventListener('dao:open-assistant', openFromEvent);
  }, []);

  // Close when the page changes, so the assistant never covers a page the user just opened.
  useEffect(() => { setOpen(false); }, [pathname]);

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    // Session presence only (local), to choose between "se connecter" and the in-app contact path.
    void import('../../lib/supabase-browser')
      .then(({ supabaseBrowser }) => supabaseBrowser().auth.getSession())
      .then(({ data }) => setSignedIn(Boolean(data.session)))
      .catch(() => setSignedIn(false));
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key !== 'Tab' || !panel.current) return;
      const focusable = [...panel.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input,summary,[tabindex]:not([tabindex="-1"])')]
        .filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  function close() {
    setOpen(false); setQuery('');
    const target = opener.current;
    requestAnimationFrame(() => (target?.isConnected ? target : trigger.current)?.focus());
  }

  const returnTo = encodeURIComponent(pathname);

  return <div className="print:hidden">
    {!open && <button ref={trigger} type="button" onClick={() => { opener.current = null; setOpen(true); }} aria-haspopup="dialog" aria-expanded={false} aria-controls={panelId}
      aria-label="Aide D.A.O." title="Aide D.A.O."
      className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-[45] inline-flex h-12 w-12 items-center justify-center rounded-full bg-ink text-white shadow-[0_10px_30px_rgba(23,32,42,0.25)] transition hover:bg-teal focus:outline-none focus-visible:ring-4 focus-visible:ring-teal/40 sm:right-6 sm:bottom-6 [body:has([data-dao-bottom-bar])_&]:bottom-28 sm:[body:has([data-dao-bottom-bar])_&]:bottom-28">
      <MessageCircleQuestion aria-hidden="true" size={22} />
    </button>}

    {open && <>
      <div aria-hidden="true" onClick={close} className="fixed inset-0 z-[54] bg-ink/30 sm:bg-transparent" />
      <div ref={panel} id={panelId} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="fixed inset-0 z-[55] flex flex-col bg-white sm:inset-auto sm:bottom-6 sm:right-6 sm:h-[min(640px,calc(100vh-3rem))] sm:w-[400px] sm:overflow-hidden sm:rounded-2xl sm:border sm:border-black/10 sm:shadow-[0_24px_60px_rgba(23,32,42,0.18)]">
        <div className="flex items-start justify-between gap-3 border-b border-black/5 px-5 pb-4 pt-[max(1rem,env(safe-area-inset-top))] sm:pt-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-bold tracking-tight text-ink">Aide D.A.O.</h2>
            <p className="mt-0.5 text-sm text-black/55">{greetings[context]}</p>
          </div>
          <button type="button" onClick={close} aria-label="Fermer l’aide"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-black/55 transition hover:bg-sand hover:text-ink focus:outline-none focus-visible:ring-4 focus-visible:ring-teal/25">
            <X aria-hidden="true" size={20} />
          </button>
        </div>

        <div className="border-b border-black/5 px-5 py-3">
          <label className="relative block">
            <span className="sr-only">Rechercher dans l’aide</span>
            <Search aria-hidden="true" size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-black/40" />
            <input ref={search} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher dans l’aide…"
              className="min-h-11 w-full rounded-xl border border-black/10 bg-white pl-10 pr-3 text-sm text-ink outline-none transition placeholder:text-black/35 focus:border-teal focus:ring-4 focus:ring-teal/10" />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="sr-only" aria-live="polite">{entries.length} réponse{entries.length > 1 ? 's' : ''}</p>
          {entries.length === 0
            ? <p className="rounded-xl bg-sand/70 px-4 py-3 text-sm text-black/60">Aucune réponse ne correspond. Essayez un autre mot, ou contactez l’équipe D.A.O. ci-dessous.</p>
            : <ul className="space-y-2">{entries.map((entry) => <li key={entry.id}>
              <details className="group rounded-xl border border-black/[0.07] bg-white open:border-teal/20 open:bg-teal/[0.03]">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
                  {entry.question}<ChevronDown aria-hidden="true" size={16} className="shrink-0 text-black/40 transition group-open:rotate-180" />
                </summary>
                <div className="px-4 pb-3.5 text-sm leading-relaxed text-black/65">
                  <p>{entry.answer}</p>
                  {entry.link && <Link href={entry.link.href} className="mt-2 inline-flex min-h-11 items-center font-semibold text-teal underline-offset-4 hover:underline">{entry.link.label}</Link>}
                </div>
              </details>
            </li>)}</ul>}
        </div>

        <div className="border-t border-black/5 bg-sand/50 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink"><LifeBuoy aria-hidden="true" size={16} className="text-teal" />Contacter D.A.O.</p>
          {signedIn === false && <p className="mt-1 text-sm text-black/60">Connectez-vous pour écrire à l’équipe D.A.O. et suivre sa réponse.{' '}
            <Link href={`/auth/login?returnTo=${returnTo}`} className="font-semibold text-teal underline-offset-4 hover:underline">Se connecter</Link></p>}
          {signedIn && <p className="mt-1 text-sm text-black/60">La demande d’assistance directement depuis l’application arrive prochainement. Pour une question sur un chantier, écrivez à ses participants depuis « Messages & Assistance ».{' '}
            <Link href="/app/messages?onglet=assistance" className="font-semibold text-teal underline-offset-4 hover:underline">Voir l’assistance</Link></p>}
        </div>
      </div>
    </>}
  </div>;
}
