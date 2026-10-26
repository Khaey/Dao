'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, Flag, MessageSquareQuote, Reply } from 'lucide-react';
import { Card } from '../ui';
import { Stars } from './ReviewStars';
import {
  containsContact, formatRating, formatReviewMonth, myReceivedReviews, reportReasons, reportReview, respondToReview,
  type ReceivedReview,
} from '../../lib/reviews';

const fieldClass = 'w-full rounded-xl border border-black/10 bg-white px-3.5 py-3 text-sm outline-none transition placeholder:text-black/35 focus:border-teal focus:ring-4 focus:ring-teal/10';
const secondary = 'inline-flex min-h-11 items-center gap-2 rounded-xl border border-black/10 bg-white px-4 text-sm font-semibold text-ink transition hover:border-teal hover:text-teal focus:outline-none focus:ring-4 focus:ring-teal/20';
const primary = 'inline-flex min-h-11 items-center justify-center rounded-xl bg-teal px-4 text-sm font-semibold text-white transition hover:bg-tealdark focus:outline-none focus:ring-4 focus:ring-teal/20 disabled:opacity-60';

function ResponseForm({ review, onDone, onCancel }: { review: ReceivedReview; onDone: () => Promise<void>; onCancel: () => void }) {
  const [body, setBody] = useState(review.response?.body ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const contact = containsContact(body);
  const id = `response-${review.id}`;
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    if (body.trim().length < 2) { setError('Écrivez votre réponse.'); return; }
    if (contact) { setError('Retirez téléphone, email, lien ou réseau social : les échanges passent par D.A.O.'); return; }
    setSaving(true);
    try { await respondToReview(review.id, body.trim()); await onDone(); } catch (exception) { setError((exception as Error).message); } finally { setSaving(false); }
  }
  return <form onSubmit={(event) => void submit(event)} className="space-y-2" noValidate>
    <label htmlFor={id} className="text-sm font-semibold text-ink">Votre réponse publique</label>
    <textarea id={id} rows={3} maxLength={1500} value={body} onChange={(event) => setBody(event.target.value)} className={fieldClass}
      placeholder="Remerciez le client ou apportez une précision factuelle." aria-invalid={contact || undefined} />
    <p className={`text-xs ${contact ? 'text-red-700' : 'text-black/50'}`}>{contact ? 'Pas de téléphone, email, lien ni réseau social.' : 'Une seule réponse, modifiable pendant 30 jours. Visible par tous les clients.'}</p>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="flex flex-wrap justify-end gap-2">
      <button type="button" onClick={onCancel} className={secondary}>Annuler</button>
      <button type="submit" disabled={saving} className={primary}>{saving ? 'Publication…' : 'Publier la réponse'}</button>
    </div>
  </form>;
}

function ReportForm({ review, onDone, onCancel }: { review: ReceivedReview; onDone: (message: string) => Promise<void>; onCancel: () => void }) {
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    if (!reason) { setError('Choisissez un motif.'); return; }
    setSaving(true);
    try {
      const result = await reportReview(review.id, reason, details.trim());
      await onDone(result.status === 'already_reviewed' ? 'D.A.O. a déjà examiné votre signalement pour cet avis.' : 'Signalement envoyé. D.A.O. l’examinera ; l’avis reste visible en attendant.');
    } catch (exception) { setError((exception as Error).message); } finally { setSaving(false); }
  }
  return <form onSubmit={(event) => void submit(event)} className="space-y-3 rounded-2xl bg-sand/70 p-4" noValidate>
    <label className="block space-y-1.5 text-sm font-semibold text-ink">
      <span>Motif du signalement</span>
      <select value={reason} onChange={(event) => setReason(event.target.value)} className={`${fieldClass} min-h-11 py-0 font-normal`}>
        <option value="">Choisir…</option>
        {Object.entries(reportReasons).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
    <label className="block space-y-1.5 text-sm font-semibold text-ink">
      <span>Précisions (facultatif)</span>
      <textarea rows={2} maxLength={1000} value={details} onChange={(event) => setDetails(event.target.value)} className={`${fieldClass} font-normal`} />
    </label>
    <p className="text-xs text-black/55">D.A.O. ne retire jamais un avis parce qu’il est négatif : seulement s’il enfreint les règles (insultes, données personnelles, hors sujet, faux chantier).</p>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="flex flex-wrap justify-end gap-2">
      <button type="button" onClick={onCancel} className={secondary}>Annuler</button>
      <button type="submit" disabled={saving} className={primary}>{saving ? 'Envoi…' : 'Envoyer le signalement'}</button>
    </div>
  </form>;
}

function ReceivedItem({ review, onChanged }: { review: ReceivedReview; onChanged: () => Promise<void> }) {
  const [mode, setMode] = useState<'idle' | 'respond' | 'report'>('idle');
  const [notice, setNotice] = useState('');
  const canEditResponse = !review.response_status || (review.response_status === 'published' && review.response_editable_until != null && new Date(review.response_editable_until) > new Date());
  return <li className="space-y-3 border-t border-black/5 pt-5 first:border-t-0 first:pt-0">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <p className="text-sm font-semibold text-ink">{review.author}</p>
        <p className="text-xs text-black/50">{[review.governorate, formatReviewMonth(review.month)].filter(Boolean).join(' · ')}{review.edited ? ' · modifié' : ''}</p>
      </div>
      <div className="flex items-center gap-2">
        <Stars value={review.rating} />
        {review.status === 'hidden' && <span className="rounded-full bg-clay/10 px-2.5 py-1 text-xs font-semibold text-clay">Masqué par D.A.O.</span>}
      </div>
    </div>
    <p className="whitespace-pre-wrap text-sm leading-relaxed text-black/75">{review.comment}</p>
    {review.response && mode !== 'respond' && <div className="rounded-2xl bg-sand/70 p-4">
      <p className="text-xs font-semibold text-ink">Votre réponse</p>
      <p className="mt-1 whitespace-pre-wrap text-sm text-black/70">{review.response.body}</p>
    </div>}
    {review.response_status === 'hidden' && <p className="text-xs text-clay">Votre réponse a été masquée par D.A.O.</p>}
    {review.report_status && <p className="text-xs text-black/55">Signalement : {review.report_status === 'open' ? 'en cours d’examen par D.A.O.' : review.report_status === 'actioned' ? 'pris en compte' : 'examiné, avis maintenu'}</p>}
    {notice && <p role="status" className="text-sm text-teal">{notice}</p>}
    {mode === 'respond' && <ResponseForm review={review} onCancel={() => setMode('idle')} onDone={async () => { setMode('idle'); setNotice('Réponse publiée.'); await onChanged(); }} />}
    {mode === 'report' && <ReportForm review={review} onCancel={() => setMode('idle')} onDone={async (message) => { setMode('idle'); setNotice(message); await onChanged(); }} />}
    {mode === 'idle' && review.status === 'published' && <div className="flex flex-wrap gap-2">
      {canEditResponse && <button type="button" onClick={() => { setMode('respond'); setNotice(''); }} className={secondary}>
        <Reply aria-hidden="true" size={16} />{review.response ? 'Modifier ma réponse' : 'Répondre'}
      </button>}
      {review.report_status !== 'open' && <button type="button" onClick={() => { setMode('report'); setNotice(''); }}
        className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-black/55 transition hover:text-red-700">
        <Flag aria-hidden="true" size={15} />Signaler
      </button>}
    </div>}
  </li>;
}

/** Professional: reviews received, public response and report to D.A.O. */
export default function ReceivedReviews() {
  const [items, setItems] = useState<ReceivedReview[] | null>(null);
  const [error, setError] = useState('');
  async function load() {
    try { setItems(await myReceivedReviews()); setError(''); } catch (exception) { setError((exception as Error).message); setItems([]); }
  }
  useEffect(() => { void load(); }, []);
  const published = (items ?? []).filter((item) => item.status === 'published');
  const average = published.length ? published.reduce((sum, item) => sum + item.rating, 0) / published.length : null;

  return <section className="mx-auto w-full max-w-4xl space-y-6">
    <Link href="/app/artisan/profile" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-black/60 hover:text-teal"><ArrowLeft aria-hidden="true" size={16} />Mon dossier professionnel</Link>
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal">Espace professionnel</p>
        <h1 className="text-3xl font-bold tracking-tight text-ink">Mes avis clients</h1>
        <p className="max-w-2xl text-sm text-black/55">Avis publiés par les clients de vos chantiers D.A.O. Répondez publiquement ou signalez un avis qui enfreint les règles.</p>
      </div>
      {average != null && <div className="flex items-center gap-2 rounded-2xl bg-white px-4 py-3 shadow-sm">
        <Stars value={average} size={18} /><span className="text-lg font-bold text-ink">{formatRating(average)}</span>
        <span className="text-sm text-black/55">{published.length} avis</span>
      </div>}
    </div>
    {error && <Card><p role="alert" className="text-sm text-red-700">{error}</p></Card>}
    {!items && <Card><p role="status" className="text-sm text-black/55">Chargement…</p></Card>}
    {items && items.length === 0 && !error && <Card className="flex flex-col items-center gap-3 px-5 py-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-teal/10 text-teal"><MessageSquareQuote aria-hidden="true" size={24} /></div>
      <h2 className="text-lg font-bold text-ink">Aucun avis pour le moment</h2>
      <p className="max-w-md text-sm text-black/55">Vos clients pourront vous noter dès que les travaux d’un chantier D.A.O. auront démarré.</p>
    </Card>}
    {items && items.length > 0 && <Card className="sm:p-7"><ul className="space-y-5">{items.map((item) => <ReceivedItem key={item.id} review={item} onChanged={load} />)}</ul></Card>}
  </section>;
}
