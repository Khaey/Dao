'use client';

// #577 — Ouvrages d'un lot (Lot › Sous-lot facultatif › Ouvrage), saisie manuelle sans dimension.
// Les ouvrages proposés viennent du contrat de consultation guidée #578 (référentiel publié, version,
// unité, modèles, règles et limites conservés) ; un ouvrage hors référentiel reste possible mais n'est
// jamais chiffré. Un même ouvrage peut être ajouté plusieurs fois (une occurrence par pièce ou zone).
// Les dimensions se renseignent ensuite, occurrence par occurrence, dans les métrés.
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Check, CircleHelp, Lock, Plus, Ruler, Search, Trash2, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { fieldClass, primaryAction, secondaryAction } from '../../app/app/projects/_components/ProjectUi';
import { UNIT_SYMBOLS } from '../../../dao-backend/src/btp-takeoff-ui/presentation';
import { suggestGuidedWorks, type GuidedCatalog, type GuidedNature, type GuidedSuggestion, type GuidedUsage } from '../../../dao-backend/src/btp-reference/guided-selection';
import { LOCK_LABELS, loadGuidedCatalog, workItemCommand, type WorkItem, type WorkItemLot, type WorkItemsSnapshot } from './workItemsApi';

const sym = (unit?: string | null) => unit ? UNIT_SYMBOLS[unit] ?? unit : '';
const DIRECT = '';

export default function LotWorksPanel({ projectId, projectType, lot, canEdit, onChanged }: { projectId: string; projectType?: string | null; lot: WorkItemLot; canEdit: boolean; onChanged: (snapshot: WorkItemsSnapshot, message: string) => void }) {
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const editable = canEdit && !lot.lockReason;
  const groups = useMemo(() => {
    const out: Array<{ id: string; title: string; items: WorkItem[] }> = [{ id: DIRECT, title: 'Directement dans le lot', items: [] }];
    for (const sub of lot.subLots) out.push({ id: sub.id, title: sub.title, items: [] });
    for (const item of lot.items) (out.find(g => g.id === (item.subLotCurrent ? item.subLotId ?? DIRECT : DIRECT)) ?? out[0]).items.push(item);
    return out.filter(g => g.items.length > 0);
  }, [lot]);

  async function run(body: Record<string, unknown>, message: string) {
    setBusy(true); setError('');
    try { const snapshot = await workItemCommand(body); onChanged(snapshot, message); return true; }
    catch (e: any) { setError(e?.message ?? 'Opération refusée.'); return false; }
    finally { setBusy(false); }
  }

  return <section aria-label={`Ouvrages du lot ${lot.title}`} className="mt-3 rounded-xl border border-black/[0.06] bg-sand/40 p-3" data-testid="lot-works">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm font-semibold text-ink">Ouvrages <span className="font-normal text-ink/60">({lot.items.length})</span></p>
      {editable && !picker && <button type="button" className={cn(secondaryAction, 'min-h-11 px-3')} onClick={() => setPicker(true)} aria-label={`Ajouter des ouvrages au lot ${lot.title}`}><Plus size={15} aria-hidden="true" />Ajouter des ouvrages</button>}
    </div>
    {lot.lockReason && <p className="mt-2 flex items-start gap-2 text-xs text-ink/70"><Lock size={13} aria-hidden="true" className="mt-0.5 shrink-0" />{LOCK_LABELS[lot.lockReason]}</p>}
    {error && <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
    {lot.items.length === 0 && !picker && <p className="mt-2 text-xs text-ink/65">{editable ? 'Aucun ouvrage pour l’instant. Choisissez-les dans le référentiel D.A.O. ; les dimensions se renseignent plus tard.' : 'Aucun ouvrage détaillé pour ce lot.'}</p>}
    {groups.map(group => <div key={group.id || 'direct'} className="mt-3">
      {(lot.subLots.length > 0) && <p data-testid="work-group-title" className="text-xs font-semibold uppercase tracking-[0.08em] text-ink/60">{group.title}</p>}
      <ul className="mt-1 space-y-1.5">{group.items.map(item => <ItemRow key={item.id} projectId={projectId} item={item} lot={lot} editable={editable} busy={busy} run={run} />)}</ul>
    </div>)}
    {picker && <WorkPicker lot={lot} projectType={projectType} busy={busy} onClose={() => setPicker(false)}
      onAdd={async (items, message) => { if (await run({ action: 'add', requestId: lot.requestId, items }, message)) setPicker(false); }} />}
  </section>;
}

function ItemRow({ projectId, item, lot, editable, busy, run }: { projectId: string; item: WorkItem; lot: WorkItemLot; editable: boolean; busy: boolean; run: (body: Record<string, unknown>, message: string) => Promise<boolean> }) {
  return <li className="rounded-lg bg-white px-3 py-2 ring-1 ring-black/[0.05]" data-testid="work-item">
    <div className="flex flex-wrap items-start gap-2">
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-semibold text-ink">{item.label}</p>
        <p className="mt-0.5 flex flex-wrap gap-x-2 gap-y-1 text-xs text-ink/60">
          {item.unitCode && <span>unité {sym(item.unitCode)}</span>}
          {item.custom && <span className="rounded-full bg-amber-50 px-2 text-amber-900">Hors référentiel · non chiffré</span>}
          {item.confirmation === 'to_confirm' && <span className="rounded-full bg-amber-50 px-2 text-amber-900">À confirmer</span>}
          {item.origin === 'assistant' && <span>retenu avec l’assistant</span>}
          {item.modelState === 'historical_unavailable' && <span className="rounded-full bg-sand px-2 text-ink/75" data-testid="model-historical">Modèle historique indisponible{item.catalogVersionCode ? ` (référentiel ${item.catalogVersionCode})` : ''}</span>}
          {item.takeoffs > 0 && <span>{item.takeoffs} métré(s){item.validatedTakeoffs ? ` dont ${item.validatedTakeoffs} validé(s)` : ''}</span>}
        </p>
      </div>
      {item.measurable && !lot.awarded && lot.lockReason !== 'awarded' && <Link href={`/app/projects/${projectId}/metres?item=${item.id}`} className={cn(secondaryAction, 'min-h-11 px-3')} aria-label={`Renseigner les dimensions : ${item.label}`}><Ruler size={14} aria-hidden="true" />Dimensions</Link>}
    </div>
    {editable && <div className="mt-2 flex flex-wrap items-center gap-2">
      {lot.subLots.length > 0 && <label className="min-w-0 flex-1 text-xs text-ink/65"><span className="sr-only">Sous-lot de {item.label}</span>
        <select className={cn(fieldClass, 'min-h-11 py-1.5')} disabled={busy} value={item.subLotCurrent ? item.subLotId ?? DIRECT : DIRECT} aria-label={`Sous-lot de ${item.label}`}
          onChange={e => void run({ action: 'update', itemId: item.id, expectedRevision: item.revision, subLotId: e.target.value || null }, 'Ouvrage déplacé.')}>
          <option value={DIRECT}>Directement dans le lot</option>{lot.subLots.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select></label>}
      <button type="button" className={cn(secondaryAction, 'min-h-11 px-3')} disabled={busy}
        onClick={() => void run({ action: 'update', itemId: item.id, expectedRevision: item.revision, confirmation: item.confirmation === 'to_confirm' ? 'selected' : 'to_confirm' }, item.confirmation === 'to_confirm' ? 'Ouvrage confirmé.' : 'Ouvrage marqué « à confirmer ».')}>
        {item.confirmation === 'to_confirm' ? <><Check size={14} aria-hidden="true" />Confirmer</> : <><CircleHelp size={14} aria-hidden="true" />À confirmer</>}
      </button>
      <button type="button" className={cn(secondaryAction, 'min-h-11 px-3 text-red-700')} disabled={busy || item.takeoffs > 0} title={item.takeoffs > 0 ? 'Cet ouvrage a des métrés : il est conservé pour leur historique.' : undefined}
        aria-label={`Retirer ${item.label}`} onClick={() => void run({ action: 'remove', itemId: item.id, expectedRevision: item.revision }, `Retiré : ${item.label}.`)}><Trash2 size={14} aria-hidden="true" />Retirer</button>
    </div>}
  </li>;
}

const USAGES: Array<[GuidedUsage, string]> = [['free', 'Non précisé'], ['house', 'Maison'], ['apartment', 'Appartement'], ['commercial', 'Local commercial'], ['office', 'Bureaux'], ['other', 'Autre lieu']];
const NATURE_OF: Record<string, GuidedNature> = { construction: 'construction', renovation: 'renovation', extension: 'extension', repair: 'repair', other: 'other' };
const MEASURE_LABEL: Record<GuidedSuggestion['measurement']['status'], string> = { no_model: 'pas de modèle de métré', dimensions_required: 'dimensions à saisir ensuite', not_calculable: 'non calculable ici' };
const PRO_LABEL: Partial<Record<GuidedSuggestion['professional']['status'], string>> = { study_required: 'étude technique requise', confirmation_required: 'confirmation par un professionnel' };

function WorkPicker({ lot, projectType, busy, onAdd, onClose }: { lot: WorkItemLot; projectType?: string | null; busy: boolean; onAdd: (items: Record<string, unknown>[], message: string) => Promise<void>; onClose: () => void }) {
  const [catalog, setCatalog] = useState<GuidedCatalog | null>(null);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [usage, setUsage] = useState<GuidedUsage>('free');
  const [picked, setPicked] = useState<string[]>([]);
  const [subLotId, setSubLotId] = useState(DIRECT);
  const [toConfirm, setToConfirm] = useState(false);
  const [custom, setCustom] = useState('');
  useEffect(() => { void loadGuidedCatalog().then(setCatalog).catch(e => setLoadError(e?.message ?? 'Référentiel indisponible.')); }, []);
  // Occurrences déjà présentes à cet endroit : simple indication, jamais un blocage (deux pièces = deux occurrences).
  const existing = new Map<string, number>();
  for (const i of lot.items) if (i.workId && (i.subLotId ?? DIRECT) === subLotId) existing.set(i.workId, (existing.get(i.workId) ?? 0) + 1);
  const nature = projectType ? NATURE_OF[projectType] : undefined;
  const text = query.trim();
  const groups = useMemo(() => {
    if (!catalog) return [];
    // Sans recherche : ouvrages du métier du lot dont la nature des travaux est documentée.
    // Avec recherche : tout le référentiel, y compris sans preuve de pertinence (signalé).
    const result = suggestGuidedWorks(catalog, { usage, nature, text: text || undefined, includeWithoutEvidence: Boolean(text) || !nature });
    const out: Array<{ title: string; works: GuidedSuggestion[] }> = [];
    for (const g of result.groups) {
      if (!text && lot.tradeId && g.lot.tradeId !== lot.tradeId) continue;
      for (const s of g.subLots) out.push({ title: `${g.lot.label} › ${s.subLot.label}`, works: s.works });
    }
    return out;
  }, [catalog, usage, nature, text, lot.tradeId]);
  const shown = groups.reduce((n, g) => n + g.works.length, 0);
  const toggle = (id: string) => setPicked(all => all.includes(id) ? all.filter(x => x !== id) : [...all, id]);
  const base = { subLotId: subLotId || null, confirmation: toConfirm ? 'to_confirm' : 'selected' };

  return <div className="mt-3 rounded-xl bg-white p-3 ring-1 ring-teal/20" data-testid="work-picker">
    <div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold text-ink">Ajouter des ouvrages</p>
      <button type="button" className={cn(secondaryAction, 'h-11 w-11 px-0')} onClick={onClose} aria-label="Fermer l’ajout d’ouvrages"><X size={15} aria-hidden="true" /></button></div>
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      {lot.subLots.length > 0 && <label className="text-xs font-semibold text-ink/70">Placer dans
        <select className={cn(fieldClass, 'mt-1')} value={subLotId} onChange={e => setSubLotId(e.target.value)} aria-label="Placer dans"><option value={DIRECT}>Directement dans le lot</option>{lot.subLots.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>}
      <label className="text-xs font-semibold text-ink/70">Type de lieu
        <select className={cn(fieldClass, 'mt-1')} value={usage} onChange={e => setUsage(e.target.value as GuidedUsage)} aria-label="Type de lieu">{USAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label className="flex min-h-11 items-center gap-2 self-end text-sm text-ink/80"><input type="checkbox" className="h-4 w-4 accent-[#0f766e]" checked={toConfirm} onChange={e => setToConfirm(e.target.checked)} />À confirmer plus tard</label>
    </div>
    <label className="relative mt-2 block"><span className="sr-only">Rechercher un ouvrage</span><Search size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/45" />
      <input className={cn(fieldClass, 'pl-9')} value={query} onChange={e => setQuery(e.target.value)} placeholder="Rechercher : carrelage, enduit, porte…" aria-label="Rechercher un ouvrage" /></label>
    <p className="mt-2 text-xs text-ink/60" data-testid="guided-note">
      {catalog?.catalogVersion ? `Référentiel ${catalog.catalogVersion.code}. ` : ''}
      {usage !== 'free' ? 'Le référentiel ne distingue pas encore maison, appartement ou local : chaque ouvrage reste à confirmer. ' : ''}
      {!text ? (nature ? 'Ouvrages du métier de ce lot documentés pour ce type de travaux. Recherchez pour voir tout le référentiel.' : 'Ouvrages du métier de ce lot. Recherchez pour voir tout le référentiel.') : 'Recherche dans tout le référentiel publié.'}
    </p>
    {loadError && <p role="alert" className="mt-2 text-sm text-red-700">{loadError}</p>}
    {!catalog && !loadError && <p role="status" className="mt-2 text-sm text-ink/60">Chargement du référentiel…</p>}
    {catalog && <div className="mt-2 max-h-80 space-y-3 overflow-y-auto pr-1" role="group" aria-label="Ouvrages du référentiel">
      {shown === 0 && <p className="text-sm text-ink/60">{catalog.state !== 'available' ? 'Aucun référentiel publié disponible.' : text ? 'Aucun ouvrage correspondant dans le référentiel publié.' : 'Recherchez un ouvrage dans le référentiel D.A.O.'}</p>}
      {groups.map(group => <fieldset key={group.title}><legend className="text-xs font-semibold text-ink/60">{group.title}</legend>
        <ul className="mt-1">{group.works.map(w => { const count = existing.get(w.workId) ?? 0; const pro = PRO_LABEL[w.professional.status]; return <li key={w.workId}><label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg px-2 py-2 text-sm hover:bg-sand">
          <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[#0f766e]" checked={picked.includes(w.workId)} onChange={() => toggle(w.workId)} />
          <span className="min-w-0"><span className="text-ink">{w.label}</span> <span className="text-xs text-ink/55">· {sym(w.unit.code)} · {MEASURE_LABEL[w.measurement.status]}</span>
            <span className="mt-0.5 flex flex-wrap gap-1 text-[11px]">
              <span className={cn('rounded-full px-2', w.relevance.status === 'to_confirm' ? 'bg-sand text-ink/70' : 'bg-amber-50 text-amber-900')}>{w.relevance.status === 'to_confirm' ? 'pertinence à confirmer' : 'sans preuve pour ce type de travaux'}</span>
              {pro && <span className="rounded-full bg-amber-50 px-2 text-amber-900">{pro}</span>}
              {count > 0 && <span className="rounded-full bg-teal/10 px-2 text-teal">déjà {count} fois ici · ajoute une autre occurrence</span>}
            </span></span>
        </label></li>; })}</ul></fieldset>)}
    </div>}
    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <button type="button" className={primaryAction} disabled={busy || picked.length === 0}
        onClick={() => void onAdd(picked.map(workId => ({ ...base, workId })), `${picked.length} ouvrage(s) ajouté(s), sans dimension.`).then(() => setPicked([]))}>
        <Plus size={15} aria-hidden="true" />{picked.length ? `Ajouter ${picked.length} ouvrage(s)` : 'Ajouter'}</button>
    </div>
    <details className="mt-3 rounded-lg border border-black/[0.06] p-3">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-teal">L’ouvrage n’est pas dans la liste</summary>
      <form className="mt-2 flex flex-col gap-2 sm:flex-row" onSubmit={e => { e.preventDefault(); const label = custom.trim(); if (label.length >= 2) void onAdd([{ ...base, label }], `Ajouté hors référentiel : ${label}.`).then(() => setCustom('')); }}>
        <label className="min-w-0 flex-1"><span className="sr-only">Ouvrage hors référentiel</span><input className={fieldClass} maxLength={200} value={custom} onChange={e => setCustom(e.target.value)} placeholder="Ex. Pose d’une pergola bois" aria-label="Ouvrage hors référentiel" /></label>
        <button type="submit" className={secondaryAction} disabled={busy || custom.trim().length < 2}>Ajouter</button>
      </form>
      <p className="mt-1 text-xs text-ink/60">Un ouvrage hors référentiel est transmis tel quel ; D.A.O. ne le chiffre pas.</p>
    </details>
  </div>;
}
