'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Search } from 'lucide-react';
import { Badge, Button, Card, Input } from '../ui';
import { StaffHeader } from '../backoffice/PageChrome';
import TradesPanel from './TradesPanel';
import {
  abandonDraft, actionLabels, createDraft, dimensionLabels, fetchAdminCatalog, formulaText, kindLabels, normalize, projectTypeLabels, publishDraft, relationLabels, relevanceLabels,
  removeDependency, ruleTypeLabels, saveItem, severityLabels, statusLabels, validateDraft,
  type AdminCatalog, type BtpDependency, type BtpLot, type BtpRule, type BtpSubLot, type BtpVersion, type BtpWork, type ItemKind, type ProjectType, type Relevance, type Validation,
} from '../../lib/referential';

// Une seule page « Référentiel » (#547) : six onglets internes, consultation de n'importe quelle
// version, modifications uniquement dans un brouillon, publication atomique côté base.
export const REFERENTIAL_TABS = [['metiers', 'Métiers'], ['lots', 'Lots & sous-lots'], ['ouvrages', 'Ouvrages'], ['unites', 'Unités & métrés'], ['regles', 'Règles & dépendances'], ['versions', 'Versions']] as const;
export type ReferentialTab = (typeof REFERENTIAL_TABS)[number][0];
const isTab = (value: string | null): value is ReferentialTab => REFERENTIAL_TABS.some(([id]) => id === value);
const PROJECT_TYPES = Object.keys(projectTypeLabels) as ProjectType[];
const RELEVANCES = Object.keys(relevanceLabels) as Relevance[];
const select = 'mt-1 w-full rounded-control border border-black/10 bg-white p-3 text-sm';
const linkButton = 'min-h-10 rounded-xl px-3 text-sm font-semibold text-teal hover:bg-teal/5';

type Ctx = { catalog: AdminCatalog; draft: boolean; run: (action: () => Promise<unknown>, message: string) => Promise<boolean>; goto: (tab: ReferentialTab, item?: string) => void; selected: string | null; select: (id: string | null) => void };

export default function ReferentialAdmin() {
  const router = useRouter(), pathname = usePathname(), params = useSearchParams();
  const tab: ReferentialTab = isTab(params.get('tab')) ? params.get('tab') as ReferentialTab : 'metiers';
  const versionParam = params.get('version'), selected = params.get('item');
  const [catalog, setCatalog] = useState<AdminCatalog | null>(null), [error, setError] = useState(''), [denied, setDenied] = useState(false), [status, setStatus] = useState('');
  const navigate = useCallback((next: Record<string, string | null>) => {
    const query = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) value ? query.set(key, value) : query.delete(key);
    router.replace(`${pathname}?${query.toString()}`, { scroll: false });
  }, [params, pathname, router]);
  const load = useCallback(async () => {
    try { setCatalog(await fetchAdminCatalog(versionParam)); setError(''); }
    catch (e: any) { if (e.code === '42501') setDenied(true); else setError(e.message || 'Chargement impossible.'); }
  }, [versionParam]);
  useEffect(() => { void load(); }, [load]);
  const run = useCallback(async (action: () => Promise<unknown>, message: string) => {
    setError(''); setStatus('');
    try { await action(); setStatus(message); await load(); return true; } catch (e: any) { setError(e.message || 'Action refusée.'); return false; }
  }, [load]);
  const draftVersion = catalog?.versions.find(v => v.status === 'draft') ?? null;
  const viewed = catalog?.version ?? null;
  const ctx: Ctx | null = catalog && { catalog, draft: viewed?.status === 'draft', run, selected,
    goto: (next, item) => navigate({ tab: next, item: item ?? null }), select: id => navigate({ item: id }) };

  if (denied) return <section className="space-y-6"><StaffHeader group="Gouvernance" title="Référentiel BTP" crumb="Référentiel" />
    <Card className="text-sm text-black/70">Réservé à l’Admin D.A.O. Le référentiel n’est pas délégable : les autres rôles le consultent seulement à travers les parcours (assistant, création de chantier).</Card></section>;

  return <section className="space-y-5" aria-labelledby="referential-title">
    <StaffHeader group="Gouvernance" title="Référentiel BTP" crumb="Référentiel"
      description="Métiers, lots, ouvrages, unités, règles et versions du catalogue utilisé par l’assistant et la création de chantier. Une version publiée ne se modifie jamais : on prépare un brouillon, on le valide puis on le publie." />
    {catalog && <VersionBar catalog={catalog} viewed={viewed} draft={draftVersion} onView={id => navigate({ version: id, item: null })} onTab={() => navigate({ tab: 'versions', item: null })} />}
    <nav aria-label="Rubriques du référentiel" role="tablist" className="flex gap-2 overflow-x-auto border-b border-black/5">
      {REFERENTIAL_TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => navigate({ tab: id, item: null })}
        className={['-mb-px inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 text-sm font-semibold transition', tab === id ? 'border-teal text-teal' : 'border-transparent text-black/55 hover:text-ink'].join(' ')}>{label}</button>)}
    </nav>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    <p role="status" aria-live="polite" className={status ? 'rounded-xl bg-teal/10 p-3 text-sm text-teal' : 'sr-only'}>{status}</p>
    {!ctx ? !error && <div aria-busy="true" className="space-y-2"><p role="status" className="sr-only">Chargement…</p>{[0, 1, 2].map(k => <div key={k} className="h-16 animate-pulse rounded-2xl bg-black/5" />)}</div>
      : !viewed ? <Card className="text-sm text-black/60">Aucune version publiée pour ce pays.</Card> : <div role="tabpanel" aria-label={REFERENTIAL_TABS.find(([id]) => id === tab)?.[1]}>
        {tab === 'metiers' && <TradesTab ctx={ctx} onStatus={async m => { setStatus(m); await load(); }} onError={setError} />}
        {tab === 'lots' && <LotsTab ctx={ctx} />}
        {tab === 'ouvrages' && <WorksTab ctx={ctx} />}
        {tab === 'unites' && <UnitsTab ctx={ctx} />}
        {tab === 'regles' && <RulesTab ctx={ctx} />}
        {tab === 'versions' && <VersionsTab ctx={ctx} onView={id => navigate({ version: id, item: null })} />}
      </div>}
  </section>;
}

function VersionBar({ catalog, viewed, draft, onView, onTab }: { catalog: AdminCatalog; viewed: BtpVersion | null; draft: BtpVersion | null; onView: (id: string | null) => void; onTab: () => void }) {
  const published = catalog.versions.find(v => v.status === 'published');
  return <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
    <div className="min-w-0 space-y-1">
      <p className="text-sm"><span className="text-black/55">Version consultée : </span><strong>{viewed?.code ?? '—'}</strong> {viewed && <VersionBadge status={viewed.status} />}</p>
      <p className="text-xs text-black/50">{viewed?.status === 'draft' ? 'Brouillon : les modifications sont enregistrées avec un motif, puis publiées en une fois.'
        : viewed?.status === 'published' ? `En vigueur depuis le ${date(viewed.effectiveFrom)} · lecture seule.` : viewed ? `Archivée${viewed.effectiveTo ? ` le ${date(viewed.effectiveTo)}` : ''} · lecture seule.` : ''}
        {viewed && <> · Provenance : {String(viewed.provenance?.label ?? '—')}</>}</p>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-xs font-semibold text-black/60"><span className="sr-only">Changer de version</span>
        <select aria-label="Version du référentiel" className="rounded-control border border-black/10 bg-white p-2.5 text-sm" value={viewed?.id ?? ''} onChange={e => onView(e.target.value === published?.id ? null : e.target.value)}>
          {catalog.versions.map(v => <option key={v.id} value={v.id}>{v.code} · {statusLabels[v.status]}</option>)}</select></label>
      {draft && viewed?.id !== draft.id && <Button type="button" onClick={() => onView(draft.id)}>Ouvrir le brouillon {draft.code}</Button>}
      {!draft && <Button type="button" className="bg-white text-teal ring-1 ring-inset ring-teal/30 hover:bg-teal/5" onClick={onTab}>Préparer une nouvelle version</Button>}
    </div>
  </Card>;
}

const date = (value: string | null) => value ? new Date(value.length === 10 ? `${value}T00:00:00` : value).toLocaleDateString('fr-FR') : '—';
const dateTime = (value: string) => new Date(value).toLocaleString('fr-FR', { hourCycle: 'h23' });
function VersionBadge({ status }: { status: BtpVersion['status'] }) { return <Badge tone={status === 'published' ? 'success' : status === 'draft' ? 'waiting' : 'neutral'}>{statusLabels[status]}</Badge>; }
function ActiveBadge({ active }: { active: boolean }) { return active ? null : <Badge tone="neutral">Inactif</Badge>; }
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="grid gap-1 border-t border-black/5 py-2 text-sm sm:grid-cols-[11rem_minmax(0,1fr)]"><dt className="font-semibold text-black/55">{label}</dt><dd className="min-w-0 break-words">{children}</dd></div>;
}
function SearchBox({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return <label className="relative block min-w-[12rem] flex-1"><span className="sr-only">{label}</span><Search aria-hidden="true" size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-black/35" />
    <Input className="pl-10" placeholder={`${label}…`} value={value} onChange={e => onChange(e.target.value)} /></label>;
}
function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<[string, string]> }) {
  return <label className="text-xs font-semibold text-black/60">{label}<select aria-label={label} className="mt-1 block w-full rounded-control border border-black/10 bg-white p-2.5 text-sm sm:w-auto" value={value} onChange={e => onChange(e.target.value)}>
    {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>;
}
const stateOptions: Array<[string, string]> = [['active', 'Actifs'], ['inactive', 'Inactifs'], ['all', 'Tous']];
const matchState = (state: string, active: boolean) => state === 'all' || (state === 'active') === active;
const typeOptions: Array<[string, string]> = [['', 'Tous les types'], ...PROJECT_TYPES.map(t => [t, projectTypeLabels[t]] as [string, string])];

/** Liste à gauche, fiche à droite ; sur mobile la fiche remplace la liste avec un retour. */
function ListDetail({ list, detail, selected, onBack }: { list: React.ReactNode; detail: React.ReactNode; selected: boolean; onBack: () => void }) {
  return <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
    <div className={selected ? 'hidden lg:block' : ''}>{list}</div>
    <div className={selected ? '' : 'hidden lg:block'}>
      {selected && <button type="button" className={`${linkButton} mb-2 inline-flex items-center gap-1 lg:hidden`} onClick={onBack}><ArrowLeft size={16} aria-hidden="true" />Retour à la liste</button>}
      {detail}
    </div>
  </div>;
}
function Provenance({ catalog, sourceRef }: { catalog: AdminCatalog; sourceRef: string }) {
  return <Row label="Provenance">{sourceRef}<span className="block text-xs text-black/50">{String(catalog.version?.provenance?.label ?? '')} · version {catalog.version?.code}</span></Row>;
}

// ---- Formulaire générique d'un brouillon : seuls les champs modifiés partent, avec un motif.
type FieldDef = { key: string; label: string; type: 'text' | 'textarea' | 'select' | 'types' | 'list' | 'bool' | 'code'; options?: Array<[string, string]>; prefix?: string; required?: boolean };
type Values = Record<string, any>;
function DraftForm({ title, fields, initial, submit, onDone, submitLabel = 'Enregistrer dans le brouillon' }: { title: string; fields: FieldDef[]; initial: Values; submit: (changes: Values, reason: string) => Promise<boolean>; onDone?: () => void; submitLabel?: string }) {
  const [values, setValues] = useState<Values>(initial), [reason, setReason] = useState('');
  const resetKey = JSON.stringify(initial);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setValues(initial); setReason(''); }, [resetKey]);
  const changes = Object.fromEntries(fields.filter(f => JSON.stringify(values[f.key]) !== JSON.stringify(initial[f.key])).map(f => [f.key, values[f.key]]));
  const missing = fields.some(f => f.required && (values[f.key] === undefined || values[f.key] === '' || (Array.isArray(values[f.key]) && !values[f.key].length)));
  const set = (key: string, value: unknown) => setValues(v => ({ ...v, [key]: value }));
  return <form className="space-y-3 rounded-xl bg-sand/60 p-4" onSubmit={async e => { e.preventDefault(); if (await submit(changes, reason)) { setReason(''); onDone?.(); } }}>
    <h3 className="text-sm font-bold">{title}</h3>
    {fields.map(f => <div key={f.key}>{f.type === 'bool' ? <label className="flex min-h-10 items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={!!values[f.key]} onChange={e => set(f.key, e.target.checked)} />{f.label}</label>
      : f.type === 'types' ? <fieldset><legend className="text-xs font-semibold">{f.label}</legend><div className="mt-1 flex flex-wrap gap-2">{PROJECT_TYPES.map(t => <label key={t} className="flex min-h-10 items-center gap-1.5 rounded-xl bg-white px-3 text-sm">
          <input type="checkbox" checked={(values[f.key] ?? []).includes(t)} onChange={e => set(f.key, e.target.checked ? [...(values[f.key] ?? []), t] : (values[f.key] ?? []).filter((x: string) => x !== t))} />{projectTypeLabels[t]}</label>)}</div></fieldset>
      : <label className="block text-xs font-semibold">{f.label}{f.type === 'select' ? <select aria-label={f.label} className={select} value={values[f.key] ?? ''} onChange={e => set(f.key, e.target.value)}>
          {!f.required && <option value="">—</option>}{f.options?.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        : f.type === 'textarea' ? <textarea aria-label={f.label} className={`${select} min-h-20`} value={values[f.key] ?? ''} onChange={e => set(f.key, e.target.value)} />
        : f.type === 'list' ? <Input aria-label={f.label} className="mt-1" placeholder="Séparés par des virgules" value={(values[f.key] ?? []).join(', ')} onChange={e => set(f.key, e.target.value.split(',').map(x => x.trimStart()).filter((x, i, all) => x || i === all.length - 1))} />
        : <span className="mt-1 flex items-center gap-1">{f.prefix && <code className="text-xs text-black/50">{f.prefix}</code>}<Input aria-label={f.label} value={values[f.key] ?? ''} onChange={e => set(f.key, f.type === 'code' ? e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') : e.target.value)} /></span>}</label>}</div>)}
    <Input aria-label="Motif" placeholder="Motif (5 caractères minimum)" value={reason} onChange={e => setReason(e.target.value)} />
    <Button type="submit" disabled={reason.trim().length < 5 || !Object.keys(changes).length || missing}>{submitLabel}</Button>
  </form>;
}
const cleanList = (value: unknown) => Array.isArray(value) ? value.map(x => String(x).trim()).filter(Boolean) : value;
const toItem = (changes: Values) => Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, k === 'aliases' ? cleanList(v) : v]));
function save(ctx: Ctx, kind: ItemKind, id: string | null, changes: Values, reason: string, extra: Values = {}) {
  const item = { ...(id ? { id } : {}), ...extra, ...toItem(changes) };
  return ctx.run(() => saveItem(ctx.catalog.version!.id, kind, item, reason), `${kindLabels[kind]} ${id ? 'modifié' : 'ajouté'} dans le brouillon ${ctx.catalog.version!.code}.`);
}
const commonFields = (labelMax = 120): FieldDef[] => [
  { key: 'label', label: `Libellé (2 à ${labelMax} caractères)`, type: 'text', required: true },
  { key: 'description', label: 'Description', type: 'textarea' },
  { key: 'relevance', label: 'Pertinence par défaut', type: 'select', options: RELEVANCES.map(r => [r, relevanceLabels[r]]), required: true },
  { key: 'projectTypes', label: 'Types de chantier concernés', type: 'types', required: true },
  { key: 'sourceRef', label: 'Source (référence vérifiable)', type: 'text', required: true },
];
const editable = <T extends { label: string; description: string; relevance: Relevance; projectTypes: ProjectType[]; sourceRef: string; active: boolean }>(x: T): Values =>
  ({ label: x.label, description: x.description, relevance: x.relevance, projectTypes: x.projectTypes, sourceRef: x.sourceRef, active: x.active });

// ---- 1. Métiers
function TradesTab({ ctx, onStatus, onError }: { ctx: Ctx; onStatus: (m: string) => Promise<void>; onError: (m: string) => void }) {
  const lotsByTrade = useMemo(() => {
    const map = new Map<string, BtpLot[]>(); for (const lot of ctx.catalog.lots) map.set(lot.tradeId, [...(map.get(lot.tradeId) ?? []), lot]); return map;
  }, [ctx.catalog.lots]);
  const used = ctx.catalog.trades.filter(t => lotsByTrade.has(t.id));
  return <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
    <Card className="space-y-2"><h2 className="font-bold">Métiers</h2>
      <p className="text-sm text-black/60">Un métier inactif n’est plus proposé pour les nouveaux lots ; les lots existants restent intacts. Renommer conserve le métier et tous ses liens. Les métiers sont communs à toutes les versions du référentiel.</p>
      <TradesPanel trades={ctx.catalog.trades} onChanged={onStatus} onError={onError} /></Card>
    <Card className="space-y-2 self-start"><h2 className="font-bold">Utilisés par {ctx.catalog.version?.code}</h2>
      {!used.length ? <p className="text-sm text-black/60">Aucun lot rattaché.</p> : <ul className="divide-y divide-black/5">{used.map(t => <li key={t.id} className="py-2 text-sm">
        <p className="font-semibold">{t.name} {!t.active && <Badge tone="red">Inactif</Badge>}</p>
        <p className="text-xs text-black/55">{lotsByTrade.get(t.id)!.map((lot, i) => <span key={lot.id}>{i > 0 && ' · '}<button type="button" className="font-semibold text-teal hover:underline" onClick={() => ctx.goto('lots', lot.id)}>{lot.label}</button></span>)}</p></li>)}</ul>}</Card>
  </div>;
}

// ---- 2. Lots & sous-lots
function LotsTab({ ctx }: { ctx: Ctx }) {
  const { catalog } = ctx;
  const [query, setQuery] = useState(''), [type, setType] = useState(''), [state, setState] = useState('active'), [adding, setAdding] = useState(false);
  const q = normalize(query.trim());
  const subLotsOf = (lotId: string) => catalog.subLots.filter(s => s.lotId === lotId);
  const visible = (x: { label: string; code: string; projectTypes: ProjectType[]; active: boolean }) => (!q || normalize(x.label).includes(q) || x.code.includes(q)) && (!type || x.projectTypes.includes(type as ProjectType)) && matchState(state, x.active);
  const lots = catalog.lots.filter(lot => visible(lot) || subLotsOf(lot.id).some(visible));
  const lot = catalog.lots.find(l => l.id === ctx.selected), subLot = catalog.subLots.find(s => s.id === ctx.selected);
  const trade = (id: string) => catalog.trades.find(t => t.id === id);
  const list = <Card className="space-y-3 p-4">
    <div className="flex flex-wrap items-end gap-2"><SearchBox label="Rechercher un lot ou sous-lot" value={query} onChange={setQuery} /><Filter label="Type de chantier" value={type} onChange={setType} options={typeOptions} /><Filter label="État" value={state} onChange={setState} options={stateOptions} /></div>
    {ctx.draft && <button type="button" className={linkButton} onClick={() => { setAdding(!adding); ctx.select(null); }}>{adding ? 'Fermer' : '+ Ajouter un lot'}</button>}
    {!lots.length ? <p className="text-sm text-black/60">Aucun lot ne correspond.</p> : <ul className="space-y-2" aria-label="Lots">{lots.map(l => <li key={l.id} className="rounded-xl border border-black/5">
      <button type="button" aria-current={ctx.selected === l.id ? 'true' : undefined} onClick={() => { setAdding(false); ctx.select(l.id); }} className={`flex w-full min-h-11 items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm ${ctx.selected === l.id ? 'bg-teal/10 text-teal' : 'hover:bg-sand'}`}>
        <span className="min-w-0"><span className="font-semibold">{l.label}</span> <ActiveBadge active={l.active} /><span className="block truncate text-xs text-black/50">{trade(l.tradeId)?.name} · {subLotsOf(l.id).length} sous-lot(s)</span></span></button>
      <ul className="pb-1 pl-4">{subLotsOf(l.id).filter(s => matchState(state, s.active) || !q).filter(s => !q || visible(s) || visible(l)).map(s => <li key={s.id}>
        <button type="button" aria-current={ctx.selected === s.id ? 'true' : undefined} onClick={() => { setAdding(false); ctx.select(s.id); }} className={`flex w-full min-h-10 items-center gap-2 rounded-lg px-3 text-left text-sm ${ctx.selected === s.id ? 'bg-teal/10 text-teal' : 'text-black/70 hover:bg-sand'}`}>
          <span aria-hidden="true">↳</span><span className="min-w-0 truncate">{s.label}</span> <ActiveBadge active={s.active} /></button></li>)}</ul></li>)}</ul>}
  </Card>;
  const detail = adding && ctx.draft ? <DraftForm title="Nouveau lot" initial={{ relevance: 'conditional', projectTypes: [], active: true }} onDone={() => setAdding(false)}
      fields={[{ key: 'code', label: 'Code canonique (définitif)', type: 'code', prefix: 'btp_lot_', required: true }, { key: 'tradeId', label: 'Métier', type: 'select', required: true, options: catalog.trades.filter(t => t.active).map(t => [t.id, t.name]) }, ...commonFields()]}
      submit={(c, reason) => save(ctx, 'lot', null, { ...c, code: `btp_lot_${c.code ?? ''}` }, reason)} submitLabel="Ajouter au brouillon" />
    : lot ? <LotDetail ctx={ctx} lot={lot} /> : subLot ? <SubLotDetail ctx={ctx} subLot={subLot} /> : <Card className="text-sm text-black/60">Choisissez un lot ou un sous-lot pour voir sa fiche.</Card>;
  return <ListDetail list={list} detail={detail} selected={!!(lot || subLot || adding)} onBack={() => { setAdding(false); ctx.select(null); }} />;
}

function RulesFor({ ctx, codes }: { ctx: Ctx; codes: string[] }) {
  const rules = ctx.catalog.rules.filter(r => r.subjects.some(s => codes.includes(s)));
  if (!rules.length) return <Row label="Règles">Aucune</Row>;
  return <Row label="Règles"><ul className="space-y-1">{rules.map(r => <li key={r.id}><button type="button" className="text-left font-semibold text-teal hover:underline" onClick={() => ctx.goto('regles', r.id)}>{r.explanation}</button> <Badge tone={r.severity === 'blocking' ? 'red' : r.severity === 'warning' ? 'waiting' : 'neutral'}>{severityLabels[r.severity]}</Badge></li>)}</ul></Row>;
}
function Common({ item }: { item: { code: string; description: string; relevance: Relevance; projectTypes: ProjectType[]; active: boolean } }) {
  return <><Row label="Code canonique"><code className="text-xs">{item.code}</code></Row>
    {item.description && <Row label="Description">{item.description}</Row>}
    <Row label="Pertinence">{relevanceLabels[item.relevance]}</Row>
    <Row label="Types de chantier">{item.projectTypes.map(t => projectTypeLabels[t]).join(', ')}</Row>
    <Row label="État">{item.active ? 'Actif' : 'Inactif (absent du catalogue publié)'}</Row></>;
}
function LotDetail({ ctx, lot }: { ctx: Ctx; lot: BtpLot }) {
  const { catalog } = ctx; const subLots = catalog.subLots.filter(s => s.lotId === lot.id);
  const workCodes = catalog.works.filter(w => subLots.some(s => s.id === w.subLotId)).map(w => w.code);
  const [adding, setAdding] = useState(false);
  return <Card className="space-y-3"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-teal">Lot</p><h2 className="text-xl font-bold">{lot.label}</h2></div>
    <dl><Common item={lot} /><Row label="Métier">{catalog.trades.find(t => t.id === lot.tradeId)?.name ?? '—'}</Row>
      <Row label="Sous-lots">{!subLots.length ? 'Aucun' : <ul>{subLots.map(s => <li key={s.id}><button type="button" className="font-semibold text-teal hover:underline" onClick={() => ctx.select(s.id)}>{s.label}</button> <ActiveBadge active={s.active} /></li>)}</ul>}</Row>
      <RulesFor ctx={ctx} codes={[lot.code, ...subLots.map(s => s.code), ...workCodes]} /><Provenance catalog={catalog} sourceRef={lot.sourceRef} /></dl>
    {ctx.draft && <>
      <DraftForm title="Modifier le lot" initial={{ ...editable(lot), tradeId: lot.tradeId }} fields={[{ key: 'tradeId', label: 'Métier', type: 'select', required: true, options: catalog.trades.filter(t => t.active || t.id === lot.tradeId).map(t => [t.id, t.name]) }, ...commonFields(), { key: 'active', label: 'Actif', type: 'bool' }]}
        submit={(c, reason) => save(ctx, 'lot', lot.id, c, reason)} />
      <button type="button" className={linkButton} onClick={() => setAdding(!adding)}>{adding ? 'Fermer' : '+ Ajouter un sous-lot'}</button>
      {adding && <DraftForm title="Nouveau sous-lot" initial={{ relevance: 'conditional', projectTypes: lot.projectTypes }} onDone={() => setAdding(false)} submitLabel="Ajouter au brouillon"
        fields={[{ key: 'code', label: 'Code canonique (définitif)', type: 'code', prefix: 'btp_sub_', required: true }, ...commonFields()]}
        submit={(c, reason) => save(ctx, 'sub_lot', null, { ...c, code: `btp_sub_${c.code ?? ''}`, projectTypes: c.projectTypes ?? lot.projectTypes }, reason, { lotId: lot.id })} />}
    </>}
  </Card>;
}
function SubLotDetail({ ctx, subLot }: { ctx: Ctx; subLot: BtpSubLot }) {
  const { catalog } = ctx; const lot = catalog.lots.find(l => l.id === subLot.lotId); const works = catalog.works.filter(w => w.subLotId === subLot.id);
  const [adding, setAdding] = useState(false);
  return <Card className="space-y-3"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-teal">Sous-lot</p><h2 className="text-xl font-bold">{subLot.label}</h2></div>
    <dl><Common item={subLot} /><Row label="Lot parent">{lot && <button type="button" className="font-semibold text-teal hover:underline" onClick={() => ctx.select(lot.id)}>{lot.label}</button>}</Row>
      <Row label="Ouvrages">{!works.length ? 'Aucun' : <ul>{works.map(w => <li key={w.id}><button type="button" className="font-semibold text-teal hover:underline" onClick={() => ctx.goto('ouvrages', w.id)}>{w.label}</button> <span className="text-xs text-black/50">({w.unitCode})</span> <ActiveBadge active={w.active} /></li>)}</ul>}</Row>
      <RulesFor ctx={ctx} codes={[subLot.code, ...works.map(w => w.code)]} /><Provenance catalog={catalog} sourceRef={subLot.sourceRef} /></dl>
    {ctx.draft && <>
      <DraftForm title="Modifier le sous-lot" initial={editable(subLot)} fields={[...commonFields(), { key: 'active', label: 'Actif', type: 'bool' }]} submit={(c, reason) => save(ctx, 'sub_lot', subLot.id, c, reason)} />
      <button type="button" className={linkButton} onClick={() => setAdding(!adding)}>{adding ? 'Fermer' : '+ Ajouter un ouvrage'}</button>
      {adding && <DraftForm title="Nouvel ouvrage" initial={{ relevance: 'conditional', projectTypes: subLot.projectTypes, aliases: [] }} onDone={() => setAdding(false)} submitLabel="Ajouter au brouillon"
        fields={[{ key: 'code', label: 'Code canonique (définitif)', type: 'code', prefix: 'btp_work_', required: true }, ...workFields(ctx).filter(f => f.key !== 'active')]}
        submit={(c, reason) => save(ctx, 'work', null, { ...c, code: `btp_work_${c.code ?? ''}`, projectTypes: c.projectTypes ?? subLot.projectTypes }, reason, { subLotId: subLot.id })} />}
    </>}
  </Card>;
}

// ---- 3. Ouvrages
const workFields = (ctx: Ctx): FieldDef[] => [...commonFields(160).slice(0, 2), { key: 'unitCode', label: 'Unité', type: 'select', required: true, options: ctx.catalog.units.filter(u => u.active).map(u => [u.code, `${u.label} (${u.symbol})`]) },
  ...commonFields(160).slice(2), { key: 'aliases', label: 'Synonymes (mots-clés de l’assistant)', type: 'list' }, { key: 'measurementNote', label: 'Note de métré', type: 'textarea' }, { key: 'active', label: 'Actif', type: 'bool' }];
function WorksTab({ ctx }: { ctx: Ctx }) {
  const { catalog } = ctx;
  const [query, setQuery] = useState(''), [lot, setLot] = useState(''), [unit, setUnit] = useState(''), [type, setType] = useState(''), [state, setState] = useState('active');
  const q = normalize(query.trim());
  const parent = (w: BtpWork) => { const s = catalog.subLots.find(x => x.id === w.subLotId); return { subLot: s, lot: catalog.lots.find(l => l.id === s?.lotId) }; };
  const works = catalog.works.filter(w => (!q || normalize(w.label).includes(q) || w.code.includes(q) || w.aliases.some(a => normalize(a).includes(q)))
    && (!lot || parent(w).lot?.id === lot) && (!unit || w.unitCode === unit) && (!type || w.projectTypes.includes(type as ProjectType)) && matchState(state, w.active));
  const work = catalog.works.find(w => w.id === ctx.selected);
  const list = <Card className="space-y-3 p-4">
    <SearchBox label="Rechercher un ouvrage ou un synonyme" value={query} onChange={setQuery} />
    <div className="flex flex-wrap gap-2"><Filter label="Lot" value={lot} onChange={setLot} options={[['', 'Tous les lots'], ...catalog.lots.map(l => [l.id, l.label] as [string, string])]} />
      <Filter label="Unité" value={unit} onChange={setUnit} options={[['', 'Toutes'], ...catalog.units.map(u => [u.code, u.symbol] as [string, string])]} />
      <Filter label="Type de chantier" value={type} onChange={setType} options={typeOptions} /><Filter label="État" value={state} onChange={setState} options={stateOptions} /></div>
    <p className="text-xs text-black/50">{works.length} ouvrage(s){ctx.draft && ' · pour ajouter un ouvrage, ouvrez son sous-lot dans « Lots & sous-lots ».'}</p>
    {!works.length ? <p className="text-sm text-black/60">Aucun ouvrage ne correspond.</p> : <ul className="divide-y divide-black/5" aria-label="Ouvrages">{works.map(w => <li key={w.id}>
      <button type="button" aria-current={ctx.selected === w.id ? 'true' : undefined} onClick={() => ctx.select(w.id)} className={`w-full min-h-11 rounded-xl px-3 py-2 text-left text-sm ${ctx.selected === w.id ? 'bg-teal/10 text-teal' : 'hover:bg-sand'}`}>
        <span className="font-semibold">{w.label}</span> <ActiveBadge active={w.active} /><span className="block truncate text-xs text-black/50">{parent(w).lot?.label} › {parent(w).subLot?.label} · {w.unitCode}</span></button></li>)}</ul>}
  </Card>;
  return <ListDetail list={list} selected={!!work} onBack={() => ctx.select(null)} detail={work ? <WorkDetail ctx={ctx} work={work} parent={parent(work)} /> : <Card className="text-sm text-black/60">Choisissez un ouvrage pour voir sa fiche.</Card>} />;
}
function WorkDetail({ ctx, work, parent }: { ctx: Ctx; work: BtpWork; parent: { subLot?: BtpSubLot; lot?: BtpLot } }) {
  const { catalog } = ctx; const unit = catalog.units.find(u => u.code === work.unitCode);
  const template = catalog.measurementTemplates.find(m => m.workId === work.id);
  const label = (id: string) => catalog.works.find(w => w.id === id)?.label ?? id;
  const before = catalog.dependencies.filter(d => d.successorWorkId === work.id), after = catalog.dependencies.filter(d => d.predecessorWorkId === work.id);
  const dep = (d: BtpDependency, other: string) => <li key={d.id}><button type="button" className="font-semibold text-teal hover:underline" onClick={() => ctx.select(other)}>{label(other)}</button> <span className="text-xs text-black/55">· {relationLabels[d.relationType]}{d.mandatory ? ' · obligatoire' : ''}</span></li>;
  return <Card className="space-y-3"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-teal">Ouvrage</p><h2 className="text-xl font-bold">{work.label}</h2>
    <p className="text-sm text-black/55">{parent.lot && <button type="button" className="hover:underline" onClick={() => ctx.goto('lots', parent.lot!.id)}>{parent.lot.label}</button>} › {parent.subLot && <button type="button" className="hover:underline" onClick={() => ctx.goto('lots', parent.subLot!.id)}>{parent.subLot.label}</button>}</p></div>
    <dl><Common item={work} /><Row label="Unité">{unit ? `${unit.label} (${unit.symbol})` : work.unitCode} <span className="text-xs text-black/50">— aucune quantité ni prix n’est associé</span></Row>
      <Row label="Synonymes">{work.aliases.length ? work.aliases.join(', ') : '—'}</Row>
      <Row label="Données à saisir">{work.requiredInputs.length ? work.requiredInputs.join(', ') : '—'}</Row>
      {work.measurementNote && <Row label="Note de métré">{work.measurementNote}</Row>}
      <Row label="Modèle de métré">{template ? <><span>{formulaText(template.formulaAst)} → {template.outputUnitCode}</span> <ActiveBadge active={template.active} /><span className="block text-xs text-black/50">Saisies : {(template.inputSchema.required ?? []).join(', ')} · {template.assumptions.join(' ')}</span></> : 'Aucun'}</Row>
      <Row label="Dépend de">{before.length ? <ul>{before.map(d => dep(d, d.predecessorWorkId))}</ul> : 'Aucun ouvrage'}</Row>
      <Row label="Précède">{after.length ? <ul>{after.map(d => dep(d, d.successorWorkId))}</ul> : 'Aucun ouvrage'}</Row>
      <RulesFor ctx={ctx} codes={[work.code]} /><Provenance catalog={catalog} sourceRef={work.sourceRef} /></dl>
    {ctx.draft && <DraftForm title="Modifier l’ouvrage" initial={{ ...editable(work), unitCode: work.unitCode, aliases: work.aliases, measurementNote: work.measurementNote }}
      fields={workFields(ctx)} submit={(c, reason) => save(ctx, 'work', work.id, c, reason)} />}
  </Card>;
}

// ---- 4. Unités & métrés
function UnitsTab({ ctx }: { ctx: Ctx }) {
  const { catalog } = ctx; const work = (id: string) => catalog.works.find(w => w.id === id);
  return <div className="space-y-4">
    <Card className="p-0"><h2 className="border-b border-black/5 px-5 py-3 font-bold">Unités ({catalog.units.length})</h2>
      <p className="px-5 pt-3 text-sm text-black/60">Les unités sont communes à toutes les versions ; elles ne portent ni quantité ni prix. Leur modification n’est pas proposée ici.</p>
      <div className="overflow-x-auto p-5 pt-3"><table className="w-full min-w-[34rem] text-left text-sm"><thead><tr className="text-xs text-black/50"><th className="py-2">Unité</th><th>Symbole</th><th>Dimension</th><th>Décimales</th><th>Ouvrages</th><th>Métrés</th></tr></thead>
        <tbody>{catalog.units.map(u => <tr key={u.code} className="border-t border-black/5"><td className="py-2 font-semibold">{u.label} <code className="text-xs text-black/45">{u.code}</code> <ActiveBadge active={u.active} /></td><td>{u.symbol}</td><td>{dimensionLabels[u.dimension] ?? u.dimension}</td><td>{u.decimalScale}</td>
          <td>{u.workCount}</td><td>{u.templateCount}</td></tr>)}</tbody></table></div></Card>
    <Card className="space-y-3"><h2 className="font-bold">Modèles de métrés ({catalog.measurementTemplates.length})</h2>
      <p className="text-sm text-black/60">Rattachés à un ouvrage. Formules déterministes : toutes les dimensions sont saisies ou confirmées, aucune valeur par défaut ni ratio.</p>
      <ul className="divide-y divide-black/5">{catalog.measurementTemplates.map(m => { const w = work(m.workId); return <li key={m.id} className="space-y-2 py-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2"><button type="button" className="text-left font-semibold text-teal hover:underline" onClick={() => ctx.goto('ouvrages', m.workId)}>{w?.label ?? m.workId}</button><ActiveBadge active={m.active} /></div>
        <p><code className="text-xs">{formulaText(m.formulaAst)}</code> → {m.outputUnitCode} · arrondi {m.roundingScale} décimale(s)</p>
        <p className="text-xs text-black/55">Saisies : {(m.inputSchema.required ?? []).join(', ')} · {m.assumptions.join(' ')} · Source : {m.sourceRef}</p>
        {ctx.draft && <DraftForm title={m.active ? 'Désactiver ce modèle' : 'Réactiver ce modèle'} initial={{ active: m.active }} fields={[{ key: 'active', label: 'Actif', type: 'bool' }]} submit={(c, reason) => save(ctx, 'measurement', m.id, c, reason)} />}
      </li>; })}</ul></Card>
  </div>;
}

// ---- 5. Règles & dépendances
function RulesTab({ ctx }: { ctx: Ctx }) {
  const { catalog } = ctx;
  const [kind, setKind] = useState(''), [severity, setSeverity] = useState(''), [adding, setAdding] = useState(false);
  const nameOf = (code: string) => catalog.works.find(w => w.code === code) ?? catalog.subLots.find(s => s.code === code) ?? catalog.lots.find(l => l.code === code);
  const rules = catalog.rules.filter(r => (!kind || r.type === kind) && (!severity || r.severity === severity));
  const rule = catalog.rules.find(r => r.id === ctx.selected), dep = catalog.dependencies.find(d => d.id === ctx.selected);
  const work = (id: string) => catalog.works.find(w => w.id === id);
  const list = <div className="space-y-4">
    <Card className="space-y-3 p-4"><h2 className="font-bold">Règles ({catalog.rules.length})</h2>
      <div className="flex flex-wrap gap-2"><Filter label="Type" value={kind} onChange={setKind} options={[['', 'Tous'], ...Object.entries(ruleTypeLabels)]} /><Filter label="Sévérité" value={severity} onChange={setSeverity} options={[['', 'Toutes'], ...Object.entries(severityLabels)]} /></div>
      <ul className="divide-y divide-black/5" aria-label="Règles">{rules.map(r => <li key={r.id}><button type="button" aria-current={ctx.selected === r.id ? 'true' : undefined} onClick={() => { setAdding(false); ctx.select(r.id); }} className={`w-full min-h-11 rounded-xl px-3 py-2 text-left text-sm ${ctx.selected === r.id ? 'bg-teal/10 text-teal' : 'hover:bg-sand'}`}>
        <span className="font-semibold">{r.explanation}</span> <ActiveBadge active={r.active} /><span className="block text-xs text-black/50">{ruleTypeLabels[r.type] ?? r.type} · {severityLabels[r.severity]}</span></button></li>)}</ul></Card>
    <Card className="space-y-3 p-4"><h2 className="font-bold">Dépendances ({catalog.dependencies.length})</h2>
      {ctx.draft && <button type="button" className={linkButton} onClick={() => { setAdding(!adding); ctx.select(null); }}>{adding ? 'Fermer' : '+ Ajouter une dépendance'}</button>}
      <ul className="divide-y divide-black/5" aria-label="Dépendances">{catalog.dependencies.map(d => <li key={d.id}><button type="button" aria-current={ctx.selected === d.id ? 'true' : undefined} onClick={() => { setAdding(false); ctx.select(d.id); }} className={`w-full min-h-11 rounded-xl px-3 py-2 text-left text-sm ${ctx.selected === d.id ? 'bg-teal/10 text-teal' : 'hover:bg-sand'}`}>
        <span className="font-semibold">{work(d.predecessorWorkId)?.label} → {work(d.successorWorkId)?.label}</span><span className="block text-xs text-black/50">{relationLabels[d.relationType]}{d.mandatory ? ' · obligatoire' : ''}</span></button></li>)}</ul></Card>
  </div>;
  const workOptions = catalog.works.filter(w => w.active).map(w => [w.id, w.label] as [string, string]);
  const detail = adding && ctx.draft ? <DraftForm title="Nouvelle dépendance" initial={{ relationType: 'finish_to_start', mandatory: false }} onDone={() => setAdding(false)} submitLabel="Ajouter au brouillon"
      fields={[{ key: 'predecessorWorkId', label: 'Ouvrage précédent', type: 'select', required: true, options: workOptions }, { key: 'successorWorkId', label: 'Ouvrage suivant', type: 'select', required: true, options: workOptions },
        { key: 'relationType', label: 'Nature', type: 'select', required: true, options: Object.entries(relationLabels) }, { key: 'mandatory', label: 'Obligatoire', type: 'bool' },
        { key: 'explanation', label: 'Explication (sans durée ni date)', type: 'textarea', required: true }, { key: 'sourceRef', label: 'Source', type: 'text', required: true }]}
      submit={(c, reason) => save(ctx, 'dependency', null, { relationType: 'finish_to_start', ...c }, reason)} />
    : rule ? <RuleDetail ctx={ctx} rule={rule} nameOf={nameOf} /> : dep ? <DependencyDetail ctx={ctx} dep={dep} /> : <Card className="text-sm text-black/60">Choisissez une règle ou une dépendance pour voir sa fiche.</Card>;
  return <ListDetail list={list} detail={detail} selected={!!(rule || dep || adding)} onBack={() => { setAdding(false); ctx.select(null); }} />;
}
function RuleDetail({ ctx, rule, nameOf }: { ctx: Ctx; rule: BtpRule; nameOf: (code: string) => { id: string; label: string } | undefined }) {
  return <Card className="space-y-3"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-teal">Règle</p><h2 className="text-xl font-bold">{rule.explanation}</h2></div>
    <dl><Row label="Code"><code className="text-xs">{rule.code}</code></Row><Row label="Type">{ruleTypeLabels[rule.type] ?? rule.type}</Row><Row label="Sévérité">{severityLabels[rule.severity]}</Row>
      <Row label="Concerne"><ul>{rule.subjects.map(code => { const target = nameOf(code); return <li key={code}>{target ? <button type="button" className="font-semibold text-teal hover:underline"
        onClick={() => ctx.goto(ctx.catalog.works.some(w => w.id === target.id) ? 'ouvrages' : 'lots', target.id)}>{target.label}</button> : <code className="text-xs">{code}</code>}</li>; })}</ul></Row>
      <Row label="Condition"><pre className="whitespace-pre-wrap rounded-lg bg-sand p-2 text-xs">{JSON.stringify(rule.condition, null, 2)}</pre></Row>
      <Row label="Effet"><pre className="whitespace-pre-wrap rounded-lg bg-sand p-2 text-xs">{JSON.stringify(rule.effect, null, 2)}</pre></Row>
      <Row label="État">{rule.active ? 'Active' : 'Inactive'}</Row><Provenance catalog={ctx.catalog} sourceRef={rule.sourceRef} /></dl>
    {ctx.draft && <DraftForm title="Modifier la règle" initial={{ severity: rule.severity, explanation: rule.explanation, active: rule.active }}
      fields={[{ key: 'severity', label: 'Sévérité', type: 'select', required: true, options: Object.entries(severityLabels) }, { key: 'explanation', label: 'Explication', type: 'textarea', required: true }, { key: 'active', label: 'Active', type: 'bool' }]}
      submit={(c, reason) => save(ctx, 'rule', rule.id, c, reason)} />}
    {ctx.draft && <p className="text-xs text-black/50">La condition et l’effet (logique interprétée par l’assistant) ne se modifient pas depuis l’écran.</p>}
  </Card>;
}
function DependencyDetail({ ctx, dep }: { ctx: Ctx; dep: BtpDependency }) {
  const work = (id: string) => ctx.catalog.works.find(w => w.id === id);
  const [reason, setReason] = useState('');
  return <Card className="space-y-3"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-teal">Dépendance</p><h2 className="text-xl font-bold">{work(dep.predecessorWorkId)?.label} → {work(dep.successorWorkId)?.label}</h2></div>
    <dl><Row label="Nature">{relationLabels[dep.relationType]}</Row><Row label="Obligatoire">{dep.mandatory ? 'Oui' : 'Non'}</Row><Row label="Explication">{dep.explanation}</Row>
      <Row label="Ouvrages"><button type="button" className="font-semibold text-teal hover:underline" onClick={() => ctx.goto('ouvrages', dep.predecessorWorkId)}>{work(dep.predecessorWorkId)?.label}</button> puis <button type="button" className="font-semibold text-teal hover:underline" onClick={() => ctx.goto('ouvrages', dep.successorWorkId)}>{work(dep.successorWorkId)?.label}</button></Row>
      <Provenance catalog={ctx.catalog} sourceRef={dep.sourceRef} /></dl>
    <p className="text-xs text-black/50">Une dépendance n’impose aucune date ni durée au planning d’un chantier.</p>
    {ctx.draft && <>
      <DraftForm title="Modifier la dépendance" initial={{ mandatory: dep.mandatory, explanation: dep.explanation, sourceRef: dep.sourceRef }}
        fields={[{ key: 'mandatory', label: 'Obligatoire', type: 'bool' }, { key: 'explanation', label: 'Explication', type: 'textarea', required: true }, { key: 'sourceRef', label: 'Source', type: 'text', required: true }]}
        submit={(c, r) => save(ctx, 'dependency', dep.id, c, r)} />
      <form className="flex flex-wrap gap-2 rounded-xl bg-red-50/60 p-3" onSubmit={e => { e.preventDefault(); void ctx.run(() => removeDependency(ctx.catalog.version!.id, dep.id, reason), 'Dépendance retirée du brouillon.').then(ok => ok && ctx.select(null)); }}>
        <Input aria-label="Motif du retrait" placeholder="Motif (5 caractères minimum)" value={reason} onChange={e => setReason(e.target.value)} className="flex-1" />
        <Button type="submit" className="bg-white text-red-700 ring-1 ring-red-200 hover:bg-red-50" disabled={reason.trim().length < 5}>Retirer du brouillon</Button></form>
    </>}
  </Card>;
}

// ---- 6. Versions
function nextCode(catalog: AdminCatalog) {
  const year = new Date().getFullYear(); const same = catalog.versions.map(v => v.code.match(new RegExp(`^${catalog.countryCode}-${year}\\.(\\d+)$`))).filter(Boolean).map(m => Number(m![1]));
  return `${catalog.countryCode}-${year}.${same.length ? Math.max(...same) + 1 : 1}`;
}
function VersionsTab({ ctx, onView }: { ctx: Ctx; onView: (id: string | null) => void }) {
  const { catalog } = ctx; const draft = catalog.versions.find(v => v.status === 'draft'), published = catalog.versions.find(v => v.status === 'published');
  const [code, setCode] = useState(nextCode(catalog)), [reason, setReason] = useState(''), [report, setReport] = useState<Validation | null>(null), [confirm, setConfirm] = useState(false);
  const viewingDraft = ctx.draft && catalog.version?.id === draft?.id;
  useEffect(() => { setReport(viewingDraft ? catalog.validation : null); }, [viewingDraft, catalog.validation]);
  return <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
    <div className="space-y-4">
      <Card className="space-y-3"><h2 className="font-bold">Versions ({catalog.versions.length})</h2>
        <ul className="divide-y divide-black/5">{catalog.versions.map(v => <li key={v.id} className="py-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">{v.code} <VersionBadge status={v.status} /></p>
            {catalog.version?.id === v.id ? <span className="text-xs text-black/50">Consultée</span> : <button type="button" className={linkButton} onClick={() => onView(v.status === 'published' ? null : v.id)}>Consulter</button>}</div>
          <p className="text-xs text-black/55">{v.status === 'draft' ? `Préparée le ${date(v.createdAt)}${v.createdBy ? ` par ${v.createdBy}` : ''}` : v.publishedAt ? `Publiée le ${date(v.publishedAt)}${v.publishedBy ? ` par ${v.publishedBy}` : ''}` : `Préparée le ${date(v.createdAt)}, jamais publiée`}
            {v.basedOnCode && ` · issue de ${v.basedOnCode}`}{v.effectiveTo && ` · fin de validité ${date(v.effectiveTo)}`}</p>
          <p className="text-xs text-black/45">{v.counts.lots} lots · {v.counts.subLots} sous-lots · {v.counts.works} ouvrages · {v.counts.rules} règles · {v.counts.dependencies} dépendances · {v.counts.measurementTemplates} métrés</p></li>)}</ul></Card>
      {!draft && published && <Card className="space-y-3"><h2 className="font-bold">Préparer une nouvelle version</h2>
        <p className="text-sm text-black/60">Copie intégrale de {published.code} en brouillon, avec les mêmes identifiants. {published.code} reste en vigueur jusqu’à la publication.</p>
        <form className="space-y-2" onSubmit={e => { e.preventDefault(); let created = ''; void ctx.run(async () => { created = (await createDraft(catalog.countryCode, code, reason)).versionId; setReason(''); }, `Brouillon ${code} préparé à partir de ${published.code}.`).then(ok => ok && onView(created)); }}>
          <label className="block text-xs font-semibold">Code de la nouvelle version<Input aria-label="Code de la nouvelle version" className="mt-1" value={code} onChange={e => setCode(e.target.value.toUpperCase())} /></label>
          <Input aria-label="Motif" placeholder="Motif (5 caractères minimum)" value={reason} onChange={e => setReason(e.target.value)} />
          <Button type="submit" disabled={reason.trim().length < 5 || !/^[A-Z]{2}-\d{4}\.\d+$/.test(code)}>Préparer le brouillon</Button></form></Card>}
      {draft && !viewingDraft && <Card className="text-sm">Un brouillon est en cours : <button type="button" className="font-semibold text-teal hover:underline" onClick={() => onView(draft.id)}>ouvrir {draft.code}</button> pour le valider ou le publier.</Card>}
      {viewingDraft && draft && <Card className="space-y-3"><h2 className="font-bold">Brouillon {draft.code}</h2>
        <Button type="button" className="bg-white text-teal ring-1 ring-inset ring-teal/30 hover:bg-teal/5" onClick={() => void ctx.run(async () => setReport(await validateDraft(draft.id)), 'Validation effectuée.')}>Vérifier le brouillon</Button>
        {report && <div role="region" aria-label="Résultat de la validation" className={`rounded-xl p-3 text-sm ${report.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-900'}`}>
          <p className="font-semibold">{report.ok ? 'Publiable' : 'Non publiable'} · {report.errors} erreur(s), {report.warnings} avertissement(s)</p>
          {report.issues.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5">{report.issues.map((i, k) => <li key={k}><strong>{i.severity === 'error' ? 'Erreur' : 'Avertissement'} :</strong> {i.message}</li>)}</ul>}</div>}
        <form className="space-y-2" onSubmit={e => { e.preventDefault(); void ctx.run(async () => { await publishDraft(draft.id, reason); setReason(''); setConfirm(false); }, `Version ${draft.code} publiée${published ? ` ; ${published.code} archivée` : ''}.`).then(ok => ok && onView(null)); }}>
          <Input aria-label="Motif de publication ou d’abandon" placeholder="Motif (5 caractères minimum)" value={reason} onChange={e => setReason(e.target.value)} />
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={confirm} onChange={e => setConfirm(e.target.checked)} />Je publie {draft.code} pour tous les nouveaux usages (assistant, création de chantier){published ? ` ; ${published.code} sera archivée et conservée` : ''}. Les chantiers existants ne sont pas modifiés.</label>
          <div className="flex flex-wrap gap-2"><Button type="submit" disabled={reason.trim().length < 5 || !confirm || report?.ok === false}>Publier {draft.code}</Button>
            <Button type="button" className="bg-white text-red-700 ring-1 ring-red-200 hover:bg-red-50" disabled={reason.trim().length < 5}
              onClick={() => void ctx.run(async () => { await abandonDraft(draft.id, reason); setReason(''); }, `Brouillon ${draft.code} abandonné (conservé dans l’historique).`).then(ok => ok && onView(null))}>Abandonner le brouillon</Button></div></form></Card>}
    </div>
    <Card className="space-y-3 self-start"><h2 className="font-bold">Historique de {catalog.version?.code}</h2>
      {!catalog.events.length ? <p className="text-sm text-black/60">{catalog.version?.basedOnVersionId ? 'Aucun événement.' : 'Version initiale livrée par migration (#541) : aucun événement d’administration.'}</p>
        : <ol className="divide-y divide-black/5">{catalog.events.map(e => <li key={e.id} className="py-2 text-sm"><p className="font-semibold">{actionLabels[e.action] ?? e.action}{e.entityKind && ` · ${kindLabels[e.entityKind as ItemKind] ?? e.entityKind}`}{e.entityCode && <code className="ml-1 text-xs text-black/50">{e.entityCode}</code>}</p>
          {e.action === 'item_update' && e.before && e.after && <p className="text-xs text-black/55">{Object.keys(e.after).filter(k => JSON.stringify(e.after![k]) !== JSON.stringify(e.before![k])).join(', ')}</p>}
          <p className="text-xs text-black/50">{dateTime(e.createdAt)} · {e.actor ?? 'Équipe D.A.O.'} · {e.reason}</p></li>)}</ol>}
      {catalog.priceBooks === 0 && <p className="text-xs text-black/45">Aucune source tarifaire : le référentiel ne publie aucun prix.</p>}
      <p className="text-xs text-black/45"><Link className="font-semibold text-teal hover:underline" href="/app/dao/history">Historique général</Link> pour les autres actions de la plateforme.</p>
    </Card>
  </div>;
}
