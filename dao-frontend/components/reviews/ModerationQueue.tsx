'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { Card } from '../ui';
import { Stars } from './ReviewStars';
import { formatReviewMonth, moderateReview, moderationPage, reportReasons, type ModerationAction, type ModerationFilter, type ModerationItem } from '../../lib/reviews';

const statusNames: Record<ModerationItem['status'], string> = { published: 'Publié', hidden: 'Masqué', withdrawn: 'Retiré par l’auteur' };
const secondary = 'inline-flex min-h-11 items-center rounded-xl border border-black/10 bg-white px-4 text-sm font-semibold text-ink transition hover:border-teal hover:text-teal focus:outline-none focus:ring-4 focus:ring-teal/20 disabled:opacity-60';

function QueueItem({ item, onChanged }: { item: ModerationItem; onChanged: () => Promise<void> }) {
  const [pending, setPending] = useState<ModerationAction | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const openReports = item.reports.filter((report) => report.status === 'open');
  const recentAuthor = item.author_since != null && Date.now() - new Date(item.author_since).getTime() < 7 * 86400000;
  const needsReason = pending === 'hide' || pending === 'hide_response';

  async function run(action: ModerationAction) {
    setBusy(true); setError('');
    try { await moderateReview(item.id, action, needsReason ? reason.trim() : null); setPending(null); setReason(''); await onChanged(); }
    catch (exception) { setError((exception as Error).message); } finally { setBusy(false); }
  }

  return <li className="space-y-3 border-t border-black/5 pt-5 first:border-t-0 first:pt-0">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="font-semibold text-ink"><Link href={`/app/dao/professionals/${item.contractor_id}/dossier`} className="underline-offset-4 hover:text-teal hover:underline">{item.contractor_name}</Link></p>
        <p className="text-xs text-black/50">Par {item.author_name || item.author} · {[item.governorate, formatReviewMonth(item.month)].filter(Boolean).join(' · ')}{item.edited ? ' · modifié' : ''}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Stars value={item.rating} />
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${item.status === 'published' ? 'bg-teal/10 text-teal' : 'bg-clay/10 text-clay'}`}>{statusNames[item.status]}</span>
        {openReports.length > 0 && <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">{openReports.length} signalement{openReports.length > 1 ? 's' : ''}</span>}
      </div>
    </div>
    {item.edited_since_hidden && <p className="rounded-xl bg-amber-50 px-3.5 py-2 text-sm font-medium text-amber-800">Modifié par l’auteur depuis le masquage — relire avant de rétablir.</p>}
    {(item.project_origin === 'contractor_existing_client' || recentAuthor) && <p className="flex flex-wrap items-center gap-2 text-xs font-medium text-amber-800">
      <AlertTriangle aria-hidden="true" size={14} />
      {item.project_origin === 'contractor_existing_client' && <span className="rounded-full bg-amber-50 px-2 py-0.5">Chantier créé par le professionnel</span>}
      {recentAuthor && <span className="rounded-full bg-amber-50 px-2 py-0.5">Compte auteur de moins de 7 jours</span>}
    </p>}
    <p className="whitespace-pre-wrap text-sm leading-relaxed text-black/75">{item.comment}</p>
    {item.hidden_reason && <p className="text-sm text-clay">Motif de masquage : {item.hidden_reason}</p>}
    {item.response && <div className="rounded-2xl bg-sand/70 p-3 text-sm text-black/70"><span className="font-semibold text-ink">Réponse du professionnel : </span>{item.response.body}</div>}
    {item.response_status === 'hidden' && <p className="text-xs text-clay">Réponse du professionnel masquée.</p>}
    {item.reports.length > 0 && <ul className="space-y-1 text-xs text-black/60">
      {item.reports.map((report, index) => <li key={index}>• {reportReasons[report.reason] ?? report.reason}{report.details ? ` — « ${report.details} »` : ''} ({report.status === 'open' ? 'ouvert' : report.status === 'dismissed' ? 'écarté' : 'traité'})</li>)}
    </ul>}
    {pending && needsReason && <div className="space-y-2 rounded-2xl bg-sand/70 p-4">
      <label className="block text-sm font-semibold text-ink" htmlFor={`reason-${item.id}`}>Motif (visible par l’auteur) — jamais parce que l’avis est négatif</label>
      <textarea id={`reason-${item.id}`} rows={2} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)}
        className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-3 text-sm outline-none focus:border-teal focus:ring-4 focus:ring-teal/10" />
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={secondary} onClick={() => { setPending(null); setReason(''); }}>Annuler</button>
        <button type="button" disabled={busy || reason.trim().length < 5} onClick={() => void run(pending)}
          className="inline-flex min-h-11 items-center rounded-xl bg-red-700 px-4 text-sm font-semibold text-white transition hover:bg-red-800 disabled:opacity-50">
          {busy ? 'Enregistrement…' : pending === 'hide' ? 'Masquer l’avis' : 'Masquer la réponse'}
        </button>
      </div>
    </div>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {!pending && <div className="flex flex-wrap gap-2">
      {item.status === 'published' && <button type="button" className={secondary} onClick={() => setPending('hide')}>Masquer l’avis…</button>}
      {item.status === 'hidden' && <button type="button" disabled={busy} className={secondary} onClick={() => void run('restore')}>Rétablir l’avis</button>}
      {openReports.length > 0 && <button type="button" disabled={busy} className={secondary} onClick={() => void run('dismiss_reports')}>Écarter les signalements</button>}
      {item.response_status === 'published' && <button type="button" className={secondary} onClick={() => setPending('hide_response')}>Masquer la réponse…</button>}
      {item.response_status === 'hidden' && <button type="button" disabled={busy} className={secondary} onClick={() => void run('restore_response')}>Rétablir la réponse</button>}
    </div>}
  </li>;
}

const filters: Array<[ModerationFilter, string]> = [['reported', 'Signalés'], ['edited', 'Modifiés après masquage'], ['hidden', 'Masqués'], ['all', 'Tous']];
const PAGE = 30;

/** Staff: reviews to moderate (server-paginated), with fraud indicators. */
export default function ModerationQueue() {
  const [filter, setFilter] = useState<ModerationFilter>('reported');
  const [items, setItems] = useState<ModerationItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  async function load(next = filter) {
    try { const page = await moderationPage(next, PAGE, 0); setItems(page.items); setTotal(page.total); setError(''); }
    catch (exception) { setError((exception as Error).message); setItems([]); setTotal(0); }
  }
  async function loadMore() {
    if (!items) return;
    setLoadingMore(true);
    try { const page = await moderationPage(filter, PAGE, items.length); setItems([...items, ...page.items]); setTotal(page.total); }
    catch (exception) { setError((exception as Error).message); } finally { setLoadingMore(false); }
  }
  useEffect(() => { setItems(null); void load(filter); }, [filter]);

  return <section className="mx-auto w-full max-w-5xl space-y-6">
    <div className="space-y-2">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal">Gestion D.A.O.</p>
      <h1 className="text-3xl font-bold tracking-tight text-ink">Modération des avis</h1>
      <p className="max-w-2xl text-sm text-black/55">Un avis n’est masqué que s’il enfreint les règles, avec un motif visible par son auteur. Toutes les décisions sont journalisées.</p>
    </div>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filtre">
      {filters.map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}
        className={`min-h-11 rounded-xl px-4 text-sm font-semibold transition ${filter === value ? 'bg-ink text-white' : 'border border-black/10 bg-white text-ink hover:border-teal'}`}>{label}</button>)}
    </div>
    {error && <Card><p role="alert" className="text-sm text-red-700">{error}</p></Card>}
    {!items && <Card><p role="status" className="text-sm text-black/55">Chargement…</p></Card>}
    {items && items.length === 0 && !error && <Card className="flex items-center gap-3 text-sm text-black/60"><ShieldCheck aria-hidden="true" size={20} className="text-teal" />Aucun avis dans cette file.</Card>}
    {items && items.length > 0 && <Card className="space-y-5 sm:p-7">
      <p className="text-sm text-black/55" aria-live="polite">{items.length} sur {total}</p>
      <ul className="space-y-5">{items.map((item) => <QueueItem key={item.id} item={item} onChanged={() => load()} />)}</ul>
      {items.length < total && <button type="button" disabled={loadingMore} onClick={() => void loadMore()} className={`${secondary} w-full justify-center`}>{loadingMore ? 'Chargement…' : 'Charger plus'}</button>}
    </Card>}
  </section>;
}
