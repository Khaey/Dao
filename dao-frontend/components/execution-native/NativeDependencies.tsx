'use client';

import { useMemo, useState, type FormEvent } from 'react';
import type { NativeExecutionPlanDTO } from '../../../dao-backend/src/native-tracking/contract';
import { supabaseBrowser } from '../../lib/supabase-browser';

type Plan = NativeExecutionPlanDTO;
type Link = { id: string; from: string | null; to: string | null; state: string; source: string };

const field = 'mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm text-ink';
const button = 'inline-flex min-h-10 items-center justify-center rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50';
const stateLabels: Record<string, string> = {
  effective: 'Active', awaiting_confirmation: 'En attente de confirmation', unresolved: 'Extrémité non planifiée', proposed: 'Proposée', rejected: 'Retirée',
};

/** Dépendances fin → début (FS, 0 jour) via l'API JWT DEV 3 #422 : aucune synchronisation OCE, cycles refusés côté serveur. */
async function postDependency(body: Record<string, unknown>) {
  const { data } = await supabaseBrowser().auth.getSession();
  if (!data.session) throw new Error('Session expirée. Reconnectez-vous.');
  const response = await fetch('/api/projects/native-execution/dependencies', {
    method: 'POST', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(payload.error || 'Commande refusée.');
}

/** Cibles acceptées par le serveur : lot attribué, sous-lot de l'offre retenue, activité active. */
export function planningTargets(plan: Plan) {
  const targets = new Map<string, { label: string; requestId: string }>();
  for (const lot of plan.lots) {
    if (!lot.permissions.canRead || !lot.award) continue;
    const lotTitle = lot.title?.trim() || 'Lot sans intitulé';
    targets.set(`lot:${lot.requestId}`, { label: `Lot · ${lotTitle}`, requestId: lot.requestId });
    for (const sub of lot.executionSubLots) targets.set(`node:${sub.id}`, { label: `${lotTitle} › ${sub.title}`, requestId: lot.requestId });
  }
  for (const activity of plan.activities?.items ?? []) {
    if (!activity.active) continue;
    const lot = plan.lots.find(item => item.requestId === activity.requestId);
    if (!lot?.award) continue;
    targets.set(`activity:${activity.id}`, { label: `${lot.title?.trim() || 'Lot'} › ${activity.title}`, requestId: activity.requestId });
  }
  return targets;
}

export default function NativeDependencies({ plan, requestId, canEdit, onUpdated }: {
  plan: Plan; requestId: string; canEdit: boolean; onUpdated: () => void;
}) {
  const targets = useMemo(() => planningTargets(plan), [plan]);
  const aliases = useMemo(() => {
    const map = new Map<string, string>();
    for (const key of targets.keys()) { map.set(key, key); map.set(key.slice(key.indexOf(':') + 1), key); }
    for (const lot of plan.lots) for (const sub of lot.executionSubLots) map.set(sub.nodeKey, `node:${sub.id}`);
    return map;
  }, [plan, targets]);
  const links = useMemo(() => {
    // Les liens projet (activités) priment : la vue par lot ne voit pas les extrémités « activité ».
    const all = new Map<string, Link>();
    for (const link of plan.dependencies ?? []) all.set(link.id, link);
    for (const lot of plan.lots) for (const link of lot.dependencies) if (!all.has(link.id)) all.set(link.id, link);
    const resolve = (value: string | null) => value ? aliases.get(value) ?? null : null;
    return [...all.values()].filter(link => link.state !== 'rejected').map(link => ({ ...link, from: resolve(link.from), to: resolve(link.to) }))
      .filter(link => [link.from, link.to].some(key => key && targets.get(key)?.requestId === requestId));
  }, [plan, aliases, targets, requestId]);

  const own = [...targets.entries()].filter(([, value]) => value.requestId === requestId);
  const [pred, setPred] = useState(own[0]?.[0] ?? '');
  const [succ, setSucc] = useState('');
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  if (!own.length) return null;
  const label = (key: string | null) => key ? targets.get(key)?.label ?? 'Élément non visible' : 'Élément non planifié';
  const invalid = !pred || !succ || pred === succ;

  async function run(body: Record<string, unknown>, message: string) {
    setBusy(true); setError(''); setNotice('');
    try {
      await postDependency({ projectId: plan.projectId, ...body });
      setNotice(message); setAdding(false); setRemoving(null); setSucc('');
      onUpdated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Commande impossible.'); }
    finally { setBusy(false); }
  }
  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || invalid) return;
    void run({ action: 'add', predTarget: pred, succTarget: succ }, 'Dépendance ajoutée. Le Gantt et la prévision sont recalculés à partir des dates enregistrées.');
  }

  return <div className="space-y-3 rounded-xl border border-black/10 bg-white p-4">
    <div><h3 className="text-sm font-bold text-ink">Dépendances (facultatif)</h3>
      <p className="mt-1 text-xs text-black/60">Un lien « fin → début » indique qu’un élément doit être terminé avant que le suivant commence. Il ne déplace aucune date enregistrée et n’engage aucune partie.</p></div>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="rounded-xl border border-teal/20 bg-teal/[0.04] p-3 text-sm text-teal">{notice}</p>}
    {links.length === 0 ? <p className="text-sm text-black/55">Aucune dépendance pour ce lot.</p>
      : <ul className="space-y-2">{links.map(link => <li key={link.id} className="space-y-2 rounded-xl border border-black/10 p-3 text-sm">
        <p className="break-words"><span className="font-semibold">{label(link.from)}</span> <span aria-hidden="true">→</span><span className="sr-only">doit finir avant</span> <span className="font-semibold">{label(link.to)}</span></p>
        <p className="flex flex-wrap items-center gap-2 text-xs text-black/60"><span>{stateLabels[link.state] ?? link.state}</span><span>· {link.source === 'manual' ? 'Ajoutée au suivi' : 'Proposée dans l’offre'}</span></p>
        {canEdit && removing !== link.id && <button type="button" className={button} disabled={busy} onClick={() => setRemoving(link.id)}>Retirer</button>}
        {removing === link.id && <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs">
          <p>Retirer cette dépendance du planning ?</p>
          <div className="mt-2 flex flex-wrap gap-2"><button type="button" className={button + ' bg-teal text-white'} disabled={busy} onClick={() => void run({ action: 'remove', linkId: link.id }, 'Dépendance retirée.')}>{busy ? 'Retrait…' : 'Confirmer'}</button>
            <button type="button" className={button} disabled={busy} onClick={() => setRemoving(null)}>Annuler</button></div></div>}
      </li>)}</ul>}
    {canEdit && !adding && <button type="button" className={button} disabled={busy} onClick={() => { setAdding(true); setPred(own[0][0]); setSucc(''); }}>Ajouter une dépendance</button>}
    {canEdit && adding && <form onSubmit={add} className="space-y-2">
      <label className="block text-xs font-semibold">Doit se terminer<select className={field} value={pred} disabled={busy} onChange={event => setPred(event.target.value)}>
        {[...targets.entries()].map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label>
      <label className="block text-xs font-semibold">avant le début de<select className={field} required value={succ} disabled={busy} onChange={event => setSucc(event.target.value)}>
        <option value="">Choisir</option>{[...targets.entries()].filter(([key]) => key !== pred).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label>
      <div className="flex flex-wrap gap-2"><button type="submit" className={button + ' bg-teal text-white'} disabled={busy || invalid}>{busy ? 'Envoi…' : 'Ajouter'}</button>
        <button type="button" className={button} disabled={busy} onClick={() => setAdding(false)}>Annuler</button></div>
    </form>}
    {!canEdit && <p className="text-xs text-black/55">Seuls le Client du chantier et le Gestionnaire habilité modifient les dépendances.</p>}
  </div>;
}
