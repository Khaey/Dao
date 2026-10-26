'use client';

import { useEffect, useState } from 'react';
import { BadgeCheck, Flag, MessageSquareQuote } from 'lucide-react';
import { Card } from '../ui';
import { Stars } from './ReviewStars';
import {
  criteriaKeys, criteriaLabels, formatRating, formatReviewMonth, professionalReviews, reportReasons, reportReview, reviewCount,
  type PublicReview, type RatingSummary,
} from '../../lib/reviews';

const PAGE = 10;

function Summary({ summary }: { summary: RatingSummary }) {
  const criteria = criteriaKeys.filter((key) => summary.criteria?.[key] != null);
  return <div className="grid gap-6 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
    <div className="text-center sm:pr-6 sm:text-left">
      <p className="text-5xl font-bold tracking-tight text-ink">{formatRating(summary.average)}</p>
      <Stars value={Number(summary.average ?? 0)} size={18} className="mt-1" />
      <p className="mt-1 text-sm text-black/55">{reviewCount(summary.count)}</p>
    </div>
    <div className="space-y-4">
      <ul aria-label="Répartition des notes" className="space-y-1.5">
        {(['5', '4', '3', '2', '1'] as const).map((stars) => {
          const count = summary.distribution?.[stars] ?? 0;
          const share = summary.count ? Math.round((count / summary.count) * 100) : 0;
          return <li key={stars} className="flex items-center gap-2.5 text-xs text-black/60">
            <span className="w-8 shrink-0 tabular-nums">{stars} ★</span>
            <span aria-hidden="true" className="h-2 flex-1 overflow-hidden rounded-full bg-sand"><span className="block h-full rounded-full bg-amber-500" style={{ width: `${share}%` }} /></span>
            <span className="w-16 shrink-0 text-right tabular-nums">{count} avis</span>
          </li>;
        })}
      </ul>
      {criteria.length > 0 && <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {criteria.map((key) => <div key={key} className="flex items-center justify-between gap-3 text-sm">
          <dt className="text-black/60">{criteriaLabels[key]}</dt>
          <dd className="font-semibold tabular-nums text-ink">{formatRating(summary.criteria[key])}</dd>
        </div>)}
      </dl>}
    </div>
  </div>;
}

function ReportControl({ reviewId }: { reviewId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [message, setMessage] = useState('');
  async function send() {
    if (!reason) { setMessage('Choisissez un motif.'); return; }
    setState('sending'); setMessage('');
    try {
      const result = await reportReview(reviewId, reason, '');
      setState('done'); setMessage(result.status === 'already_reviewed' ? 'D.A.O. a déjà examiné votre signalement.' : 'Merci, D.A.O. va examiner cet avis.');
    } catch (exception) { setState('idle'); setMessage((exception as Error).message); }
  }
  if (state === 'done') return <p role="status" className="text-xs text-teal">{message}</p>;
  if (!open) return <button type="button" onClick={() => setOpen(true)}
    className="inline-flex min-h-11 items-center gap-1.5 text-xs font-semibold text-black/45 transition hover:text-red-700"><Flag aria-hidden="true" size={13} />Signaler cet avis</button>;
  return <div className="flex flex-wrap items-center gap-2">
    <select aria-label="Motif du signalement" value={reason} onChange={(event) => setReason(event.target.value)}
      className="min-h-11 rounded-xl border border-black/10 bg-white px-3 text-sm text-ink outline-none focus:border-teal focus:ring-4 focus:ring-teal/10">
      <option value="">Motif…</option>
      {Object.entries(reportReasons).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
    <button type="button" disabled={state === 'sending'} onClick={() => void send()} className="min-h-11 rounded-xl bg-teal px-4 text-sm font-semibold text-white hover:bg-tealdark disabled:opacity-60">{state === 'sending' ? 'Envoi…' : 'Signaler'}</button>
    <button type="button" onClick={() => { setOpen(false); setMessage(''); }} className="min-h-11 px-2 text-sm font-semibold text-black/55">Annuler</button>
    {message && <p role="alert" className="w-full text-xs text-red-700">{message}</p>}
  </div>;
}

function ReviewItem({ review, professionalName, canReport }: { review: PublicReview; professionalName: string; canReport: boolean }) {
  return <li className="space-y-3 border-t border-black/5 pt-5 first:border-t-0 first:pt-0">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2.5">
        <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full bg-teal/10 text-sm font-bold text-teal">{review.author.slice(0, 1)}</span>
        <div>
          <p className="text-sm font-semibold text-ink">{review.author}</p>
          <p className="text-xs text-black/50">{[review.governorate, formatReviewMonth(review.month)].filter(Boolean).join(' · ')}{review.edited ? ' · modifié' : ''}</p>
        </div>
      </div>
      <Stars value={review.rating} />
    </div>
    <p className="whitespace-pre-wrap text-sm leading-relaxed text-black/75">{review.comment}</p>
    {review.response && <div className="rounded-2xl bg-sand/70 p-4">
      <p className="text-xs font-semibold text-ink">Réponse de {professionalName}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-black/70">{review.response.body}</p>
    </div>}
    {canReport && <ReportControl reviewId={review.id} />}
  </li>;
}

/** Reviews section of the professional profile (published reviews only, server-paginated). */
export default function ProfessionalReviews({ contractorId, professionalName, canReport = true }: { contractorId: string; professionalName: string; canReport?: boolean }) {
  const [summary, setSummary] = useState<RatingSummary | null>(null);
  const [items, setItems] = useState<PublicReview[] | null>(null);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setItems(null); setError('');
    void professionalReviews(contractorId, PAGE, 0)
      .then((page) => { if (!active) return; setSummary(page.summary); setItems(page.items); setMore(page.items.length === PAGE); })
      .catch((exception: Error) => { if (active) setError(exception.message); });
    return () => { active = false; };
  }, [contractorId]);

  async function loadMore() {
    if (!items) return;
    setLoading(true);
    try {
      const page = await professionalReviews(contractorId, PAGE, items.length);
      setItems([...items, ...page.items]); setMore(page.items.length === PAGE);
    } catch (exception) { setError((exception as Error).message); } finally { setLoading(false); }
  }

  return <section id="avis" aria-labelledby="reviews-title" className="scroll-mt-6 space-y-4">
    <div className="space-y-1">
      <h2 id="reviews-title" className="text-2xl font-bold tracking-tight text-ink">Avis clients</h2>
      <p className="flex items-start gap-1.5 text-sm text-black/55">
        <BadgeCheck aria-hidden="true" size={16} className="mt-0.5 shrink-0 text-teal" />
        Avis vérifiés : seuls les clients ayant un chantier démarré avec ce professionnel sur D.A.O. peuvent le noter.
      </p>
    </div>
    {error && <Card><p role="alert" className="text-sm text-red-700">{error}</p></Card>}
    {!items && !error && <Card><p role="status" className="text-sm text-black/55">Chargement des avis…</p></Card>}
    {items && items.length === 0 && <Card className="flex items-center gap-3 text-sm text-black/60">
      <MessageSquareQuote aria-hidden="true" size={20} className="shrink-0 text-black/35" />Aucun avis pour le moment.
    </Card>}
    {items && items.length > 0 && <Card className="space-y-6 sm:p-7">
      {summary && summary.count > 0 && <Summary summary={summary} />}
      <ul className="space-y-5 border-t border-black/5 pt-6">
        {items.map((review) => <ReviewItem key={review.id} review={review} professionalName={professionalName} canReport={canReport} />)}
      </ul>
      {more && <button type="button" onClick={() => void loadMore()} disabled={loading}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-black/10 bg-white px-4 text-sm font-semibold text-ink transition hover:border-teal hover:text-teal disabled:opacity-60">
        {loading ? 'Chargement…' : 'Voir plus d’avis'}
      </button>}
    </Card>}
  </section>;
}
