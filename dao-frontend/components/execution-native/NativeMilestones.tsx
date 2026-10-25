'use client';

import { useState, type FormEvent } from 'react';
import type { NativeExecutionPlanDTO } from '../../../dao-backend/src/native-tracking/contract';
import { supabaseBrowser } from '../../lib/supabase-browser';

type Lot = NativeExecutionPlanDTO['lots'][number];
type Milestone = Lot['milestones'][number];

const field = 'mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm text-ink';
const button = 'inline-flex min-h-10 items-center justify-center rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50';
const statusLabels: Record<string, string> = { planned: 'Planifié', in_progress: 'En cours', completed: 'Terminé', cancelled: 'Annulé' };
const pretty = (raw: string) => new Date(raw.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('fr-TN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const empty = { title: '', targetDate: '', status: 'planned', note: '' };

/** Jalons techniques du carnet (API existante /api/projects/execution) : historisés, jamais une réception ni un paiement. */
async function siteMilestone(method: 'POST' | 'PATCH', body: Record<string, unknown>) {
  const { data } = await supabaseBrowser().auth.getSession();
  if (!data.session) throw new Error('Session expirée. Reconnectez-vous.');
  const response = await fetch('/api/projects/execution', {
    method, cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token },
    body: JSON.stringify({ ...body, idempotency_key: crypto.randomUUID() }),
  });
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(payload.error || 'Jalon non enregistré.');
}

export default function NativeMilestones({ lot, onUpdated }: { lot: Lot; onUpdated: () => void }) {
  const canWrite = Boolean(lot.award && lot.permissions.canDeclareProgress);
  const [form, setForm] = useState<typeof empty | null>(null);
  const [editing, setEditing] = useState<{ key: string; targetDate: string; status: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  if (!lot.award || (!canWrite && lot.milestones.length === 0)) return null;
  const milestones = [...lot.milestones].sort((a, b) => (a.targetDate ?? '9999').localeCompare(b.targetDate ?? '9999') || a.title.localeCompare(b.title));

  async function run(method: 'POST' | 'PATCH', body: Record<string, unknown>, message: string) {
    setBusy(true); setError(''); setNotice('');
    try {
      await siteMilestone(method, body);
      setForm(null); setEditing(null); setNotice(message);
      onUpdated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Jalon non enregistré.'); }
    finally { setBusy(false); }
  }
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !form?.title.trim()) return;
    void run('POST', { kind: 'milestone', award_item_id: lot.award!.awardItemId, title: form.title.trim(), target_date: form.targetDate || null, status: form.status, note: form.note.trim() || null }, 'Jalon ajouté au carnet de chantier.');
  }
  function update(event: FormEvent<HTMLFormElement>, milestone: Milestone) {
    event.preventDefault();
    if (busy || !editing) return;
    void run('PATCH', { milestone_key: milestone.key, target_date: editing.targetDate || null, status: editing.status, note: editing.note.trim() || null }, 'Nouvel état du jalon ajouté à l’historique.');
  }

  return <div className="space-y-3 rounded-xl border border-black/10 bg-white p-4">
    <div><h3 className="text-sm font-bold text-ink">Jalons (facultatif)</h3>
      <p className="mt-1 text-xs text-black/60">Repères techniques déclarés par l’Artisan attributaire. Un jalon terminé n’est ni une réception, ni une acceptation, ni un paiement.</p></div>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="rounded-xl border border-teal/20 bg-teal/[0.04] p-3 text-sm text-teal">{notice}</p>}
    {milestones.length === 0 ? <p className="text-sm text-black/55">Aucun jalon déclaré pour ce lot.</p>
      : <ul className="space-y-2">{milestones.map(milestone => {
        const open = !['completed', 'cancelled'].includes(milestone.status);
        return <li key={milestone.key} className="space-y-2 rounded-xl border border-black/10 p-3 text-sm">
          <p className="flex flex-wrap justify-between gap-2"><span className="break-words font-semibold">{milestone.title}</span>
            <span className="text-ink/70">{statusLabels[milestone.status] ?? milestone.status}</span></p>
          <p className="text-xs text-black/60">{milestone.targetDate ? `Date cible : ${pretty(milestone.targetDate)}` : 'Sans date cible'} · mis à jour le {pretty(milestone.at)}</p>
          {canWrite && open && editing?.key !== milestone.key && <button type="button" className={button} disabled={busy}
            onClick={() => setEditing({ key: milestone.key, targetDate: milestone.targetDate?.slice(0, 10) ?? '', status: milestone.status, note: '' })}>Mettre à jour</button>}
          {editing?.key === milestone.key && <form onSubmit={event => update(event, milestone)} className="grid gap-2 sm:grid-cols-2">
            <label className="block text-xs font-semibold">État<select className={field} value={editing.status} disabled={busy} onChange={event => setEditing({ ...editing, status: event.target.value })}>
              {Object.entries(statusLabels).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
            <label className="block text-xs font-semibold">Date cible<input className={field} type="date" value={editing.targetDate} disabled={busy} onChange={event => setEditing({ ...editing, targetDate: event.target.value })} /></label>
            <label className="block text-xs font-semibold sm:col-span-2">Note — facultative<textarea className={field + ' min-h-16'} maxLength={1000} value={editing.note} disabled={busy} onChange={event => setEditing({ ...editing, note: event.target.value })} /></label>
            <div className="flex flex-wrap gap-2 sm:col-span-2"><button type="submit" className={button + ' bg-teal text-white'} disabled={busy}>{busy ? 'Envoi…' : 'Enregistrer'}</button>
              <button type="button" className={button} disabled={busy} onClick={() => setEditing(null)}>Annuler</button></div>
          </form>}
        </li>;
      })}</ul>}
    {canWrite && !form && <button type="button" className={button} disabled={busy} onClick={() => setForm({ ...empty })}>Ajouter un jalon</button>}
    {canWrite && form && <form onSubmit={create} className="grid gap-2 sm:grid-cols-2">
      <label className="block text-xs font-semibold sm:col-span-2">Titre<input className={field} required maxLength={160} value={form.title} disabled={busy} onChange={event => setForm({ ...form, title: event.target.value })} /></label>
      <label className="block text-xs font-semibold">Date cible — facultative<input className={field} type="date" value={form.targetDate} disabled={busy} onChange={event => setForm({ ...form, targetDate: event.target.value })} /></label>
      <label className="block text-xs font-semibold">État<select className={field} value={form.status} disabled={busy} onChange={event => setForm({ ...form, status: event.target.value })}>
        {Object.entries(statusLabels).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
      <label className="block text-xs font-semibold sm:col-span-2">Note — facultative<textarea className={field + ' min-h-16'} maxLength={1000} value={form.note} disabled={busy} onChange={event => setForm({ ...form, note: event.target.value })} /></label>
      <div className="flex flex-wrap gap-2 sm:col-span-2"><button type="submit" className={button + ' bg-teal text-white'} disabled={busy || !form.title.trim()}>{busy ? 'Envoi…' : 'Ajouter le jalon'}</button>
        <button type="button" className={button} disabled={busy} onClick={() => setForm(null)}>Annuler</button></div>
    </form>}
  </div>;
}
