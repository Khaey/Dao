'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { CalendarRange, RefreshCw } from 'lucide-react';
import { supabaseBrowser } from '../lib/supabase-browser';
import { Badge, Card, Input, SectionHeading } from './ui';
import { primaryAction, secondaryAction } from '../app/app/projects/_components/ProjectUi';

type SyncState = 'not_requested' | 'pending' | 'synced' | 'failed';
type Plan = { status: 'none' | 'draft' | 'ready'; revision?: number; planned_start?: string | null; planned_end?: string | null; sync: { state: SyncState; last_success_at?: string | null } };
type Summary = { total_activities: number; critical_count: number; progress_pct: number; total_duration_days: number; next_milestone: { name: string; date: string } | null };

const labels: Record<SyncState, { text: string; tone: 'neutral' | 'teal' | 'clay' | 'red' }> = {
  not_requested: { text: 'Planning non calculé', tone: 'neutral' },
  pending: { text: 'Calcul en cours', tone: 'clay' },
  synced: { text: 'Planning calculé', tone: 'teal' },
  failed: { text: 'Calcul indisponible', tone: 'red' },
};

async function api(path: string, method = 'GET', body?: Record<string, unknown>) {
  const { data } = await supabaseBrowser().auth.getSession();
  if (!data.session) throw new Error('Session expirée. Reconnectez-vous.');
  const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, data: payload.data, error: payload.error as string | undefined };
}

/** One lot: explicit start/end dates entered by the Client (or D.A.O management). Saving as "prêt" lets D.A.O drive OCE automatically. */
function LotPlan({ projectId, lot, canEdit }: { projectId: string; lot: { id: string; title?: string }; canEdit: boolean }) {
  const [plan, setPlan] = useState<Plan | null>(null); const [summary, setSummary] = useState<Summary | null>(null);
  const [hidden, setHidden] = useState(false); const [start, setStart] = useState(''); const [end, setEnd] = useState('');
  const [saving, setSaving] = useState(false); const [message, setMessage] = useState('');
  const query = `project_id=${projectId}&lot_id=${lot.id}`;

  const load = useCallback(async () => {
    const result = await api(`/api/oce/lot-plan?${query}`);
    if (result.status === 403 || result.status === 401) { setHidden(true); return null; }
    if (result.status !== 200) return null;
    const next = result.data as Plan; setPlan(next);
    if (next.planned_start) setStart(previous => previous || next.planned_start!); if (next.planned_end) setEnd(previous => previous || next.planned_end!);
    if (next.sync.state === 'synced') { const s = await api(`/api/oce/planning-summary?${query}`); setSummary(s.status === 200 ? s.data : null); } else setSummary(null);
    return next;
  }, [query]);

  useEffect(() => { void load(); }, [load]);
  // While D.A.O is computing, refresh quietly; stop as soon as the state is final.
  useEffect(() => {
    if (plan?.sync.state !== 'pending') return;
    const timer = setInterval(() => { void load(); }, 4000); return () => clearInterval(timer);
  }, [plan?.sync.state, load]);

  if (hidden) return null;
  const state = plan?.sync.state ?? 'not_requested';

  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true); setMessage('');
    const result = await api('/api/oce/lot-plan', 'PUT', { project_id: projectId, lot_id: lot.id, planned_start: start, planned_end: end, ready: true });
    setSaving(false);
    if (result.status !== 200) { setMessage(result.status === 422 ? 'Dates invalides : la fin doit suivre le début.' : result.error || 'Enregistrement impossible.'); return; }
    setMessage('Dates enregistrées. Le planning est calculé automatiquement.'); await load();
  }
  async function relaunch() {
    setSaving(true); setMessage('');
    const result = await api('/api/oce/lot-plan', 'POST', { project_id: projectId, lot_id: lot.id });
    setSaving(false); setMessage(result.status === 202 ? 'Nouveau calcul demandé.' : result.status === 403 ? 'Relance réservée à la gestion D.A.O.' : 'Relance impossible.'); await load();
  }

  return <div className="rounded-xl border border-black/[0.08] p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-ink">{lot.title || 'Lot'}</h3><Badge tone={labels[state].tone}>{labels[state].text}</Badge></div>
    {canEdit && <form onSubmit={save} className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <label className="text-xs font-medium text-ink/65">Début des travaux<Input type="date" required value={start} onChange={event => setStart(event.target.value)} /></label>
      <label className="text-xs font-medium text-ink/65">Fin prévue<Input type="date" required min={start || undefined} value={end} onChange={event => setEnd(event.target.value)} /></label>
      <button type="submit" disabled={saving || !start || !end} className={primaryAction}>Enregistrer et calculer</button>
    </form>}
    {!canEdit && plan?.planned_start && <p className="mt-2 text-sm text-ink/70">Du {plan.planned_start} au {plan.planned_end}.</p>}
    {message && <p role="status" className="mt-2 text-sm text-ink/70">{message}</p>}
    {state === 'failed' && <button type="button" onClick={relaunch} disabled={saving} className={`${secondaryAction} mt-3`}><RefreshCw size={14} aria-hidden="true" className="mr-1.5" />Relancer le calcul</button>}
    {summary && <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
      <div><dt className="text-xs text-ink/60">Durée</dt><dd className="font-semibold text-ink">{summary.total_duration_days} j</dd></div>
      <div><dt className="text-xs text-ink/60">Activités</dt><dd className="font-semibold text-ink">{summary.total_activities}</dd></div>
      <div><dt className="text-xs text-ink/60">Critiques</dt><dd className="font-semibold text-ink">{summary.critical_count}</dd></div>
      <div><dt className="text-xs text-ink/60">Avancement</dt><dd className="font-semibold text-ink">{Math.round(summary.progress_pct)} %</dd></div>
    </dl>}
  </div>;
}

export default function OceLotPlanning({ projectId, lots, canEdit }: { projectId: string; lots: { id: string; title?: string }[]; canEdit: boolean }) {
  if (!lots.length) return null;
  return <Card>
    <SectionHeading eyebrow="Planning" title="Dates et planning technique" description="Renseignez les dates réelles de chaque lot : D.A.O calcule automatiquement le planning technique." action={<CalendarRange size={20} aria-hidden="true" className="text-teal" />} />
    <div className="mt-4 space-y-3">{lots.map(lot => <LotPlan key={lot.id} projectId={projectId} lot={lot} canEdit={canEdit} />)}</div>
  </Card>;
}
