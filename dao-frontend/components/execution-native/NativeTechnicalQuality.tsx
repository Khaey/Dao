'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { NativeExecutionPlanDTO } from '../../../dao-backend/src/native-tracking/contract';
import { supabaseBrowser } from '../../lib/supabase-browser';

type Lot = NativeExecutionPlanDTO['lots'][number];
type Plan = NativeExecutionPlanDTO;
type LatestEvent = { id: string; kind: string; status: string; note: string | null; createdAt: string } | null;
type Inspection = {
  id: string; status: string; revision: number; requestNote: string | null; createdAt: string; latestEvent: LatestEvent;
  permissions: { canStart: boolean; canComplete: boolean; canWithdraw: boolean; canComment: boolean; canManagerComment: boolean };
};
type Reserve = {
  id: string; inspectionId: string | null; title: string; description: string; category: string; severity: string; location: string | null;
  bidSubLotId: string | null; nativeActivityId: string | null; dueDate: string | null; status: string; revision: number; createdAt: string; latestEvent: LatestEvent;
  permissions: { canDeclareCorrection: boolean; canRequestRecheck: boolean; canConfirmResolved: boolean; canReopen: boolean; canWithdraw: boolean; canComment: boolean; canManagerComment: boolean };
};
type Page<T> = { items: T[]; hasMore: boolean; nextCursor: string | null };
type HistoryEvent = { id: string; actorRole: string | null; kind: string; status: string; note: string | null; createdAt: string; evidence?: Array<{ documentId: string; name: string }> };
type Action = { target: 'inspection' | 'reserve'; id: string; revision: number; action: string; label: string; noteMin: number; confirm?: string };

const field = 'mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm text-ink';
const button = 'inline-flex min-h-10 items-center justify-center rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50';
const inspectionStatus: Record<string, string> = { requested: 'Demandé', in_progress: 'En cours', technical_check_complete: 'Contrôle technique terminé', withdrawn: 'Retiré' };
const reserveStatus: Record<string, string> = { open: 'Ouverte', correction_declared: 'Correction déclarée', recheck_requested: 'Nouveau contrôle demandé', resolved_confirmed: 'Levée confirmée', reopened: 'Rouverte', withdrawn: 'Retirée' };
const categories: Record<string, string> = { workmanship: 'Mise en œuvre', materials: 'Matériaux', completeness: 'Ouvrage incomplet', safety: 'Sécurité', other: 'Autre' };
const severities: Record<string, string> = { minor: 'Mineure', moderate: 'Modérée', major: 'Majeure' };
const roles: Record<string, string> = { client: 'Client', contractor: 'Artisan', manager: 'Gestionnaire' };
const pretty = (raw: string) => new Date(raw.length === 10 ? raw + 'T00:00:00Z' : raw).toLocaleDateString('fr-TN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const emptyReserve = { title: '', description: '', category: 'workmanship', severity: 'minor', location: '', target: '', dueDate: '', inspectionId: '' };

/** Contrôles techniques et réserves via les API JWT DEV 3 (#434) : ni réception juridique, ni acceptation, ni paiement. */
async function qualityApi<T>(path: string, method: 'GET' | 'POST' = 'GET', body?: Record<string, unknown>): Promise<T> {
  const { data } = await supabaseBrowser().auth.getSession();
  if (!data.session) throw new Error('Session expirée. Reconnectez-vous.');
  const response = await fetch('/api/projects/native-execution/' + path, {
    method, cache: 'no-store',
    headers: { Authorization: 'Bearer ' + data.session.access_token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify({ ...body, idempotency_key: crypto.randomUUID() }) } : {}),
  });
  const payload = await response.json().catch(() => ({})) as { data?: T; error?: string };
  if (response.status === 409) throw Object.assign(new Error('Cet élément vient d’évoluer : la liste a été rechargée, vérifiez puis recommencez.'), { status: 409 });
  if (response.status === 403) throw new Error('Cette action n’est pas autorisée pour votre rôle sur ce lot.');
  if (response.status === 400) throw new Error('Saisie incomplète ou invalide.');
  if (!response.ok || payload.data === undefined) throw new Error('Contrôle technique momentanément indisponible.');
  return payload.data;
}

export default function NativeTechnicalQuality({ plan, lot }: { plan: Plan; lot: Lot }) {
  const awardItemId = lot.award?.awardItemId ?? '';
  const role = plan.viewer.workspace;
  const canRequest = role === 'client' || (role === 'contractor' && lot.permissions.canDeclareProgress);
  const [inspections, setInspections] = useState<Page<Inspection> | null>(null);
  const [reserves, setReserves] = useState<Page<Reserve> | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [requestNote, setRequestNote] = useState<string | null>(null);
  const [reserveForm, setReserveForm] = useState<typeof emptyReserve | null>(null);
  const [pending, setPending] = useState<Action | null>(null);
  const [note, setNote] = useState('');
  const [history, setHistory] = useState<{ id: string; items: HistoryEvent[] | null } | null>(null);

  const load = useCallback(async () => {
    const query = `project_id=${encodeURIComponent(plan.projectId)}&award_item_id=${encodeURIComponent(awardItemId)}&limit=20`;
    const [nextInspections, nextReserves] = await Promise.all([
      qualityApi<Page<Inspection>>('inspections?' + query), qualityApi<Page<Reserve>>('reserves?' + query),
    ]);
    setInspections(nextInspections); setReserves(nextReserves); setPhase('ready');
  }, [plan.projectId, awardItemId]);

  useEffect(() => {
    if (!awardItemId) return;
    setPhase('loading');
    load().catch(cause => { setPhase('error'); setError(cause instanceof Error ? cause.message : 'Contrôle technique indisponible.'); });
  }, [awardItemId, load]);

  async function more(kind: 'inspections' | 'reserves') {
    const page = kind === 'inspections' ? inspections : reserves;
    if (!page?.nextCursor || busy) return;
    setBusy(true);
    try {
      const query = `project_id=${encodeURIComponent(plan.projectId)}&award_item_id=${encodeURIComponent(awardItemId)}&limit=20&before=${encodeURIComponent(page.nextCursor)}`;
      if (kind === 'inspections') { const next = await qualityApi<Page<Inspection>>('inspections?' + query); setInspections({ ...next, items: [...page.items as Inspection[], ...next.items] }); }
      else { const next = await qualityApi<Page<Reserve>>('reserves?' + query); setReserves({ ...next, items: [...page.items as Reserve[], ...next.items] }); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Chargement impossible.'); }
    finally { setBusy(false); }
  }

  async function command(path: string, body: Record<string, unknown>, message: string) {
    setBusy(true); setError(''); setNotice('');
    try {
      await qualityApi(path, 'POST', body);
      setNotice(message); setPending(null); setNote(''); setRequestNote(null); setReserveForm(null); setHistory(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Commande impossible.');
      if ((cause as { status?: number })?.status === 409) { setPending(null); await load().catch(() => undefined); }
    } finally { setBusy(false); }
  }

  async function toggleHistory(target: 'inspection' | 'reserve', id: string) {
    if (history?.id === id) { setHistory(null); return; }
    setHistory({ id, items: null });
    try {
      const page = await qualityApi<Page<HistoryEvent>>(`${target === 'inspection' ? 'inspections' : 'reserves'}/events?${target}_id=${encodeURIComponent(id)}&limit=30`);
      setHistory(current => current?.id === id ? { id, items: page.items } : current);
    } catch (cause) { setHistory(null); setError(cause instanceof Error ? cause.message : 'Historique indisponible.'); }
  }

  function submitAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pending || busy || note.trim().length < pending.noteMin) return;
    const path = pending.target === 'inspection' ? 'inspections/events' : 'reserves/events';
    void command(path, { [pending.target + '_id']: pending.id, action: pending.action, note: note.trim() || null, expected_revision: pending.revision }, 'Action enregistrée dans l’historique.');
  }

  function submitReserve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reserveForm || busy || !reserveForm.title.trim() || reserveForm.description.trim().length < 3) return;
    const [kind, id] = reserveForm.target ? reserveForm.target.split(':') : ['', ''];
    void command('reserves', {
      award_item_id: awardItemId, inspection_id: reserveForm.inspectionId || null, title: reserveForm.title.trim(), description: reserveForm.description.trim(),
      category: reserveForm.category, severity: reserveForm.severity, location: reserveForm.location.trim() || null,
      bid_sub_lot_id: kind === 'node' ? id : null, native_activity_id: kind === 'activity' ? id : null, due_date: reserveForm.dueDate || null,
    }, 'Réserve enregistrée. L’Artisan attributaire peut déclarer sa correction.');
  }

  if (!awardItemId) return null;
  const activities = (plan.activities?.items ?? []).filter(item => item.active && item.awardItemId === awardItemId);
  const activeInspections = (inspections?.items ?? []).filter(item => item.status === 'requested' || item.status === 'in_progress');
  const openReserves = (reserves?.items ?? []).filter(item => !['resolved_confirmed', 'withdrawn'].includes(item.status)).length;
  const subject = (reserve: Reserve) => reserve.bidSubLotId ? lot.executionSubLots.find(item => item.id === reserve.bidSubLotId)?.title
    : reserve.nativeActivityId ? activities.find(item => item.id === reserve.nativeActivityId)?.title : null;

  const actionButton = (action: Action) => <button key={action.action} type="button" className={button} disabled={busy}
    onClick={() => { setPending(action); setNote(''); }}>{action.label}</button>;
  const actionForm = (id: string) => pending?.id === id && <form onSubmit={submitAction} className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs">
    {pending.confirm && <p>{pending.confirm}</p>}
    <label className="block font-semibold">{pending.noteMin ? 'Note (obligatoire)' : 'Note — facultative'}
      <textarea className={field + ' min-h-16'} maxLength={2000} required={pending.noteMin > 0} value={note} disabled={busy} onChange={event => setNote(event.target.value)} /></label>
    <div className="flex flex-wrap gap-2"><button type="submit" className={button + ' bg-teal text-white'} disabled={busy || note.trim().length < pending.noteMin}>{busy ? 'Envoi…' : pending.label}</button>
      <button type="button" className={button} disabled={busy} onClick={() => setPending(null)}>Annuler</button></div>
  </form>;
  const historyBlock = (target: 'inspection' | 'reserve', id: string) => <>
    <button type="button" className="text-xs font-semibold text-teal underline-offset-2 hover:underline" aria-expanded={history?.id === id} onClick={() => void toggleHistory(target, id)}>
      {history?.id === id ? 'Masquer l’historique' : 'Voir l’historique'}</button>
    {history?.id === id && (history.items == null ? <p role="status" className="text-xs text-black/55">Chargement…</p>
      : <ol className="space-y-1 border-l-2 border-black/10 pl-3 text-xs text-black/70">{history.items.map(item => <li key={item.id}>
        <span className="font-semibold">{pretty(item.createdAt)}</span> · {roles[item.actorRole ?? ''] ?? 'Participant'} · {(target === 'inspection' ? inspectionStatus : reserveStatus)[item.status] ?? item.status}
        {item.note && <span className="block whitespace-pre-wrap break-words">{item.note}</span>}
        {item.evidence?.length ? <span className="block">Justificatifs : {item.evidence.map(file => file.name).join(', ')}</span> : null}
      </li>)}</ol>)}
  </>;

  return <div className="space-y-4 rounded-xl border border-black/10 bg-white p-4">
    <div><h3 className="text-sm font-bold text-ink">Contrôles techniques et réserves (facultatif)</h3>
      <p className="mt-1 text-xs text-black/60">Vérifications techniques entre le Client et l’Artisan attributaire. Lever une réserve n’est ni une réception juridique, ni une acceptation des travaux, ni un paiement.</p></div>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="rounded-xl border border-teal/20 bg-teal/[0.04] p-3 text-sm text-teal">{notice}</p>}
    {phase === 'loading' && <p role="status" className="text-sm text-black/60">Chargement…</p>}
    {phase === 'ready' && inspections && reserves && <>
      <p className="text-xs text-black/60">{openReserves} réserve{openReserves > 1 ? 's' : ''} non levée{openReserves > 1 ? 's' : ''} · {activeInspections.length} contrôle{activeInspections.length > 1 ? 's' : ''} en cours ou demandé{activeInspections.length > 1 ? 's' : ''}{reserves.hasMore ? ' (sur les éléments affichés)' : ''}</p>

      <section className="space-y-2" aria-label="Contrôles techniques">
        <h4 className="text-xs font-bold uppercase tracking-wide text-black/50">Contrôles techniques</h4>
        {inspections.items.length === 0 && <p className="text-sm text-black/55">Aucun contrôle technique demandé.</p>}
        <ul className="space-y-2">{inspections.items.map(item => <li key={item.id} className="space-y-2 rounded-xl border border-black/10 p-3 text-sm">
          <p className="flex flex-wrap justify-between gap-2"><span className="font-semibold">Contrôle du {pretty(item.createdAt)}</span><span className="text-ink/70">{inspectionStatus[item.status] ?? item.status}</span></p>
          {item.requestNote && <p className="whitespace-pre-wrap break-words text-xs text-black/60">{item.requestNote}</p>}
          <div className="flex flex-wrap gap-2">
            {item.permissions.canStart && actionButton({ target: 'inspection', id: item.id, revision: item.revision, action: 'start', label: 'Démarrer le contrôle', noteMin: 0 })}
            {item.permissions.canComplete && actionButton({ target: 'inspection', id: item.id, revision: item.revision, action: 'complete', label: 'Terminer le contrôle', noteMin: 0, confirm: 'Le contrôle technique sera marqué terminé. Les réserves ouvertes restent à lever séparément.' })}
            {item.permissions.canWithdraw && actionButton({ target: 'inspection', id: item.id, revision: item.revision, action: 'withdraw', label: 'Retirer la demande', noteMin: 0, confirm: 'Retirer cette demande de contrôle ?' })}
            {item.permissions.canComment && actionButton({ target: 'inspection', id: item.id, revision: item.revision, action: 'comment', label: 'Commenter', noteMin: 1 })}
            {item.permissions.canManagerComment && actionButton({ target: 'inspection', id: item.id, revision: item.revision, action: 'manager_comment', label: 'Commenter (Gestionnaire)', noteMin: 1 })}
          </div>
          {actionForm(item.id)}
          {historyBlock('inspection', item.id)}
        </li>)}</ul>
        {inspections.hasMore && <button type="button" className={button} disabled={busy} onClick={() => void more('inspections')}>Afficher plus</button>}
        {canRequest && requestNote === null && <button type="button" className={button} disabled={busy} onClick={() => setRequestNote('')}>Demander un contrôle technique</button>}
        {canRequest && requestNote !== null && <form className="space-y-2" onSubmit={event => { event.preventDefault(); if (!busy) void command('inspections', { award_item_id: awardItemId, note: requestNote.trim() || null }, 'Contrôle technique demandé.'); }}>
          <label className="block text-xs font-semibold">Note — facultative<textarea className={field + ' min-h-16'} maxLength={2000} value={requestNote} disabled={busy} onChange={event => setRequestNote(event.target.value)} /></label>
          <div className="flex flex-wrap gap-2"><button type="submit" className={button + ' bg-teal text-white'} disabled={busy}>{busy ? 'Envoi…' : 'Envoyer la demande'}</button>
            <button type="button" className={button} disabled={busy} onClick={() => setRequestNote(null)}>Annuler</button></div>
        </form>}
      </section>

      <section className="space-y-2" aria-label="Réserves">
        <h4 className="text-xs font-bold uppercase tracking-wide text-black/50">Réserves</h4>
        {reserves.items.length === 0 && <p className="text-sm text-black/55">Aucune réserve sur ce lot.</p>}
        <ul className="space-y-2">{reserves.items.map(item => <li key={item.id} className="space-y-2 rounded-xl border border-black/10 p-3 text-sm">
          <p className="flex flex-wrap justify-between gap-2"><span className="break-words font-semibold">{item.title}</span><span className="text-ink/70">{reserveStatus[item.status] ?? item.status}</span></p>
          <p className="text-xs text-black/60">{severities[item.severity] ?? item.severity} · {categories[item.category] ?? item.category}{subject(item) ? ` · ${subject(item)}` : ''}{item.location ? ` · ${item.location}` : ''}{item.dueDate ? ` · à traiter avant le ${pretty(item.dueDate)}` : ''}</p>
          <p className="whitespace-pre-wrap break-words text-xs text-black/70">{item.description}</p>
          {item.latestEvent?.note && item.latestEvent.kind !== 'created' && <p className="rounded-lg bg-sand/60 p-2 text-xs"><span className="font-semibold">Dernière note :</span> {item.latestEvent.note}</p>}
          <div className="flex flex-wrap gap-2">
            {item.permissions.canDeclareCorrection && actionButton({ target: 'reserve', id: item.id, revision: item.revision, action: 'declare_correction', label: 'Déclarer la correction', noteMin: 3 })}
            {item.permissions.canConfirmResolved && actionButton({ target: 'reserve', id: item.id, revision: item.revision, action: 'confirm_resolved', label: 'Confirmer la levée', noteMin: 0, confirm: 'Confirmer que la réserve est levée techniquement ? Ce n’est ni une réception, ni un paiement.' })}
            {item.permissions.canRequestRecheck && actionButton({ target: 'reserve', id: item.id, revision: item.revision, action: 'request_recheck', label: 'Demander une reprise', noteMin: 3 })}
            {item.permissions.canReopen && actionButton({ target: 'reserve', id: item.id, revision: item.revision, action: 'reopen', label: 'Rouvrir', noteMin: 3 })}
            {item.permissions.canWithdraw && actionButton({ target: 'reserve', id: item.id, revision: item.revision, action: 'withdraw', label: 'Retirer la réserve', noteMin: 0, confirm: 'Retirer cette réserve ?' })}
            {item.permissions.canComment && actionButton({ target: 'reserve', id: item.id, revision: item.revision, action: 'comment', label: 'Commenter', noteMin: 1 })}
            {item.permissions.canManagerComment && actionButton({ target: 'reserve', id: item.id, revision: item.revision, action: 'manager_comment', label: 'Commenter (Gestionnaire)', noteMin: 1 })}
          </div>
          {actionForm(item.id)}
          {historyBlock('reserve', item.id)}
        </li>)}</ul>
        {reserves.hasMore && <button type="button" className={button} disabled={busy} onClick={() => void more('reserves')}>Afficher plus</button>}
        {role === 'client' && !reserveForm && <button type="button" className={button} disabled={busy} onClick={() => setReserveForm({ ...emptyReserve, inspectionId: activeInspections[0]?.id ?? '' })}>Ajouter une réserve</button>}
        {role === 'client' && reserveForm && <form onSubmit={submitReserve} className="grid gap-2 sm:grid-cols-2">
          <label className="block text-xs font-semibold sm:col-span-2">Titre<input className={field} required maxLength={180} value={reserveForm.title} disabled={busy} onChange={event => setReserveForm({ ...reserveForm, title: event.target.value })} /></label>
          <label className="block text-xs font-semibold sm:col-span-2">Description<textarea className={field + ' min-h-20'} required minLength={3} maxLength={4000} value={reserveForm.description} disabled={busy} onChange={event => setReserveForm({ ...reserveForm, description: event.target.value })} /></label>
          <label className="block text-xs font-semibold">Nature<select className={field} value={reserveForm.category} disabled={busy} onChange={event => setReserveForm({ ...reserveForm, category: event.target.value })}>
            {Object.entries(categories).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
          <label className="block text-xs font-semibold">Gravité<select className={field} value={reserveForm.severity} disabled={busy} onChange={event => setReserveForm({ ...reserveForm, severity: event.target.value })}>
            {Object.entries(severities).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
          {(lot.executionSubLots.length > 0 || activities.length > 0) && <label className="block text-xs font-semibold">Élément concerné — facultatif<select className={field} value={reserveForm.target} disabled={busy} onChange={event => setReserveForm({ ...reserveForm, target: event.target.value })}>
            <option value="">Tout le lot</option>
            {lot.executionSubLots.map(item => <option key={item.id} value={'node:' + item.id}>Sous-lot · {item.title}</option>)}
            {activities.map(item => <option key={item.id} value={'activity:' + item.id}>Activité · {item.title}</option>)}</select></label>}
          <label className="block text-xs font-semibold">Emplacement — facultatif<input className={field} maxLength={500} value={reserveForm.location} disabled={busy} onChange={event => setReserveForm({ ...reserveForm, location: event.target.value })} /></label>
          <label className="block text-xs font-semibold">À traiter avant — facultatif<input className={field} type="date" value={reserveForm.dueDate} disabled={busy} onChange={event => setReserveForm({ ...reserveForm, dueDate: event.target.value })} /></label>
          {activeInspections.length > 0 && <label className="block text-xs font-semibold">Contrôle associé — facultatif<select className={field} value={reserveForm.inspectionId} disabled={busy} onChange={event => setReserveForm({ ...reserveForm, inspectionId: event.target.value })}>
            <option value="">Aucun</option>{activeInspections.map(item => <option key={item.id} value={item.id}>Contrôle du {pretty(item.createdAt)}</option>)}</select></label>}
          <div className="flex flex-wrap gap-2 sm:col-span-2"><button type="submit" className={button + ' bg-teal text-white'} disabled={busy || !reserveForm.title.trim() || reserveForm.description.trim().length < 3}>{busy ? 'Envoi…' : 'Enregistrer la réserve'}</button>
            <button type="button" className={button} disabled={busy} onClick={() => setReserveForm(null)}>Annuler</button></div>
        </form>}
      </section>
    </>}
  </div>;
}
