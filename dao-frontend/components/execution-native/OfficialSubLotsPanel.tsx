'use client';

import { useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, ListTree, Plus, Trash2 } from 'lucide-react';
import { supabaseBrowser } from '../../lib/supabase-browser';
import { fieldClass, primaryAction, secondaryAction } from '../../app/app/projects/_components/ProjectUi';

/** Sous-lot officiel défini par le Client avant publication (`request_sub_lots`, DEV 3 #418). */
export type OfficialSubLot = { id: string; title: string; scope: string; budgetMillimes: string | null };
type Draft = { key: string; id: string | null; title: string; scope: string; budget: string };
type ApiSnapshot = { requestVersionId: string; canEdit: boolean; items: OfficialSubLot[] };

const smallButton = 'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-black/10 bg-white text-ink/65 transition hover:border-teal/40 hover:text-teal focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal disabled:opacity-40';

/** Millimes exacts en chaîne (bigint SQL) : aucune conversion flottante. */
export function tndToMillimes(value: string): string | null | undefined {
  const raw = value.trim().replace(',', '.');
  if (!raw) return null;
  const match = /^(\d{1,15})(?:\.(\d{0,3}))?$/.exec(raw);
  if (!match) return undefined;
  return (BigInt(match[1]) * BigInt(1000) + BigInt((match[2] ?? '').padEnd(3, '0'))).toString();
}

export function millimesToTnd(value: string | null): string {
  if (value == null || !/^\d+$/.test(value)) return '';
  const padded = value.padStart(4, '0');
  const fraction = padded.slice(-3).replace(/0+$/, '');
  return BigInt(padded.slice(0, -3)).toString() + (fraction ? '.' + fraction : '');
}

const formatBudget = (value: string | null) => {
  const tnd = millimesToTnd(value);
  if (!tnd) return null;
  const [whole, fraction = ''] = tnd.split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${fraction ? ',' + fraction : ''} TND`;
};

async function subLotApi(method: 'GET' | 'PUT', requestId: string, body?: unknown): Promise<ApiSnapshot> {
  const { data } = await supabaseBrowser().auth.getSession();
  if (!data.session) throw new Error('Session expirée. Reconnectez-vous.');
  const response = await fetch(method === 'GET' ? `/api/projects/requests/sub-lots?request_id=${requestId}` : '/api/projects/requests/sub-lots', {
    method, cache: 'no-store',
    headers: { Authorization: 'Bearer ' + data.session.access_token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({})) as { data?: ApiSnapshot; error?: string };
  if (response.status === 409) throw Object.assign(new Error('Le lot a changé entre-temps. Les sous-lots ont été rechargés ; vérifiez puis enregistrez à nouveau.'), { conflict: true });
  if (!response.ok || !payload.data) throw new Error(payload.error || 'Sous-lots temporairement indisponibles.');
  return payload.data;
}

const toDraft = (item: OfficialSubLot): Draft => ({ key: item.id, id: item.id, title: item.title, scope: item.scope, budget: millimesToTnd(item.budgetMillimes) });

/**
 * Sous-lots OFFICIELS du Client, distincts des sous-lots techniques proposés par un Artisan dans son devis
 * et des activités opérationnelles après attribution. Facultatifs : un lot sans sous-lot est normal.
 * Chaque enregistrement crée une nouvelle version du lot via l'API JWT ; le serveur refuse toute
 * modification après publication ou attribution.
 */
export default function OfficialSubLotsPanel({ requestId, lotTitle, items, canManage, onSaved }: {
  requestId: string; lotTitle: string; items: OfficialSubLot[]; canManage: boolean; onSaved: () => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [snapshot, setSnapshot] = useState<ApiSnapshot | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);

  async function open(addRow: boolean) {
    setBusy(true); setError(''); setEditing(true);
    try {
      const fresh = await subLotApi('GET', requestId);
      setSnapshot(fresh);
      const rows = fresh.items.map(toDraft);
      setDrafts(addRow && fresh.canEdit ? [...rows, { key: crypto.randomUUID(), id: null, title: '', scope: '', budget: '' }] : rows);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Sous-lots temporairement indisponibles.'); setSnapshot(null); }
    finally { setBusy(false); }
  }

  const update = (key: string, patch: Partial<Draft>) => setDrafts(rows => rows.map(row => row.key === key ? { ...row, ...patch } : row));
  const move = (index: number, delta: number) => setDrafts(rows => {
    const next = [...rows]; const target = index + delta;
    if (target < 0 || target >= next.length) return rows;
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  const invalidBudget = drafts.some(row => tndToMillimes(row.budget) === undefined);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!snapshot?.canEdit || busy || invalidBudget || drafts.some(row => !row.title.trim() || !row.scope.trim())) return;
    setBusy(true); setError('');
    try {
      await subLotApi('PUT', requestId, {
        requestId, expectedRequestVersionId: snapshot.requestVersionId,
        items: drafts.map(row => ({ id: row.id, title: row.title.trim(), scope: row.scope.trim(), budgetMillimes: tndToMillimes(row.budget) ?? null })),
      });
      setEditing(false); setSnapshot(null); setExpanded(true);
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Enregistrement impossible.');
      if ((cause as { conflict?: boolean })?.conflict) {
        try { const fresh = await subLotApi('GET', requestId); setSnapshot(fresh); setDrafts(fresh.items.map(toDraft)); } catch { /* message déjà affiché */ }
      }
    } finally { setBusy(false); }
  }

  if (!items.length && !canManage) return null;

  return <div className="mt-3 rounded-xl border border-black/[0.06] bg-sand/40 p-3" data-testid="official-sub-lots">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-ink/75"><ListTree size={14} aria-hidden="true" className="text-teal" />{items.length ? `Sous-lots officiels (${items.length})` : 'Sous-lots officiels'}</p>
      {!editing && <div className="flex flex-wrap gap-2">
        {items.length > 0 && <button type="button" className="min-h-9 rounded-lg px-2 text-xs font-semibold text-teal hover:bg-teal/5" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Masquer' : 'Afficher'}</button>}
        {canManage && items.length > 0 && <button type="button" className="min-h-9 rounded-lg px-2 text-xs font-semibold text-ink/75 hover:bg-white" onClick={() => void open(false)}>Modifier</button>}
        {canManage && <button type="button" className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-black/10 bg-white px-2.5 text-xs font-semibold text-ink hover:border-teal" onClick={() => void open(true)} aria-label={`Ajouter un sous-lot au lot ${lotTitle}`}><Plus size={14} aria-hidden="true" />Ajouter un sous-lot</button>}
      </div>}
    </div>
    {!items.length && !editing && <p className="mt-1 text-xs text-ink/60">Facultatif : découpez ce lot avant publication si cela aide les Artisans à chiffrer.</p>}
    {expanded && !editing && items.length > 0 && <ol className="mt-2 space-y-1.5">{items.map((item, index) => <li key={item.id} className="rounded-lg bg-white px-3 py-2 text-xs">
      <p className="flex flex-wrap justify-between gap-2"><span className="font-semibold text-ink">{index + 1}. {item.title}</span>{formatBudget(item.budgetMillimes) && <span className="tabular-nums text-ink/70">{formatBudget(item.budgetMillimes)}</span>}</p>
      <p className="mt-0.5 whitespace-pre-line break-words text-ink/65">{item.scope}</p>
    </li>)}</ol>}
    {editing && <form onSubmit={save} className="mt-3 space-y-3" aria-label={`Sous-lots officiels du lot ${lotTitle}`}>
      <p className="text-xs leading-relaxed text-ink/65">Ces sous-lots décrivent votre demande. Ils sont distincts des sous-lots techniques qu’un Artisan peut proposer dans son devis et des activités suivies après attribution. Enregistrer crée une nouvelle version du lot.</p>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">{error}</p>}
      {busy && !snapshot && <p role="status" className="text-xs text-ink/60">Chargement des sous-lots…</p>}
      {snapshot && !snapshot.canEdit && <p role="status" className="rounded-lg bg-white p-2.5 text-xs text-ink/70">Ce lot n’est plus modifiable : ses sous-lots sont figés depuis la publication ou l’attribution.</p>}
      {snapshot?.canEdit && <>
        {drafts.length === 0 && <p className="text-xs text-ink/60">Aucun sous-lot : le lot sera publié tel quel.</p>}
        {drafts.map((row, index) => <fieldset key={row.key} className="space-y-2 rounded-lg border border-black/10 bg-white p-3">
          <legend className="sr-only">Sous-lot {index + 1}</legend>
          <div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-ink/70">Sous-lot {index + 1}{row.id ? '' : ' · nouveau'}</span>
            <span className="flex gap-1.5"><button type="button" className={smallButton} disabled={busy || index === 0} onClick={() => move(index, -1)} aria-label={`Monter le sous-lot ${index + 1}`}><ArrowUp size={14} aria-hidden="true" /></button><button type="button" className={smallButton} disabled={busy || index === drafts.length - 1} onClick={() => move(index, 1)} aria-label={`Descendre le sous-lot ${index + 1}`}><ArrowDown size={14} aria-hidden="true" /></button><button type="button" className={smallButton + ' text-red-600'} disabled={busy} onClick={() => setDrafts(rows => rows.filter(item => item.key !== row.key))} aria-label={`Retirer le sous-lot ${index + 1}`}><Trash2 size={14} aria-hidden="true" /></button></span></div>
          <label className="block text-xs font-semibold text-ink">Intitulé<input className={fieldClass + ' mt-1'} required maxLength={200} value={row.title} disabled={busy} onChange={event => update(row.key, { title: event.target.value })} /></label>
          <label className="block text-xs font-semibold text-ink">Périmètre<textarea className={fieldClass + ' mt-1 min-h-20 resize-y'} required maxLength={10000} value={row.scope} disabled={busy} onChange={event => update(row.key, { scope: event.target.value })} /></label>
          <label className="block text-xs font-semibold text-ink">Budget indicatif (TND, facultatif)<input className={fieldClass + ' mt-1'} inputMode="decimal" value={row.budget} disabled={busy} aria-invalid={tndToMillimes(row.budget) === undefined} onChange={event => update(row.key, { budget: event.target.value })} /></label>
          {tndToMillimes(row.budget) === undefined && <p className="text-xs text-red-700">Montant invalide (3 décimales au maximum).</p>}
        </fieldset>)}
        <button type="button" className={secondaryAction} disabled={busy || drafts.length >= 100} onClick={() => setDrafts(rows => [...rows, { key: crypto.randomUUID(), id: null, title: '', scope: '', budget: '' }])}><Plus size={16} aria-hidden="true" />Ajouter un sous-lot</button>
      </>}
      <div className="flex flex-wrap gap-2">
        {snapshot?.canEdit && <button type="submit" className={primaryAction} disabled={busy || invalidBudget || drafts.some(row => !row.title.trim() || !row.scope.trim())}>{busy ? 'Enregistrement…' : 'Enregistrer les sous-lots'}</button>}
        <button type="button" className={secondaryAction} disabled={busy && Boolean(snapshot)} onClick={() => { setEditing(false); setSnapshot(null); setError(''); }}>{snapshot?.canEdit ? 'Annuler' : 'Fermer'}</button>
      </div>
    </form>}
  </div>;
}
