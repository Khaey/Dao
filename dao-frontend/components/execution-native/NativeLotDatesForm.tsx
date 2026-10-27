'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { supabaseBrowser } from '../../lib/supabase-browser';

const field = 'mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm text-ink';
const button = 'inline-flex min-h-10 items-center justify-center rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50';
type LotPlan = { status: string; planned_start?: string | null; planned_end?: string | null };

/** Dates prévues DAO du lot via l'API JWT DEV 3 (#418) : jamais de synchronisation OCE, jamais d'engagement contractuel. */
async function lotDatesApi(method: 'GET' | 'PUT', projectId: string, lotId: string, body?: unknown) {
  const { data } = await supabaseBrowser().auth.getSession();
  if (!data.session) throw new Error('Session expirée. Reconnectez-vous.');
  const response = await fetch(method === 'GET'
    ? `/api/projects/native-execution/dates?project_id=${encodeURIComponent(projectId)}&lot_id=${encodeURIComponent(lotId)}`
    : '/api/projects/native-execution/dates', {
    method, cache: 'no-store',
    headers: { Authorization: 'Bearer ' + data.session.access_token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({})) as { data?: LotPlan; error?: string };
  if (!response.ok || !payload.data) throw Object.assign(new Error(payload.error || 'Dates du lot indisponibles.'), { status: response.status });
  return payload.data;
}

export default function NativeLotDatesForm({ projectId, lotId, onSaved }: { projectId: string; lotId: string; onSaved: () => void }) {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'forbidden' | 'error'>('loading');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let alive = true;
    setPhase('loading'); setMessage(''); setNotice('');
    lotDatesApi('GET', projectId, lotId).then(plan => {
      if (!alive) return;
      setStart(plan.planned_start?.slice(0, 10) ?? ''); setEnd(plan.planned_end?.slice(0, 10) ?? ''); setPhase('ready');
    }).catch(cause => {
      if (!alive) return;
      setPhase(cause?.status === 403 ? 'forbidden' : 'error');
      setMessage(cause instanceof Error ? cause.message : 'Dates du lot indisponibles.');
    });
    return () => { alive = false; };
  }, [projectId, lotId]);

  const invalid = Boolean(start) !== Boolean(end) || Boolean(start && end && end < start);
  async function save(event: FormEvent<HTMLFormElement>, clear = false) {
    event.preventDefault();
    if (busy || (!clear && invalid)) return;
    setBusy(true); setMessage(''); setNotice('');
    try {
      await lotDatesApi('PUT', projectId, lotId, { projectId, lotId, plannedStart: clear ? null : start || null, plannedEnd: clear ? null : end || null });
      if (clear) { setStart(''); setEnd(''); }
      setNotice(clear ? 'Dates prévues effacées.' : 'Dates prévues enregistrées. Elles restent indicatives et n’engagent aucune partie.');
      onSaved();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Enregistrement impossible.'); }
    finally { setBusy(false); }
  }

  return <div className="space-y-3 rounded-xl border border-black/10 bg-white p-4">
    <div><h3 className="text-sm font-bold text-ink">Dates prévues du lot (facultatif)</h3>
      <p className="mt-1 text-xs text-black/60">Plan de travail D.A.O., distinct des dates proposées au devis, des dates convenues dans les conditions et des dates observées au carnet.</p></div>
    {phase === 'loading' && <p role="status" className="text-sm text-black/60">Chargement…</p>}
    {phase === 'forbidden' && <p role="status" className="text-sm text-black/60">Seuls le Client du chantier et le Gestionnaire habilité peuvent modifier ces dates.</p>}
    {phase === 'error' && <p role="alert" className="text-sm text-red-700">{message}</p>}
    {phase === 'ready' && <form onSubmit={event => void save(event)} className="space-y-3">
      {message && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{message}</p>}
      {notice && <p role="status" className="rounded-xl border border-teal/20 bg-teal/[0.04] p-3 text-sm text-teal">{notice}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm font-semibold">Début prévu<input className={field} type="date" value={start} disabled={busy} onChange={event => setStart(event.target.value)} /></label>
        <label className="block text-sm font-semibold">Fin prévue<input className={field} type="date" value={end} min={start || undefined} disabled={busy} onChange={event => setEnd(event.target.value)} /></label>
      </div>
      {invalid && <p className="text-xs text-red-700">Renseignez les deux dates, la fin après le début.</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={button + ' bg-teal text-white'} disabled={busy || invalid || (!start && !end)}>{busy ? 'Enregistrement…' : 'Enregistrer les dates'}</button>
        {(start || end) && <button type="button" className={button} disabled={busy} onClick={event => void save(event as unknown as FormEvent<HTMLFormElement>, true)}>Effacer les dates</button>}
      </div>
    </form>}
  </div>;
}
