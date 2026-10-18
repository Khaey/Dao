'use client';

import { useCallback, useEffect, useState } from 'react';
import { Clock3, LifeBuoy, MessageCircleQuestion, RefreshCw } from 'lucide-react';
import { Card } from '../ui';
import { openAssistant, supportAvailability, type SupportAvailability } from '../../lib/support-client';

/** « Assistance D.A.O. » tab. Never pretends a ticket exists: shows the real availability of the support API. */
export default function SupportPanel({ onShowProjects }: { onShowProjects: () => void }) {
  const [availability, setAvailability] = useState<SupportAvailability | null>(null);
  const load = useCallback(() => { setAvailability(null); void supportAvailability().then(setAvailability); }, []);
  useEffect(() => { load(); }, [load]);

  if (!availability) return <div aria-busy="true" className="space-y-3"><p role="status" className="sr-only">Chargement de l’assistance…</p><div className="h-40 animate-pulse rounded-2xl bg-black/5" /></div>;

  if (availability.state === 'error') return <Card className="space-y-3 border-red-100">
    <p role="alert" className="text-sm text-red-700">{availability.message}</p>
    <button type="button" onClick={load} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-black/10 bg-white px-4 text-sm font-semibold text-ink transition hover:border-teal hover:text-teal">
      <RefreshCw aria-hidden="true" size={16} />Réessayer
    </button>
  </Card>;

  const open = availability.state === 'available' ? availability.summary.open : 0;
  return <Card className="space-y-5 p-5 sm:p-7">
    <div className="flex items-start gap-4">
      <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-teal/10 text-teal"><LifeBuoy size={24} /></span>
      <div className="min-w-0 space-y-1.5">
        <h2 className="text-lg font-bold text-ink">Assistance D.A.O.</h2>
        {availability.state === 'unavailable'
          ? <p className="text-sm leading-relaxed text-black/60">Bientôt, vous pourrez écrire ici à l’équipe D.A.O., suivre l’état de vos demandes et recevoir ses réponses. Cette fonction n’est pas encore ouverte : aucune demande ne peut être envoyée pour le moment.</p>
          : <p className="text-sm leading-relaxed text-black/60">{open > 0 ? `${open} demande${open > 1 ? 's' : ''} en cours.` : 'Aucune demande en cours.'} Le suivi détaillé de vos demandes arrive dans la prochaine mise à jour.</p>}
      </div>
    </div>
    {availability.state === 'unavailable' && <p className="flex items-center gap-2 rounded-xl bg-sand/70 px-4 py-3 text-sm text-black/60"><Clock3 aria-hidden="true" size={16} className="shrink-0 text-clay" />En attendant, l’aide en ligne répond aux questions les plus fréquentes.</p>}
    <div className="flex flex-col gap-2 sm:flex-row">
      <button type="button" onClick={openAssistant} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-ink px-4 text-sm font-semibold text-white transition hover:bg-teal focus:outline-none focus-visible:ring-4 focus-visible:ring-teal/25">
        <MessageCircleQuestion aria-hidden="true" size={17} />Consulter l’aide
      </button>
      <button type="button" onClick={onShowProjects} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-black/10 bg-white px-4 text-sm font-semibold text-ink transition hover:border-teal hover:text-teal">
        Question sur un chantier ? Voir mes conversations
      </button>
    </div>
  </Card>;
}
