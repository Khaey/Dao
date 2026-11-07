'use client';

// #587 — Modifications de périmètre d'un lot attribué (décision du propriétaire, 07/11/2026) :
// un nouvel ouvrage après attribution passe par une proposition validée par les deux parties, jamais par un
// ouvrage privé. L'acceptation crée une nouvelle version du périmètre du lot ; la version attribuée reste
// conservée. Aucun montant : ni le prix attribué, ni le contrat, ni un paiement ne changent.
// Toutes les règles (parties, proposition unique en attente, référentiel publié) sont vérifiées par la base.
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, History, Plus, Search, Undo2, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Card, SectionHeading } from '../ui';
import { fieldClass, primaryAction, secondaryAction } from '../../app/app/projects/_components/ProjectUi';
import { UNIT_SYMBOLS } from '../../../dao-backend/src/btp-takeoff-ui/presentation';
import type { GuidedCatalog } from '../../../dao-backend/src/btp-reference/guided-selection';
import { WorkItemsError, loadGuidedCatalog, normalizeSearch, workItemKey, workItemsApi } from '../work-items/workItemsApi';

type Role = 'client' | 'contractor';
type ScopeWork = { id?: string; label: string; unitCode: string | null; workCode?: string | null; custom: boolean; subLotId: string | null; scopeChangeId?: string | null; toConfirm?: boolean };
type ProposedWork = { workId: string | null; workCode: string | null; label: string; unitCode: string | null; custom: boolean; subLotId: string | null; catalogVersionCode: string | null };
type ScopeChange = {
  id: string; state: 'pending' | 'accepted' | 'rejected' | 'withdrawn'; proposerRole: Role; proposedAt: string; reason: string;
  items: ProposedWork[]; baseVersionNo: number; resultVersionNo: number | null; decidedRole: Role | null; decidedAt: string | null;
  decisionReason: string | null; canDecide: boolean; canWithdraw: boolean;
};
type ScopeLot = {
  awardItemId: string; requestId: string; title: string; contractorName: string; viewerRole: Role | 'observer';
  currentVersion: { versionNo: number; works: ScopeWork[] };
  versions: Array<{ versionNo: number; createdAt: string; scopeChangeId: string | null; worksCount: number }>;
  subLots: Array<{ id: string; title: string }>; canPropose: boolean; changes: ScopeChange[];
};
type Snapshot = { projectId: string; catalogVersion: { id: string; code: string } | null; lots: ScopeLot[]; changeId?: string };

const sym = (unit?: string | null) => unit ? UNIT_SYMBOLS[unit] ?? unit : '';
const PARTY: Record<Role, string> = { client: 'le Client', contractor: 'l’Artisan' };
const STATE: Record<ScopeChange['state'], string> = { pending: 'En attente de validation', accepted: 'Acceptée', rejected: 'Refusée', withdrawn: 'Retirée' };
const date = (value: string | null) => value ? new Date(value).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

export default function LotScopeChanges({ projectId, canSeeTakeoffs }: { projectId: string; canSeeTakeoffs: boolean }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const path = `/api/projects/scope-changes?project_id=${encodeURIComponent(projectId)}`;
  const reload = useCallback(async () => {
    try { setSnapshot(await workItemsApi<Snapshot>(path)); setState('ready'); }
    catch (e: any) { if (e instanceof WorkItemsError && (e.status === 403 || e.status === 401)) setState('forbidden'); else { setState('error'); setError(e?.message ?? 'Indisponible.'); } }
  }, [path]);
  useEffect(() => { void reload(); }, [reload]);

  async function run(body: Record<string, unknown>, done: string) {
    setBusy(true); setError(''); setMessage('');
    try {
      setSnapshot(await workItemsApi<Snapshot>('/api/projects/scope-changes', { idempotencyKey: workItemKey(`sc-${body.action}`), ...body }));
      setMessage(done); return true;
    } catch (e: any) {
      setError(e?.message ?? 'Opération refusée.');
      if (e instanceof WorkItemsError && e.status === 409) void reload();
      return false;
    } finally { setBusy(false); }
  }

  return <Card className="space-y-4 p-5 sm:p-6" data-testid="scope-changes">
    <SectionHeading title="Modifications de périmètre" description="Après attribution, un nouvel ouvrage s’ajoute seulement par une modification proposée par une partie et acceptée par l’autre. Chaque acceptation crée une nouvelle version du lot ; la version attribuée reste conservée." />
    <p className="rounded-xl bg-sand px-4 py-3 text-sm text-ink/70" data-testid="scope-no-price">Aucun montant n’est saisi ici : une modification acceptée ne change ni le prix attribué, ni le contrat, ni aucun paiement.</p>
    {state === 'loading' && <p role="status" className="text-sm text-ink/60">Chargement…</p>}
    {state === 'forbidden' && <p className="text-sm text-ink/60">Aucun lot attribué dont vous êtes partie sur ce chantier.</p>}
    {state === 'error' && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="rounded-xl bg-teal/10 px-4 py-3 text-sm text-teal" data-testid="scope-message">{message}{canSeeTakeoffs && message.includes('Version') && <> <Link href={`/app/native-execution/${projectId}?section=metres`} className="font-semibold underline">Ouvrir les métrés d’exécution</Link></>}</p>}
    {state === 'ready' && error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {state === 'ready' && snapshot && (snapshot.lots.length === 0
      ? <p className="text-sm text-ink/60">Aucun lot attribué sur ce chantier pour l’instant.</p>
      : snapshot.lots.map(lot => <LotCard key={lot.awardItemId} lot={lot} busy={busy} run={run} />))}
  </Card>;
}

function LotCard({ lot, busy, run }: { lot: ScopeLot; busy: boolean; run: (body: Record<string, unknown>, done: string) => Promise<boolean> }) {
  const [proposing, setProposing] = useState(false);
  const pending = lot.changes.find(c => c.state === 'pending');
  const past = lot.changes.filter(c => c.state !== 'pending');
  const subLot = (id: string | null) => id ? lot.subLots.find(s => s.id === id)?.title ?? null : null;
  return <section className="rounded-xl border border-black/[0.08] p-4" data-testid="scope-lot" aria-label={`Lot ${lot.title}`}>
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0"><h3 className="font-semibold text-ink">{lot.title}</h3>
        <p className="text-sm text-ink/60">Titulaire : {lot.contractorName} · <span data-testid="scope-version">Version {lot.currentVersion.versionNo} du périmètre</span> · {lot.currentVersion.works.length} ouvrage(s)</p></div>
      {lot.canPropose && !proposing && <button type="button" className={secondaryAction} onClick={() => setProposing(true)} disabled={busy}><Plus size={15} aria-hidden="true" />Proposer un nouvel ouvrage</button>}
    </div>
    <details className="mt-3"><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-teal">Ouvrages de la version {lot.currentVersion.versionNo}</summary>
      {lot.currentVersion.works.length === 0
        ? <p className="text-sm text-ink/60">Aucun ouvrage détaillé dans la version attribuée.</p>
        : <ul className="mt-1 space-y-1 text-sm">{lot.currentVersion.works.map((w, i) => <li key={w.id ?? i} className="flex flex-wrap items-center gap-2"><span className="text-ink">{w.label}</span>
          {w.unitCode && <span className="text-xs text-ink/55">{sym(w.unitCode)}</span>}{subLot(w.subLotId) && <span className="text-xs text-ink/55">· {subLot(w.subLotId)}</span>}
          {w.scopeChangeId ? <span className="rounded-full bg-teal/10 px-2 text-[11px] text-teal">ajouté par modification</span> : <span className="rounded-full bg-sand px-2 text-[11px] text-ink/65">version attribuée</span>}</li>)}</ul>}
    </details>
    {pending && <PendingChange change={pending} lot={lot} busy={busy} run={run} subLot={subLot} />}
    {proposing && <ProposeForm lot={lot} busy={busy} onClose={() => setProposing(false)} onSubmit={async (items, reason) => {
      if (await run({ action: 'propose', awardItemId: lot.awardItemId, reason, items }, `Proposition envoyée à ${lot.viewerRole === 'client' ? 'l’Artisan' : 'au Client'} pour validation.`)) setProposing(false);
    }} />}
    {past.length > 0 && <details className="mt-3"><summary className="flex min-h-11 cursor-pointer items-center gap-2 py-2 text-sm font-semibold text-ink/70"><History size={15} aria-hidden="true" />Historique ({past.length})</summary>
      <ul className="space-y-2 text-sm">{past.map(c => <li key={c.id} className="rounded-lg bg-sand/60 p-3"><p className="font-semibold text-ink">{STATE[c.state]}{c.resultVersionNo ? ` · version ${c.resultVersionNo}` : ''}</p>
        <p className="text-ink/70">Proposée par {PARTY[c.proposerRole]} le {date(c.proposedAt)} : {c.reason}</p>
        <p className="text-ink/70">{c.items.map(i => i.label).join(' · ')}</p>
        {c.decisionReason && <p className="text-ink/70">Motif {c.state === 'withdrawn' ? 'du retrait' : 'du refus'} : {c.decisionReason}</p>}</li>)}</ul></details>}
  </section>;
}

function PendingChange({ change, lot, busy, run, subLot }: { change: ScopeChange; lot: ScopeLot; busy: boolean; run: (body: Record<string, unknown>, done: string) => Promise<boolean>; subLot: (id: string | null) => string | null }) {
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState('');
  const other = change.proposerRole === 'client' ? 'l’Artisan' : 'le Client';
  return <div className="mt-3 rounded-xl bg-amber-50 p-4 text-sm" data-testid="scope-pending">
    <p className="font-semibold text-amber-950">Proposition de {PARTY[change.proposerRole]} du {date(change.proposedAt)} · en attente de {other}</p>
    <p className="mt-1 text-ink/75">Motif : {change.reason}</p>
    <ul className="mt-2 list-disc space-y-0.5 pl-5 text-ink">{change.items.map((i, n) => <li key={n}>{i.label}{i.unitCode ? ` (${sym(i.unitCode)})` : ''}{subLot(i.subLotId) ? ` · ${subLot(i.subLotId)}` : ''}{i.custom ? ' · hors référentiel' : ''}</li>)}</ul>
    {change.canDecide && !refusing && <div className="mt-3 flex flex-col gap-2 sm:flex-row">
      <button type="button" className={primaryAction} disabled={busy} onClick={() => void run({ action: 'accept', changeId: change.id }, `Modification acceptée : version ${change.baseVersionNo + 1} du périmètre de « ${lot.title} ». Les nouveaux ouvrages sont mesurables dans les métrés d’exécution.`)}><Check size={15} aria-hidden="true" />Accepter</button>
      <button type="button" className={secondaryAction} disabled={busy} onClick={() => setRefusing(true)}><X size={15} aria-hidden="true" />Refuser</button></div>}
    {change.canDecide && refusing && <form className="mt-3 space-y-2" onSubmit={e => { e.preventDefault(); if (reason.trim().length >= 5) void run({ action: 'reject', changeId: change.id, reason: reason.trim() }, 'Modification refusée.'); }}>
      <label className="block text-xs font-semibold text-ink/70">Motif du refus<textarea className={cn(fieldClass, 'mt-1 min-h-20')} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} /></label>
      <div className="flex flex-col gap-2 sm:flex-row"><button type="submit" className={primaryAction} disabled={busy || reason.trim().length < 5}>Confirmer le refus</button>
        <button type="button" className={secondaryAction} onClick={() => setRefusing(false)}>Annuler</button></div></form>}
    {change.canWithdraw && <button type="button" className={cn(secondaryAction, 'mt-3')} disabled={busy} onClick={() => void run({ action: 'withdraw', changeId: change.id }, 'Proposition retirée.')}><Undo2 size={15} aria-hidden="true" />Retirer ma proposition</button>}
    {!change.canDecide && !change.canWithdraw && <p className="mt-2 text-xs text-ink/60">Lecture seule : seules les parties au lot décident.</p>}
  </div>;
}

type Picked = { key: string; workId?: string; label: string; unitCode: string | null };
function ProposeForm({ lot, busy, onClose, onSubmit }: { lot: ScopeLot; busy: boolean; onClose: () => void; onSubmit: (items: Record<string, unknown>[], reason: string) => Promise<void> }) {
  const [catalog, setCatalog] = useState<GuidedCatalog | null>(null);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Picked[]>([]);
  const [custom, setCustom] = useState('');
  const [subLotId, setSubLotId] = useState('');
  const [reason, setReason] = useState('');
  useEffect(() => { void loadGuidedCatalog().then(setCatalog).catch(e => setLoadError(e?.message ?? 'Référentiel indisponible.')); }, []);
  const results = useMemo(() => {
    const text = normalizeSearch(query.trim());
    if (!catalog || text.length < 2) return [];
    const out: Array<{ workId: string; label: string; unitCode: string; path: string }> = [];
    for (const g of catalog.groups) for (const s of g.subLots) for (const w of s.works) {
      if (w.lifecycle === 'retired') continue;
      if (normalizeSearch([w.label, ...w.aliases, s.subLot.label, g.lot.label].join(' ')).includes(text)) out.push({ workId: w.workId, label: w.label, unitCode: w.unit.code, path: `${g.lot.label} › ${s.subLot.label}` });
    }
    return out.slice(0, 40);
  }, [catalog, query]);
  const toggle = (w: { workId: string; label: string; unitCode: string }) => setPicked(all => all.some(p => p.key === w.workId) ? all.filter(p => p.key !== w.workId) : [...all, { key: w.workId, workId: w.workId, label: w.label, unitCode: w.unitCode }]);
  const ready = picked.length > 0 && reason.trim().length >= 5;
  return <div className="mt-3 rounded-xl bg-white p-4 ring-1 ring-teal/20" data-testid="scope-propose">
    <div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold text-ink">Proposer un nouvel ouvrage</p>
      <button type="button" className={cn(secondaryAction, 'h-11 w-11 px-0')} onClick={onClose} aria-label="Fermer la proposition"><X size={15} aria-hidden="true" /></button></div>
    {lot.subLots.length > 0 && <label className="mt-2 block text-xs font-semibold text-ink/70">Placer dans
      <select className={cn(fieldClass, 'mt-1')} value={subLotId} onChange={e => setSubLotId(e.target.value)}><option value="">Directement dans le lot</option>{lot.subLots.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>}
    <label className="relative mt-2 block"><span className="sr-only">Rechercher un ouvrage</span><Search size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/45" />
      <input className={cn(fieldClass, 'pl-9')} value={query} onChange={e => setQuery(e.target.value)} placeholder="Rechercher dans le référentiel : carrelage, enduit…" aria-label="Rechercher un ouvrage" /></label>
    {loadError && <p role="alert" className="mt-2 text-sm text-red-700">{loadError}</p>}
    {catalog && query.trim().length >= 2 && <ul className="mt-2 max-h-64 overflow-y-auto pr-1" aria-label="Ouvrages du référentiel">
      {results.length === 0 && <li className="text-sm text-ink/60">Aucun ouvrage correspondant dans le référentiel {catalog.catalogVersion?.code ?? ''}.</li>}
      {results.map(w => <li key={w.workId}><label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg px-2 py-2 text-sm hover:bg-sand">
        <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[#0f766e]" checked={picked.some(p => p.key === w.workId)} onChange={() => toggle(w)} />
        <span className="min-w-0"><span className="text-ink">{w.label}</span> <span className="text-xs text-ink/55">· {sym(w.unitCode)} · {w.path}</span></span></label></li>)}
    </ul>}
    <form className="mt-2 flex flex-col gap-2 sm:flex-row" onSubmit={e => { e.preventDefault(); const label = custom.trim(); if (label.length >= 2) { setPicked(all => [...all, { key: `custom-${all.length}-${label}`, label, unitCode: null }]); setCustom(''); } }}>
      <label className="min-w-0 flex-1"><span className="sr-only">Ouvrage hors référentiel</span><input className={fieldClass} maxLength={200} value={custom} onChange={e => setCustom(e.target.value)} placeholder="Ouvrage hors référentiel : pose d’une pergola bois" aria-label="Ouvrage hors référentiel" /></label>
      <button type="submit" className={secondaryAction} disabled={custom.trim().length < 2}>Ajouter</button></form>
    {picked.length > 0 && <ul className="mt-3 space-y-1 text-sm" aria-label="Ouvrages proposés">{picked.map(p => <li key={p.key} className="flex items-center justify-between gap-2 rounded-lg bg-sand px-3 py-1.5">
      <span>{p.label}{p.unitCode ? ` (${sym(p.unitCode)})` : ''}{p.workId ? '' : ' · hors référentiel'}</span>
      <button type="button" className="min-h-11 min-w-11 text-ink/60" aria-label={`Retirer ${p.label}`} onClick={() => setPicked(all => all.filter(x => x.key !== p.key))}><X size={15} aria-hidden="true" /></button></li>)}</ul>}
    <label className="mt-3 block text-xs font-semibold text-ink/70">Motif de la modification (obligatoire)
      <textarea className={cn(fieldClass, 'mt-1 min-h-20')} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} placeholder="Ex. le Client demande une terrasse supplémentaire côté jardin" /></label>
    <p className="mt-1 text-xs text-ink/60">L’autre partie au lot devra accepter. Aucun montant n’est associé.</p>
    <button type="button" className={cn(primaryAction, 'mt-3')} disabled={busy || !ready}
      onClick={() => void onSubmit(picked.map(p => ({ subLotId: subLotId || null, ...(p.workId ? { workId: p.workId } : { label: p.label }) })), reason.trim())}>
      Envoyer la proposition{picked.length ? ` (${picked.length} ouvrage${picked.length > 1 ? 's' : ''})` : ''}</button>
  </div>;
}
