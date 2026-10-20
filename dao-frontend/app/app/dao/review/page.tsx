'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, ClipboardCheck, Inbox, Lock, RefreshCw } from 'lucide-react';
import { supabaseBrowser } from '../../../../lib/supabase-browser';
import { statusLabel } from '../../../../lib/utils';
import { isDaoStaff, type AppRole } from '../../../../lib/roles';
import { commandBackoffice } from '../../../../lib/backoffice';
import { Badge, Button, Card } from '../../../../components/ui';
import { AssignmentBadge, assignmentOf, formatDate, formatTnd, rememberList, reviewStatusLabel, type Assignment } from '../../../../components/backoffice/assignment';

type ReviewLot = { id: string; title: string; scope: string; budget_millimes: number | null; version_no: number; trade_name: string };
type ReviewRow = { id: string; project_id: string; title: string; description: string; status: string; version_no: number; created_at?: string; lots: ReviewLot[]; reviewer_name?: string; can_manage?: boolean; reviewer_id?: string };
type View = 'all' | 'todo' | 'mine' | 'others';
type Notice = { text: string; href?: string; cta?: string };

const views: Array<{ id: View; label: string }> = [
  { id: 'all', label: 'Toutes' }, { id: 'todo', label: 'À prendre en charge' }, { id: 'mine', label: 'Mes revues' }, { id: 'others', label: 'Autres gestionnaires' },
];
const matches: Record<View, (state: Assignment) => boolean> = { all: () => true, todo: (s) => s === 'unassigned', mine: (s) => s === 'mine', others: (s) => s === 'other' };
const emptyText: Record<View, string> = {
  all: 'Aucune revue en attente.', todo: 'Aucun dossier à prendre en charge.', mine: 'Aucune revue ne vous est attribuée.', others: 'Aucun dossier chez un autre gestionnaire.',
};
const fieldClass = 'w-full rounded-xl border border-black/10 bg-white px-3.5 py-3 text-sm outline-none transition focus:border-teal focus:ring-4 focus:ring-teal/10 disabled:bg-sand/60';
const secondary = 'bg-white text-ink ring-1 ring-black/10 hover:bg-sand';

export default function DaoReview() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [view, setView] = useState<View>('all');
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [admin, setAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const busyRef = useRef(false);
  const noticeRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoadError('');
    const supabase = supabaseBrowser();
    const { data: versions, error: versionsError } = await supabase.from('project_versions').select('id,project_id,title,description,status,version_no,created_at').in('status', ['client_review', 'dao_review']).is('superseded_by_id', null).order('created_at', { ascending: true });
    if (versionsError) { setLoadError('Impossible de charger les versions à examiner.'); setLoading(false); return; }
    const reviewVersions = versions ?? [];
    if (reviewVersions.length === 0) { setRows([]); setLoading(false); return; }

    const { data: links, error: linksError } = await supabase.from('project_version_requests').select('project_version_id,request_version_id').in('project_version_id', reviewVersions.map(row => row.id));
    const requestVersionIds = [...new Set((links ?? []).map(link => link.request_version_id))];
    const [{ data: snapshots, error: snapshotsError }, { data: trades, error: tradesError }] = requestVersionIds.length ? await Promise.all([
      supabase.from('project_request_versions').select('id,title,scope,budget_millimes,version_no,trade_id').in('id', requestVersionIds),
      supabase.from('trades').select('id,name_fr'),
    ]) : [{ data: [], error: null }, { data: [], error: null }];
    if (linksError || snapshotsError || tradesError) { setLoadError('Impossible de charger les lots liés aux versions à examiner.'); setLoading(false); return; }

    const snapshotById = new Map((snapshots ?? []).map(snapshot => [snapshot.id, snapshot]));
    const tradeById = new Map((trades ?? []).map(trade => [trade.id, trade.name_fr]));
    const lotsByVersion = new Map<string, ReviewLot[]>();
    for (const link of links ?? []) {
      const snapshot = snapshotById.get(link.request_version_id);
      if (!snapshot) continue;
      const lots = lotsByVersion.get(link.project_version_id) ?? [];
      lots.push({ ...snapshot, trade_name: tradeById.get(snapshot.trade_id) ?? 'Métier' });
      lotsByVersion.set(link.project_version_id, lots);
    }
    const { data: session } = await supabase.auth.getUser();
    const { data: roles } = await supabase.from('user_roles').select('role').eq('user_id', session.user?.id || '');
    const { data: assignments, error: assignmentError } = await supabase.from('review_assignments').select('project_id,reviewer_id').in('project_id', reviewVersions.map(r => r.project_id));
    const { data: profiles, error: profileError } = await supabase.from('profiles').select('user_id,display_name');
    if (assignmentError || profileError) { setLoadError('Affectations indisponibles.'); setLoading(false); return; }
    const isAdmin = !!roles?.some(r => r.role === 'dao_admin');
    setAdmin(isAdmin);
    setRows(reviewVersions.map(row => {
      const assignment = assignments?.find(a => a.project_id === row.project_id);
      return { ...row, lots: lotsByVersion.get(row.id) ?? [], reviewer_id: assignment?.reviewer_id, reviewer_name: profiles?.find(p => p.user_id === assignment?.reviewer_id)?.display_name, can_manage: isAdmin || assignment?.reviewer_id === session.user?.id };
    }));
    setLoading(false);
  }, []);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search);
    const initial = requested.get('mine') === 'true' ? 'mine' : requested.get('vue');
    if (initial && views.some(item => item.id === initial)) setView(initial as View);
    void (async () => {
      const supabase = supabaseBrowser();
      const { data: userResult } = await supabase.auth.getUser();
      if (!userResult.user) { setAllowed(false); setLoading(false); return; }
      setViewerId(userResult.user.id);
      const roleResult = await supabase.from('user_roles').select('role').eq('user_id', userResult.user.id);
      const roles = (roleResult.data ?? []).map(row => row.role as AppRole);
      if (!isDaoStaff(roles)) { setAllowed(false); setLoading(false); return; }
      setAllowed(true);
      await load();
    })();
  }, [load]);

  // Keep the filter in the URL so « retour » from a dossier lands on the same view.
  useEffect(() => {
    const href = view === 'all' ? '/app/dao/review' : `/app/dao/review?vue=${view}`;
    try { if (window.location.pathname + window.location.search !== href) window.history.replaceState(window.history.state, '', href); } catch { /* history unavailable */ }
    rememberList(href);
  }, [view]);

  function announce(next: Notice) { setNotice(next); requestAnimationFrame(() => noticeRef.current?.focus()); }
  const setRowError = (id: string, text: string) => setRowErrors(current => ({ ...current, [id]: text }));

  async function decide(row: ReviewRow, approve: boolean, confirmed = false) {
    if (busyRef.current) return;
    setNotice(null); setRowError(row.id, '');
    const comment = (comments[row.id] ?? '').trim();
    if (!approve && !comment) { setRowError(row.id, 'Indiquez la correction attendue avant de refuser le dossier.'); return; }
    if (!approve && !confirmed) { setConfirming(row.id); return; }
    busyRef.current = true; setBusy(row.id);
    try {
      const { data } = await supabaseBrowser().auth.getSession();
      if (!data.session) { setRowError(row.id, 'Session expirée. Reconnectez-vous.'); return; }
      const response = await fetch('/api/dao/review/decision', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify({ project_id: row.project_id, approve, comment: comment || 'Validé par DAO' }) }).catch(() => null);
      const body = response ? await response.json().catch(() => ({})) : {};
      if (!response?.ok) { setRowError(row.id, body.error || 'Décision non enregistrée : vérifiez votre connexion puis réessayez.'); return; }
      setConfirming(null);
      setComments(current => { const next = { ...current }; delete next[row.id]; return next; });
      announce(!approve ? { text: `Corrections demandées au client pour « ${row.title} ».` }
        : row.status === 'client_review' ? { text: `« ${row.title} » vous est attribué et passe en revue DAO.` }
        : { text: `« ${row.title} » est approuvé et prêt à publier.`, href: `/app/dao/publications/new?project_id=${row.project_id}`, cta: 'Préparer la publication' });
      await load();
    } finally { busyRef.current = false; setBusy(null); }
  }

  async function claim(row: ReviewRow) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(row.id); setNotice(null); setRowError(row.id, '');
    try {
      await commandBackoffice('claim', { project_id: row.project_id });
      announce({ text: `« ${row.title} » vous est attribué : vous pouvez maintenant décider.` });
      await load();
    } catch (exception) { setRowError(row.id, (exception as Error).message); }
    finally { busyRef.current = false; setBusy(null); }
  }

  const stateOf = (row: ReviewRow) => assignmentOf(row.reviewer_id, viewerId);
  const counts = Object.fromEntries(views.map(item => [item.id, rows.filter(row => matches[item.id](stateOf(row))).length])) as Record<View, number>;
  const visibleRows = rows.filter(row => matches[view](stateOf(row)));

  if (allowed === false) return <Card><h1 className="text-xl font-bold">Accès réservé</h1><p className="mt-2 text-sm text-black/60">La revue est réservée aux rôles D.A.O autorisés.</p></Card>;
  return <section className="mx-auto w-full max-w-4xl space-y-6">
    <nav aria-label="Fil d’Ariane" className="text-sm text-black/50"><Link href="/app/dao" className="font-semibold hover:text-teal">Tableau de bord</Link><span aria-hidden="true" className="mx-2">/</span><span aria-current="page">Revues</span></nav>
    <header className="space-y-2">
      <h1 className="text-3xl font-bold tracking-tight text-ink">Revues en attente</h1>
      <p className="max-w-2xl text-sm text-black/55">Versions exactes soumises par les clients, de la plus ancienne à la plus récente. Prenez un dossier en charge avant de décider ; un dossier suivi par un autre gestionnaire reste en lecture seule.</p>
    </header>

    {!loading && !loadError && <fieldset className="min-w-0">
      <legend className="sr-only">Filtrer la file</legend>
      <p className="sr-only" aria-live="polite">{counts.all} revue{counts.all > 1 ? 's' : ''} en attente : {counts.todo} à prendre en charge, {counts.mine} à vous, {counts.others} chez un autre gestionnaire.</p>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 py-1">
        {views.map(item => <label key={item.id} className="shrink-0 cursor-pointer">
          <input type="radio" name="review-view" value={item.id} checked={view === item.id} onChange={() => { setView(item.id); setConfirming(null); }} className="peer sr-only" />
          <span className="inline-flex min-h-11 items-center gap-2 rounded-full border border-black/10 bg-white px-4 text-sm font-semibold text-black/60 transition hover:border-black/25 peer-checked:border-ink peer-checked:bg-ink peer-checked:text-white peer-focus-visible:ring-4 peer-focus-visible:ring-teal/30">
            {item.label}<span aria-hidden="true" className="text-xs tabular-nums opacity-70">{counts[item.id]}</span>
          </span>
        </label>)}
      </div>
    </fieldset>}

    {notice && <div ref={noticeRef} tabIndex={-1} role="status" className="flex flex-wrap items-center gap-3 rounded-2xl bg-teal/[0.08] px-4 py-3 text-sm font-medium text-teal outline-none focus-visible:ring-4 focus-visible:ring-teal/20">
      <CheckCircle2 aria-hidden="true" size={18} className="shrink-0" /><span className="min-w-0 flex-1">{notice.text}</span>
      {notice.href && <Link href={notice.href} className="inline-flex min-h-11 items-center gap-1 rounded-xl bg-ink px-4 font-semibold text-white hover:bg-teal">{notice.cta}<ArrowRight aria-hidden="true" size={15} /></Link>}
    </div>}

    {loading ? <div aria-busy="true" className="space-y-3"><p role="status" className="sr-only">Chargement de la file des revues…</p>{[0, 1, 2].map(key => <div key={key} className="h-40 animate-pulse rounded-2xl bg-black/5" />)}</div>
      : loadError ? <Card className="space-y-3"><p role="alert" className="text-sm font-semibold text-red-700">{loadError}</p><Button type="button" className={`gap-2 ${secondary}`} onClick={() => { setLoading(true); void load(); }}><RefreshCw aria-hidden="true" size={16} />Réessayer</Button></Card>
      : visibleRows.length === 0 ? <Card className="flex items-start gap-3 border-dashed">
        <Inbox aria-hidden="true" size={20} className="mt-0.5 shrink-0 text-black/35" />
        <div className="space-y-1"><p className="text-sm font-semibold text-ink">{emptyText[view]}</p>
          {view !== 'all' && counts.all > 0 && <button type="button" onClick={() => setView('all')} className="min-h-11 text-sm font-semibold text-teal hover:underline">Voir toute la file ({counts.all})</button>}</div>
      </Card>
      : <div className="space-y-4">{visibleRows.map(row => <ReviewCard key={row.id} row={row} state={stateOf(row)} admin={admin} busy={busy === row.id} locked={!!busy && busy !== row.id}
          comment={comments[row.id] ?? ''} error={rowErrors[row.id]} confirming={confirming === row.id}
          onComment={value => { setComments(current => ({ ...current, [row.id]: value })); if (confirming === row.id && !value.trim()) setConfirming(null); }}
          onDecide={(approve, confirmed) => void decide(row, approve, confirmed)} onClaim={() => void claim(row)} onCancel={() => setConfirming(null)} />)}</div>}
  </section>;
}

function ReviewCard({ row, state, admin, busy, locked, comment, error, confirming, onComment, onDecide, onClaim, onCancel }: {
  row: ReviewRow; state: Assignment; admin: boolean; busy: boolean; locked: boolean; comment: string; error?: string; confirming: boolean;
  onComment: (value: string) => void; onDecide: (approve: boolean, confirmed?: boolean) => void; onClaim: () => void; onCancel: () => void;
}) {
  const readOnly = state === 'other' && !row.can_manage;
  const claimFirst = state === 'unassigned' && row.status === 'dao_review';
  const disabled = busy || locked;
  const commentId = `comment-${row.id}`, helpId = `comment-help-${row.id}`;
  const budget = row.lots.reduce((sum, lot) => sum + Number(lot.budget_millimes ?? 0), 0);
  return <Card className="space-y-5 p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="break-words text-lg font-bold leading-snug text-ink"><Link href={`/app/dao/projects/${row.project_id}`} className="hover:text-teal hover:underline">{row.title}</Link></h2>
        <p className="mt-1 text-xs text-black/50">Version du dossier {row.version_no} · {row.lots.length} lot{row.lots.length > 1 ? 's' : ''}{budget > 0 ? ` · ${formatTnd(budget)}` : ''}{row.created_at ? ` · soumise le ${formatDate(row.created_at)}` : ''}</p>
        <p className="mt-2 text-sm text-black/60">Pris en charge par : {row.reviewer_name || 'À prendre en charge'}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2"><Badge tone={row.status === 'dao_review' ? 'teal' : 'clay'}>{reviewStatusLabel[row.status] ?? statusLabel[row.status] ?? row.status}</Badge><AssignmentBadge state={state} name={row.reviewer_name} /></div>
    </div>
    {row.description && <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm text-black/60">{row.description}</p>}

    <section className="rounded-xl bg-sand/70 p-4" aria-label="Lots examinés">
      <h3 className="text-sm font-bold text-ink">Lots de cette version</h3>
      {row.lots.length === 0 ? <p className="mt-2 text-sm text-black/55">Aucun lot n’est lié à cette version du projet.</p>
        : <ol className="mt-2 divide-y divide-black/5">{row.lots.map(lot => <li key={lot.id} className="py-3 first:pt-1 last:pb-0">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><div className="min-w-0"><p className="text-xs font-semibold text-teal">{lot.trade_name}</p><h4 className="mt-0.5 break-words font-semibold text-ink">{lot.title}</h4></div><span className="text-sm font-medium tabular-nums text-black/70">{formatTnd(lot.budget_millimes)}</span></div>
          <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-black/60">{lot.scope}</p>
          <p className="mt-1 text-xs text-black/40">Version du lot {lot.version_no}</p>
        </li>)}</ol>}
    </section>

    {readOnly ? <div className="flex flex-wrap items-start gap-3 rounded-xl border border-black/10 px-4 py-3 text-sm text-black/60">
      <Lock aria-hidden="true" size={16} className="mt-0.5 shrink-0" />
      <p className="min-w-0 flex-1">Lecture seule : {row.reviewer_name ? `${row.reviewer_name} suit ce dossier` : 'un autre gestionnaire suit ce dossier'}. Seul ce gestionnaire ou un administrateur peut décider.</p>
      <Link href={`/app/dao/projects/${row.project_id}`} className="inline-flex min-h-11 shrink-0 items-center font-semibold text-teal hover:underline sm:min-h-0">Consulter le dossier</Link>
    </div>
    : claimFirst ? <div className="flex flex-col gap-3 rounded-xl border border-clay/20 bg-clay/[0.04] p-4 sm:flex-row sm:items-center">
      <p className="min-w-0 flex-1 text-sm text-black/65">Ce dossier n’est suivi par personne. Prenez-le en charge pour l’examiner, le modifier et décider.</p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <Button type="button" disabled={disabled} onClick={onClaim} className="gap-2"><ClipboardCheck aria-hidden="true" size={16} />{busy ? 'Prise en charge…' : 'Prendre en charge'}</Button>
    </div>
    : <div className="space-y-3 border-t border-black/5 pt-4">
      {state === 'other' && admin && <p className="text-xs font-medium text-black/50">Dossier suivi par {row.reviewer_name || 'un autre gestionnaire'} : vous intervenez en tant qu’administrateur.</p>}
      <div><label htmlFor={commentId} className="block text-sm font-semibold text-ink">Commentaire de revue</label>
        <textarea id={commentId} aria-describedby={helpId} rows={3} maxLength={2000} className={`mt-1.5 ${fieldClass}`} placeholder="Ex. : précisez le périmètre du lot plomberie." value={comment} disabled={busy} onChange={event => onComment(event.target.value)} />
        <p id={helpId} className="mt-1 text-xs text-black/50">Obligatoire pour refuser : ce motif est transmis au client.{row.status === 'client_review' ? ' « Passer en revue DAO » vous attribue ce dossier.' : ' « Approuver » rend cette version prête à publier.'}</p></div>
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {confirming ? <div className="space-y-3 rounded-xl border border-red-200 bg-red-50/60 p-4" role="group" aria-label="Confirmer la demande de corrections">
        <p className="text-sm text-ink">Le dossier sera renvoyé au client avec ce motif. La décision est enregistrée dans l’historique.</p>
        <blockquote className="whitespace-pre-wrap break-words border-l-2 border-red-300 pl-3 text-sm text-black/70">{comment.trim()}</blockquote>
        <div className="grid gap-2 sm:flex"><Button type="button" disabled={disabled} className="bg-red-700 hover:bg-red-800" onClick={() => onDecide(false, true)}>{busy ? 'Envoi…' : 'Confirmer la demande de corrections'}</Button><Button type="button" disabled={busy} className={secondary} onClick={onCancel}>Annuler</Button></div>
      </div>
      : <div className="grid gap-2 sm:flex"><Button type="button" disabled={disabled} onClick={() => onDecide(true)}>{busy ? 'Enregistrement…' : row.status === 'client_review' ? 'Passer en revue DAO' : 'Approuver'}</Button><Button type="button" disabled={disabled} className="bg-white text-red-700 ring-1 ring-red-200 hover:bg-red-50" onClick={() => onDecide(false)}>Refuser</Button></div>}
    </div>}
  </Card>;
}
