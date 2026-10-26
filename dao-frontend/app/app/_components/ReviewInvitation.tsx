'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, Star } from 'lucide-react';
import { Card } from '../../../components/ui';
import { myReviewOpportunities, type ReviewOpportunity } from '../../../lib/reviews';

/** Opportunities without an active review: none yet, or one the Client withdrew. */
export function pendingReviewOpportunities(items: ReviewOpportunity[]) {
  return items.filter((item) => !item.review || item.review.status === 'withdrawn');
}

const SHOWN = 2;
const cta = 'inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-xl md:max-lg:w-auto xl:w-auto bg-teal px-5 text-sm font-semibold text-white transition hover:bg-tealdark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal';

/**
 * Client dashboard: a non-persistent invitation to review the professionals of started chantiers.
 * The server decides what is eligible (`my_review_opportunities`); this card only displays it.
 * Nothing is shown while loading, on error, or when nothing is pending: a failed call is never
 * presented as "0 reviews pending", and the dashboard stays usable.
 */
export default function ReviewInvitation() {
  const [pending, setPending] = useState<ReviewOpportunity[]>([]);

  useEffect(() => {
    let cancelled = false;
    myReviewOpportunities()
      .then((items) => { if (!cancelled) setPending(Array.isArray(items) ? pendingReviewOpportunities(items) : []); })
      .catch(() => { if (!cancelled) setPending([]); });
    return () => { cancelled = true; };
  }, []);

  if (pending.length === 0) return null;
  const count = pending.length;
  const shown = pending.slice(0, SHOWN);
  const hidden = count - shown.length;

  return <section aria-labelledby="review-invitation-title" data-testid="review-invitation">
    <Card className="border-teal/20 bg-[linear-gradient(120deg,rgba(15,118,110,0.07),rgba(247,245,239,0.7))] p-5 sm:p-6">
      {/* Row layout only where the column is wide: the dashboard puts a 320 px aside next to it from 1024 px. */}
      <div className="flex flex-col gap-5 md:max-lg:flex-row md:max-lg:items-center md:max-lg:justify-between xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 gap-4">
          <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-teal/10 text-teal"><Star size={21} /></span>
          <div className="min-w-0 space-y-2">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal">Votre prochain avis</p>
            <h2 id="review-invitation-title" className="text-xl font-bold text-ink">{count === 1 ? 'Un avis vous attend' : `${count} avis vous attendent`}</h2>
            <p className="max-w-xl text-sm text-black/65">
              {count === 1 ? 'Un chantier a démarré avec ce professionnel : partagez votre expérience.' : 'Des chantiers ont démarré avec ces professionnels : partagez votre expérience.'}
            </p>
            <ul data-testid="review-invitation-list" className="flex flex-wrap gap-2 pt-1">
              {shown.map((item) => <li key={`${item.project_id}-${item.contractor_id}`}
                className="max-w-full truncate rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-ink ring-1 ring-black/5">
                {item.contractor_name}{item.project_title ? ` · ${item.project_title}` : ''}
              </li>)}
              {hidden > 0 && <li className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-black/60 ring-1 ring-black/5">{`+ ${hidden} autre${hidden > 1 ? 's' : ''}`}</li>}
            </ul>
            <p className="text-xs text-black/60">Un avis ne certifie ni la fin des travaux ni un paiement.</p>
          </div>
        </div>
        <Link href="/app/reviews" className={cta}>Donner mon avis<ArrowRight aria-hidden="true" size={16} /></Link>
      </div>
    </Card>
  </section>;
}
