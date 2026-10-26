'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { MessageSquarePlus, Star } from 'lucide-react';
import { Card } from '../ui';
import ReviewForm from './ReviewForm';
import { Stars } from './ReviewStars';
import { myReviewOpportunities, withdrawReview, type ReviewOpportunity } from '../../lib/reviews';

const stageNames: Record<string, string> = { started: 'Travaux démarrés', in_progress: 'Travaux en cours', completed: 'Chantier terminé' };

function Opportunity({ item, showProject, onChanged }: { item: ReviewOpportunity; showProject: boolean; onChanged: () => Promise<void> }) {
  const review = item.review;
  const active = review && review.status !== 'withdrawn' ? review : null;
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function withdraw() {
    if (!review) return;
    setBusy(true); setError('');
    try { await withdrawReview(review.id); setConfirming(false); setNotice('Avis retiré. Il n’est plus visible.'); await onChanged(); }
    catch (exception) { setError((exception as Error).message); } finally { setBusy(false); }
  }

  return <li className="space-y-4 border-t border-black/5 pt-5 first:border-t-0 first:pt-0">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="font-semibold text-ink">{item.contractor_name}</p>
        <p className="text-xs text-black/50">{[showProject ? item.project_title : null, stageNames[item.project_stage]].filter(Boolean).join(' · ')}</p>
      </div>
      {active && <div className="flex items-center gap-2">
        <Stars value={active.rating} />
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${active.status === 'hidden' ? 'bg-clay/10 text-clay' : 'bg-teal/10 text-teal'}`}>
          {active.status === 'hidden' ? 'Masqué par D.A.O.' : 'Publié'}
        </span>
      </div>}
    </div>
    {active?.status === 'hidden' && active.hidden_reason && <p className="rounded-xl bg-clay/10 px-3.5 py-2.5 text-sm text-clay">Motif : {active.hidden_reason}</p>}
    {active && !editing && <p className="line-clamp-3 whitespace-pre-wrap text-sm text-black/65">{active.comment}</p>}
    {notice && <p role="status" className="text-sm text-teal">{notice}</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {editing ? <ReviewForm projectId={item.project_id} contractorId={item.contractor_id} contractorName={item.contractor_name} existing={review}
      onCancel={() => setEditing(false)}
      onSaved={async (status) => { setEditing(false); setNotice(status === 'hidden' ? 'Avis enregistré. Il reste masqué jusqu’à la décision de D.A.O.' : 'Merci ! Votre avis est publié.'); await onChanged(); }} />
      : <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => { setEditing(true); setNotice(''); setConfirming(false); }}
          className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition focus:outline-none focus:ring-4 focus:ring-teal/20 ${active ? 'border border-black/10 bg-white text-ink hover:border-teal hover:text-teal' : 'bg-teal text-white hover:bg-tealdark'}`}>
          {active ? 'Modifier mon avis' : <><Star aria-hidden="true" size={16} />Donner mon avis</>}
        </button>
        {active && !confirming && <button type="button" onClick={() => setConfirming(true)}
          className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-black/55 transition hover:text-red-700">Retirer</button>}
        {active && confirming && <span className="inline-flex flex-wrap items-center gap-2 rounded-xl bg-red-50 px-3 py-1.5 text-sm text-red-800">
          Retirer cet avis ?
          <button type="button" disabled={busy} onClick={() => void withdraw()} className="min-h-11 rounded-lg px-2 font-semibold underline-offset-4 hover:underline disabled:opacity-60">{busy ? 'Retrait…' : 'Oui, retirer'}</button>
          <button type="button" onClick={() => setConfirming(false)} className="min-h-11 rounded-lg px-2 font-semibold text-black/60">Annuler</button>
        </span>}
      </div>}
  </li>;
}

/** Client: chantiers × professionnels to review. With projectId, only that chantier (hidden when empty). */
export default function ReviewOpportunities({ projectId }: { projectId?: string }) {
  const [items, setItems] = useState<ReviewOpportunity[] | null>(null);
  const [error, setError] = useState('');

  async function load() {
    try { setItems(await myReviewOpportunities()); setError(''); }
    catch (exception) { setError((exception as Error).message); setItems([]); }
  }
  useEffect(() => { void load(); }, []);

  const visible = (items ?? []).filter((item) => !projectId || item.project_id === projectId);

  if (projectId) {
    // Inside a chantier: a discreet card, only when there is someone to review.
    if (!items || visible.length === 0) return null;
    const pending = visible.filter((item) => !item.review || item.review.status === 'withdrawn').length;
    return <Card className="space-y-4 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600"><MessageSquarePlus size={18} /></span>
        <div>
          <h2 className="text-base font-bold text-ink">Votre avis sur l’équipe</h2>
          <p className="mt-0.5 text-sm text-black/55">{pending ? `${pending} professionnel${pending > 1 ? 's' : ''} à noter. Votre avis aide les autres clients.` : 'Merci, vos avis sont publiés. Vous pouvez les modifier à tout moment.'}</p>
        </div>
      </div>
      <ul className="space-y-5">{visible.map((item) => <Opportunity key={`${item.project_id}-${item.contractor_id}`} item={item} showProject={false} onChanged={load} />)}</ul>
      <Link href="/app/reviews" className="inline-flex min-h-11 items-center text-sm font-semibold text-teal underline-offset-4 hover:underline">Tous mes avis</Link>
    </Card>;
  }

  return <section className="mx-auto w-full max-w-4xl space-y-6">
    <div className="space-y-2">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal">Avis clients</p>
      <h1 className="text-3xl font-bold tracking-tight text-ink">Mes avis</h1>
      <p className="max-w-2xl text-sm text-black/55">Notez les professionnels de vos chantiers démarrés. Seuls les clients D.A.O. ayant travaillé avec eux peuvent publier un avis.</p>
    </div>
    {error && <Card><p role="alert" className="text-sm text-red-700">{error}</p></Card>}
    {!items && <Card><p role="status" className="text-sm text-black/55">Chargement…</p></Card>}
    {items && visible.length === 0 && !error && <Card className="flex flex-col items-center gap-3 px-5 py-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600"><MessageSquarePlus aria-hidden="true" size={24} /></div>
      <h2 className="text-lg font-bold text-ink">Aucun avis à donner pour le moment</h2>
      <p className="max-w-md text-sm text-black/55">Vous pourrez noter un professionnel dès que les travaux de votre chantier auront démarré.</p>
      <Link href="/app/projects" className="mt-2 inline-flex min-h-11 items-center rounded-xl border border-black/10 bg-white px-4 text-sm font-semibold text-ink hover:border-teal hover:text-teal">Retour à mes chantiers</Link>
    </Card>}
    {visible.length > 0 && <Card className="sm:p-7"><ul className="space-y-5">
      {visible.map((item) => <Opportunity key={`${item.project_id}-${item.contractor_id}`} item={item} showProject onChanged={load} />)}
    </ul></Card>}
  </section>;
}
