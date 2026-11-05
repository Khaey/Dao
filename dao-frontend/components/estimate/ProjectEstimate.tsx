'use client';

// #551 — Budget prévisionnel indicatif d'un chantier (Client propriétaire, Gestionnaire affecté, Admin).
// Toute sélection de tarif et tout calcul sont faits en base ; l'écran n'additionne rien lui-même.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Calculator, Check, ChevronDown, FlaskConical, History, Info, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { supabaseBrowser } from '../../lib/supabase-browser';
import { Badge, Card, SectionHeading } from '../ui';
import { cn } from '../../lib/utils';
import { fieldClass, primaryAction, secondaryAction } from '../../app/app/projects/_components/ProjectUi';

type Work = { id: string; label: string; unitCode: string; lot: string; subLot: string };
type Line = { key: string; workId: string; scopeKey: string; mode: 'none' | 'declared' | 'takeoff'; value: string; reference: string; takeoffId: string };
type Range = { htMinMinor: number | null; htMaxMinor: number | null; ttcMinMinor: number | null; ttcMaxMinor: number | null };

const MISSING: Record<string, string> = {
  quantity_missing: 'Quantité inconnue : fournir un métré validé ou une quantité déclarée avec sa référence.',
  quantity_not_validated: 'Le métré cité n’est pas encore validé.',
  quantity_unit_mismatch: 'Le métré n’est pas dans l’unité de l’ouvrage (aucune conversion implicite).',
  quantity_precision_unsupported: 'Quantité avec plus de 6 décimales.',
  price_missing: 'Aucun tarif sourcé et vérifié n’est disponible pour cet ouvrage.',
  price_out_of_validity_period: 'Le tarif connu n’est pas valable à la date de référence.',
  price_currency_without_sourced_rate: 'Tarif dans une autre devise, sans taux de change sourcé.',
  price_unit_differs_from_work_unit: 'Le tarif existe dans une autre unité que l’ouvrage.',
  work_not_in_catalog: 'Ouvrage absent de la version publiée du référentiel.',
};
const WARNINGS: Record<string, string> = {
  declared_quantity_not_validated: 'Quantité déclarée, non validée par un métré.',
  newer_takeoff_revision_not_validated: 'Un recalcul plus récent du métré n’est pas encore validé.',
  price_observation_older_than_12_months: 'Prix observé il y a plus de 12 mois.',
  ht_not_derivable_without_explicit_vat_rate: 'HT non calculable : le tarif TTC n’indique pas de taux de TVA.',
  ttc_not_derivable_without_explicit_vat_rate: 'TTC non calculable : le tarif HT n’indique pas de taux de TVA.',
  components_only_other_components_may_be_missing: 'Prix par composantes publiées seulement : d’autres composantes peuvent manquer.',
  several_sources_range: 'Plusieurs sources équivalentes : fourchette min–max.',
  price_available_quantity_missing: 'Un tarif existe, mais la quantité manque.',
};
const COVERAGE: Record<string, { label: string; tone: 'success' | 'waiting' | 'red' }> = {
  complete: { label: 'Estimation complète', tone: 'success' },
  partial: { label: 'Estimation partielle', tone: 'waiting' },
  unavailable: { label: 'Estimation indisponible', tone: 'red' },
};
const ORIGIN: Record<string, string> = { explicit: 'Ajouté ici', validated_takeoff: 'Métré validé', assistant_scope: 'Périmètre de l’assistant', work_item: 'Ouvrage du lot, sans métré validé' };

const tnd = (minor: number | null | undefined) => minor == null ? '—' : new Intl.NumberFormat('fr-TN', { style: 'currency', currency: 'TND', minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(minor / 1000);
const range = (min: number | null, max: number | null) => min == null || max == null ? 'Non calculable' : min === max ? tnd(min) : `${tnd(min)} – ${tnd(max)}`;
const date = (value?: string | null) => value ? new Intl.DateTimeFormat('fr-TN', { dateStyle: 'medium' }).format(new Date(value)) : '—';
const newKey = () => Math.random().toString(36).slice(2, 10);
const idem = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

async function api(path: string, init?: { method?: string; body?: unknown }) {
  const { data } = await supabaseBrowser().auth.getSession();
  if (!data.session) throw new Error('Session expirée. Reconnectez-vous.');
  const response = await fetch(path, { method: init?.method ?? 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token }, body: init?.body ? JSON.stringify(init.body) : undefined });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error ?? 'Opération refusée.'), { status: response.status });
  return payload.data;
}

export default function ProjectEstimate({ projectId }: { projectId: string }) {
  const [snapshot, setSnapshot] = useState<any>(null);
  const [works, setWorks] = useState<Work[]>([]);
  const [units, setUnits] = useState<Record<string, string>>({});
  const [prices, setPrices] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [estimateId, setEstimateId] = useState<string | null>(null);
  const [label, setLabel] = useState('Budget prévisionnel');
  const [mode, setMode] = useState<'reference' | 'simulation'>('reference');
  const [referenceDate, setReferenceDate] = useState('');
  const [includePrivate, setIncludePrivate] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [preview, setPreview] = useState<any>(null);
  const [showPrivateForm, setShowPrivateForm] = useState(false);

  const current = useMemo(() => snapshot?.estimates?.find((e: any) => e.id === estimateId) ?? null, [snapshot, estimateId]);
  const shown = preview ?? current?.current ?? null;
  const result = shown?.result ?? null;

  const loadFromEstimate = useCallback((estimate: any) => {
    setEstimateId(estimate?.id ?? null);
    if (!estimate) return;
    const inputs = estimate.current?.inputs ?? {};
    setLabel(estimate.label); setMode(inputs.mode ?? 'reference'); setIncludePrivate(Boolean(inputs.includePrivateAssumptions));
    setReferenceDate(inputs.referenceDate ?? '');
    setLines((inputs.lines ?? []).filter((l: any) => l.origin === 'explicit').map((l: any) => ({ key: newKey(), workId: l.workId, scopeKey: l.scopeKey,
      mode: l.source?.kind ?? 'none', value: l.declaredValue ?? '', reference: l.source?.reference ?? '', takeoffId: l.source?.takeoffId ?? '' })));
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [snap, catalog, priceList] = await Promise.all([
        api(`/api/btp/estimates?project_id=${projectId}`),
        api('/api/btp/catalog?country=TN'),
        api(`/api/btp/prices?project_id=${projectId}`),
      ]);
      setSnapshot(snap); setPrices(priceList);
      setUnits(Object.fromEntries((catalog.units ?? []).map((u: any) => [u.code, u.symbol])));
      setWorks((catalog.lots ?? []).flatMap((lot: any) => lot.subLots.flatMap((sub: any) => sub.works.map((w: any) => ({ id: w.id, label: w.label, unitCode: w.unitCode, lot: lot.label, subLot: sub.label })))));
      setEstimateId(id => id ?? snap.estimates?.[0]?.id ?? null);
      if (!estimateId && snap.estimates?.[0]) loadFromEstimate(snap.estimates[0]);
    } catch (e: any) {
      if (e.status === 403) setForbidden(true); else setError(e.message);
    } finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);

  const payload = () => ({
    projectId, mode, includePrivateAssumptions: mode === 'reference' && includePrivate, referenceDate: referenceDate || undefined,
    lines: lines.filter(l => l.workId).map(l => ({ workId: l.workId, scopeKey: l.scopeKey || 'default',
      ...(l.mode === 'declared' ? { quantity: { value: l.value.trim().replace(',', '.') }, source: { kind: 'declared', reference: l.reference.trim() } }
        : l.mode === 'takeoff' ? { source: { kind: 'takeoff', takeoffId: l.takeoffId } } : {}) })),
  });

  async function run(action: 'preview' | 'calculate' | 'approve') {
    setBusy(true); setError(''); setNotice('');
    try {
      if (action === 'preview') { setPreview(await api('/api/btp/estimates', { method: 'POST', body: { action, ...payload() } })); setNotice('Aperçu calculé, non enregistré.'); return; }
      const body = action === 'approve'
        ? { action, idempotencyKey: idem('approve'), estimateId, expectedRevision: current?.currentRevision }
        : { action, idempotencyKey: idem('calc'), ...payload(), label, ...(estimateId ? { estimateId, expectedRevision: current?.currentRevision } : {}) };
      const saved = await api('/api/btp/estimates', { method: 'POST', body });
      setPreview(null); setEstimateId(saved.id);
      setSnapshot((s: any) => ({ ...s, estimates: [saved, ...(s?.estimates ?? []).filter((e: any) => e.id !== saved.id)] }));
      setNotice(action === 'approve' ? 'Révision retenue comme référence (non contractuelle).' : `Révision ${saved.currentRevision} enregistrée.`);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  if (loading) return <Card className="p-6"><p className="text-sm text-ink/65" role="status">Chargement du budget prévisionnel…</p></Card>;
  if (forbidden) return <Card className="p-6"><p className="font-semibold text-ink">Accès réservé</p><p className="mt-1 text-sm text-ink/65">Le budget prévisionnel est visible uniquement par le client du chantier et le gestionnaire D.A.O. affecté.</p></Card>;

  const workById = new Map(works.map(w => [w.id, w]));
  const takeoffs = (snapshot?.takeoffs ?? []).filter((t: any) => t.validatedRevision);
  const privateItems = (prices?.items ?? []).filter((i: any) => i.priceKind === 'private_assumption' && i.status !== 'retired');
  const coverage = result ? COVERAGE[result.coverage.status] : null;

  return <div className="space-y-5">
    <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="note">
      <AlertTriangle size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
      <p><strong>Estimation indicative, non contractuelle.</strong> Elle ne remplace ni un devis, ni une offre, ni un contrat. Aucun prix n’est inventé : sans quantité ou sans tarif sourcé et vérifié, la ligne reste manquante.</p>
    </div>
    {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{error}</p>}
    {notice && <p className="flex items-center gap-2 rounded-xl border border-teal/20 bg-teal/[0.07] px-4 py-3 text-sm text-teal" role="status"><Check size={16} aria-hidden="true" />{notice}</p>}

    <Card className="p-5 sm:p-6">
      <SectionHeading eyebrow="Paramètres" title="Ouvrages et quantités" description={`Zone : ${snapshot?.governorate?.name ?? 'gouvernorat non renseigné'} · Les ouvrages retenus par l’assistant et les métrés validés sont ajoutés automatiquement.`}
        action={(snapshot?.estimates?.length ?? 0) > 1 ? <select aria-label="Estimation" className={cn(fieldClass, 'w-auto')} value={estimateId ?? ''} onChange={e => { setPreview(null); loadFromEstimate(snapshot.estimates.find((x: any) => x.id === e.target.value)); }}>{snapshot.estimates.map((e: any) => <option key={e.id} value={e.id}>{e.label}</option>)}</select> : undefined} />
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <label className="text-sm font-semibold text-ink">Intitulé<input aria-label="Intitulé de l’estimation" className={cn(fieldClass, 'mt-2')} value={label} maxLength={160} onChange={e => setLabel(e.target.value)} /></label>
        <label className="text-sm font-semibold text-ink">Date de référence<input aria-label="Date de référence" type="date" className={cn(fieldClass, 'mt-2')} value={referenceDate} onChange={e => setReferenceDate(e.target.value)} /><span className="mt-1 block text-xs font-normal text-ink/60">Vide : aujourd’hui.</span></label>
        <fieldset className="text-sm"><legend className="font-semibold text-ink">Données de prix</legend>
          <label className="mt-2 flex min-h-11 items-center gap-2"><input type="radio" name="estimate-mode" checked={mode === 'reference'} onChange={() => setMode('reference')} />Tarifs sourcés et vérifiés</label>
          <label className="flex min-h-11 items-center gap-2"><input type="radio" name="estimate-mode" checked={mode === 'simulation'} onChange={() => { setMode('simulation'); setIncludePrivate(false); }} />Simulation (données fictives de test)</label>
        </fieldset>
      </div>
      {mode === 'reference' && <label className="mt-3 flex min-h-11 items-center gap-2 text-sm text-ink"><input type="checkbox" checked={includePrivate} onChange={e => setIncludePrivate(e.target.checked)} />Utiliser mes hypothèses privées ({privateItems.length}) en priorité, clairement signalées</label>}

      <ul className="mt-5 space-y-3" aria-label="Lignes ajoutées">
        {lines.map((line, index) => {
          const w = workById.get(line.workId);
          const update = (patch: Partial<Line>) => setLines(all => all.map(l => l.key === line.key ? { ...l, ...patch } : l));
          return <li key={line.key} className="rounded-xl bg-sand p-3.5">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
              <label className="text-xs font-semibold text-ink/70">Ouvrage<select aria-label={`Ouvrage ligne ${index + 1}`} className={cn(fieldClass, 'mt-1')} value={line.workId} onChange={e => update({ workId: e.target.value })}>
                <option value="">Choisir un ouvrage du référentiel</option>
                {works.map(o => <option key={o.id} value={o.id}>{o.lot} › {o.label} ({units[o.unitCode] ?? o.unitCode})</option>)}
              </select></label>
              <label className="text-xs font-semibold text-ink/70">Quantité<select aria-label={`Source de quantité ligne ${index + 1}`} className={cn(fieldClass, 'mt-1')} value={line.mode} onChange={e => update({ mode: e.target.value as Line['mode'] })}>
                <option value="none">Inconnue</option><option value="declared">Déclarée</option>{takeoffs.length > 0 && <option value="takeoff">Métré validé</option>}
              </select></label>
              <button type="button" className={cn(secondaryAction, 'self-end')} aria-label={`Retirer la ligne ${index + 1}`} onClick={() => setLines(all => all.filter(l => l.key !== line.key))}><Trash2 size={15} aria-hidden="true" /></button>
            </div>
            {line.mode === 'declared' && <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-semibold text-ink/70">Valeur ({w ? units[w.unitCode] ?? w.unitCode : 'unité de l’ouvrage'})<input aria-label={`Quantité ligne ${index + 1}`} inputMode="decimal" className={cn(fieldClass, 'mt-1')} value={line.value} onChange={e => update({ value: e.target.value })} placeholder="Ex. 42.5" /></label>
              <label className="text-xs font-semibold text-ink/70">Référence (plan, relevé…)<input aria-label={`Référence ligne ${index + 1}`} className={cn(fieldClass, 'mt-1')} value={line.reference} maxLength={300} onChange={e => update({ reference: e.target.value })} placeholder="Ex. Plan A-12, relevé du 03/11" /></label>
            </div>}
            {line.mode === 'takeoff' && <label className="mt-3 block text-xs font-semibold text-ink/70">Métré validé<select aria-label={`Métré ligne ${index + 1}`} className={cn(fieldClass, 'mt-1')} value={line.takeoffId} onChange={e => update({ takeoffId: e.target.value })}>
              <option value="">Choisir</option>{takeoffs.filter((t: any) => !line.workId || t.workId === line.workId).map((t: any) => <option key={t.id} value={t.id}>{t.label} (révision {t.validatedRevision})</option>)}
            </select></label>}
          </li>;
        })}
      </ul>
      <button type="button" className={cn(secondaryAction, 'mt-3')} onClick={() => setLines(all => [...all, { key: newKey(), workId: '', scopeKey: `ligne-${all.length + 1}`, mode: 'declared', value: '', reference: '', takeoffId: '' }])}><Plus size={15} aria-hidden="true" />Ajouter un ouvrage</button>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button type="button" className={secondaryAction} disabled={busy} onClick={() => void run('preview')}><Calculator size={15} aria-hidden="true" />Calculer un aperçu</button>
        <button type="button" className={primaryAction} disabled={busy || !label.trim()} onClick={() => void run('calculate')}>{estimateId ? 'Enregistrer une nouvelle révision' : 'Enregistrer l’estimation'}</button>
        {current && !preview && current.status !== 'approved' && current.current?.coverageStatus !== 'unavailable' && <button type="button" className={secondaryAction} disabled={busy} onClick={() => void run('approve')}><ShieldCheck size={15} aria-hidden="true" />Retenir comme référence</button>}
      </div>
    </Card>

    {result && <EstimateResultView result={result} verification={shown?.verification} units={units} isPreview={Boolean(preview)} revision={preview ? null : current} coverage={coverage!} />}
    {!result && <Card className="p-5 sm:p-6"><p className="font-semibold text-ink">Aucune estimation enregistrée</p><p className="mt-1 text-sm text-ink/65">Ajoutez des ouvrages et leurs quantités, puis calculez un aperçu. Sans quantité ni tarif sourcé, l’estimation restera indisponible et listera les informations à fournir.</p></Card>}

    {current && <Card className="p-5 sm:p-6">
      <SectionHeading title="Historique des révisions" description="Chaque calcul crée une révision immuable. Une révision retenue n’est jamais modifiée." action={<History size={18} aria-hidden="true" className="text-ink/50" />} />
      <ul className="mt-4 space-y-2">{current.history.map((h: any) => <li key={h.revision} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-sand px-3.5 py-2.5 text-sm">
        <span className="font-semibold">Révision {h.revision}</span><Badge tone={COVERAGE[h.coverageStatus].tone}>{COVERAGE[h.coverageStatus].label}</Badge>
        {h.mode === 'simulation' && <Badge tone="clay">Simulation</Badge>}{current.approvedRevision === h.revision && <Badge tone="teal">Référence retenue</Badge>}
        <span className="text-ink/65">{h.pricedLines}/{h.totalLines} lignes chiffrées · HT {range(h.totals?.htMinMinor ?? null, h.totals?.htMaxMinor ?? null)}</span><span className="ml-auto text-xs text-ink/55">{date(h.createdAt)}</span>
      </li>)}</ul>
    </Card>}

    <Card className="p-5 sm:p-6">
      <SectionHeading title="Mes hypothèses privées" description="Prix que vous fournissez vous-même (par exemple un devis reçu). Jamais publiés, jamais présentés comme vérifiés, utilisés seulement si vous le demandez." action={<button type="button" className={secondaryAction} onClick={() => setShowPrivateForm(v => !v)}><Plus size={15} aria-hidden="true" />{showPrivateForm ? 'Fermer' : 'Ajouter'}</button>} />
      {showPrivateForm && <PrivateAssumptionForm projectId={projectId} works={works} units={units} onSaved={() => { setShowPrivateForm(false); void load(); }} />}
      {privateItems.length === 0 ? <p className="mt-4 text-sm text-ink/60">Aucune hypothèse privée.</p> : <ul className="mt-4 space-y-2">{privateItems.map((i: any) => <li key={i.id} className="rounded-xl bg-sand px-3.5 py-2.5 text-sm">
        <span className="font-semibold">{i.workLabel}</span> · {tnd(i.current?.amountMinMinor)}{i.current?.amountMaxMinor !== i.current?.amountMinMinor ? ` – ${tnd(i.current?.amountMaxMinor)}` : ''} / {units[i.unitCode] ?? i.unitCode} {i.current?.taxBasis}
        <span className="block text-xs text-ink/60">{i.current?.sourceLocator} · valable dès le {date(i.current?.validFrom)}</span>
      </li>)}</ul>}
    </Card>
  </div>;
}

function EstimateResultView({ result, verification, units, isPreview, revision, coverage }: { result: any; verification?: { ok: boolean; mismatches: string[] }; units: Record<string, string>; isPreview: boolean; revision: any; coverage: { label: string; tone: 'success' | 'waiting' | 'red' } }) {
  const t: Range & { scope: string; linesWithoutHt: number; linesWithoutTtc: number } = result.totals;
  const totalLabel = result.coverage.status === 'complete' ? 'Total estimé' : 'Sous-total des seules lignes chiffrées';
  return <Card className="p-5 sm:p-6" data-testid="estimate-result">
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone={coverage.tone}>{coverage.label}</Badge>
      {result.mode === 'simulation' && <Badge tone="clay"><FlaskConical size={12} aria-hidden="true" className="mr-1" />Simulation — données fictives</Badge>}
      {isPreview ? <Badge>Aperçu non enregistré</Badge> : revision && <Badge>Révision {revision.currentRevision}{revision.status === 'approved' ? ' · référence retenue' : ''}</Badge>}
      {verification && <Badge tone={verification.ok ? 'success' : 'red'}>{verification.ok ? 'Calcul revérifié' : 'Écart de calcul détecté'}</Badge>}
    </div>
    <p className="mt-3 text-sm text-ink/70">{result.coverage.pricedLines} ligne{result.coverage.pricedLines > 1 ? 's' : ''} chiffrée{result.coverage.pricedLines > 1 ? 's' : ''} sur {result.coverage.totalLines} · Référentiel {result.catalogVersion.code} · Date de référence {date(result.referenceDate)} · Zone {result.governorate ?? 'nationale'}</p>
    {result.coverage.status === 'unavailable'
      ? <div className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800"><p className="font-semibold">Aucun montant ne peut être annoncé.</p><p className="mt-1">Il manque les informations listées ci-dessous. D.A.O. n’invente ni quantité ni prix.</p></div>
      : <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-sand p-4"><dt className="text-xs font-medium text-ink/65">{totalLabel} HT</dt><dd className="mt-1 text-xl font-bold tabular-nums text-ink">{range(t.htMinMinor, t.htMaxMinor)}</dd>{t.linesWithoutHt > 0 && <dd className="mt-1 text-xs text-ink/60">{t.linesWithoutHt} ligne(s) sans HT calculable</dd>}</div>
          <div className="rounded-xl bg-sand p-4"><dt className="text-xs font-medium text-ink/65">{totalLabel} TTC</dt><dd className="mt-1 text-xl font-bold tabular-nums text-ink">{range(t.ttcMinMinor, t.ttcMaxMinor)}</dd>{t.linesWithoutTtc > 0 && <dd className="mt-1 text-xs text-ink/60">{t.linesWithoutTtc} ligne(s) sans TTC calculable</dd>}</div>
        </dl>}
    {result.coverage.status === 'partial' && <p className="mt-3 flex items-start gap-2 text-sm text-amber-800"><Info size={15} aria-hidden="true" className="mt-0.5 shrink-0" />Ce sous-total n’est pas un budget : {result.coverage.missingLines} ligne(s) restent sans montant.</p>}

    {result.missing.length > 0 && <div className="mt-5"><h3 className="text-sm font-bold text-ink">Informations nécessaires</h3><ul className="mt-2 space-y-2">{result.missing.map((m: any, index: number) => <li key={`${m.workId}/${m.scopeKey}/${index}`} className="rounded-xl border border-black/[0.06] p-3 text-sm"><span className="font-semibold">{m.workLabel ?? m.workId}</span>{m.unitCode && <span className="text-ink/60"> ({units[m.unitCode] ?? m.unitCode})</span>}<ul className="mt-1 list-disc pl-5 text-ink/70">{m.codes.map((c: string) => <li key={c}>{MISSING[c] ?? c}</li>)}</ul></li>)}</ul></div>}

    {result.byLot.some((l: any) => l.pricedLines > 0) && <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[30rem] text-left text-sm"><caption className="sr-only">Sous-totaux par lot</caption><thead><tr className="border-b border-black/10 text-xs text-ink/60"><th className="py-2 pr-3 font-medium">Lot</th><th className="py-2 pr-3 font-medium">Lignes chiffrées</th><th className="py-2 pr-3 font-medium">HT</th><th className="py-2 font-medium">TTC</th></tr></thead>
      <tbody>{result.byLot.flatMap((l: any) => [<tr key={l.lotId ?? 'none'} className="border-b border-black/[0.05]"><td className="py-2 pr-3 font-semibold">{l.lotLabel}</td><td className="py-2 pr-3 tabular-nums">{l.pricedLines}/{l.totalLines}</td><td className="py-2 pr-3 tabular-nums">{l.pricedLines ? range(l.htMinMinor, l.htMaxMinor) : '—'}</td><td className="py-2 tabular-nums">{l.pricedLines ? range(l.ttcMinMinor, l.ttcMaxMinor) : '—'}</td></tr>,
        ...((l.subLots ?? []).length > 1 || (l.subLots ?? []).some((sub: any) => sub.subLotId) ? (l.subLots ?? []).map((sub: any) => <tr key={`${l.lotId}/${sub.subLotId ?? 'direct'}`} className="border-b border-black/[0.05] text-xs text-ink/75"><td className="py-1.5 pl-4 pr-3">{sub.title}</td><td className="py-1.5 pr-3 tabular-nums">{sub.pricedLines}/{sub.totalLines}</td><td className="py-1.5 pr-3 tabular-nums">{sub.pricedLines ? range(sub.htMinMinor, sub.htMaxMinor) : '—'}</td><td className="py-1.5 tabular-nums">{sub.pricedLines ? range(sub.ttcMinMinor, sub.ttcMaxMinor) : '—'}</td></tr>) : [])])}</tbody></table></div>}

    <h3 className="mt-6 text-sm font-bold text-ink">Détail et justification des lignes</h3>
    <ul className="mt-2 space-y-2">{result.lines.map((line: any, index: number) => <li key={`${line.workItemId ?? line.workId}/${line.scopeKey}/${index}`}><details className="group rounded-xl border border-black/[0.06] [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex min-h-12 cursor-pointer list-none flex-wrap items-center gap-2 px-3.5 py-2.5 text-sm">
        <span className="min-w-0 flex-1 font-semibold text-ink">{line.itemLabel ?? line.workLabel ?? line.workId}<span className="block text-xs font-normal text-ink/60">{line.requestTitle ? [line.requestTitle, line.projectSubLotTitle].filter(Boolean).join(' › ') : [line.lotLabel, line.subLotLabel].filter(Boolean).join(' › ')} · {ORIGIN[line.origin] ?? line.origin}</span></span>
        <span className="tabular-nums text-ink/75">{line.quantity ? `${line.quantity.value} ${units[line.quantity.unit] ?? line.quantity.unit}` : 'Quantité inconnue'}</span>
        <span className="tabular-nums font-semibold">{line.status === 'missing' ? 'Manquant' : `HT ${range(line.totals.htMinMinor, line.totals.htMaxMinor)}`}</span>
        <ChevronDown size={15} aria-hidden="true" className="text-ink/50 transition group-open:rotate-180" />
      </summary>
      <div className="space-y-2 border-t border-black/[0.06] px-3.5 py-3 text-sm text-ink/75">
        <p>Quantité : {line.quantitySource.kind === 'declared' ? `déclarée — ${line.quantitySource.reference}` : line.quantitySource.kind === 'takeoff' ? `métré validé (révision ${line.quantitySource.revision ?? '—'})` : 'non fournie'}</p>
        <p>Calcul : {line.formula}. TTC : {range(line.totals.ttcMinMinor, line.totals.ttcMaxMinor)}.</p>
        {line.candidates.map((c: any) => <div key={c.itemId} className="rounded-lg bg-sand p-3">
          <p className="font-semibold text-ink">{tnd(c.amountMinMinor)}{c.amountMaxMinor !== c.amountMinMinor ? ` – ${tnd(c.amountMaxMinor)}` : ''} / {units[line.unitCode] ?? line.unitCode} {c.taxBasis}{c.vatRateBp != null ? ` (TVA ${c.vatRateBp / 100} %)` : ' (TVA non indiquée)'} · {c.component === 'composite' ? 'prix global' : c.component}</p>
          <p className="mt-1 text-xs">{c.priceKind === 'private_assumption' ? 'Hypothèse privée du chantier' : <>Source : {c.source?.uri ? <a className="text-teal underline" href={c.source.uri} target="_blank" rel="noreferrer">{c.source?.name}</a> : c.source?.name} — {c.source?.publisher}{c.source?.dataNature === 'fictitious_test' ? ' — DONNÉES FICTIVES' : ''}</>} · {c.sourceLocator} · observé le {date(c.observedOn)} · valable {date(c.validFrom)} → {c.validTo ? date(c.validTo) : 'sans fin'} · zone {c.zone === 'governorate' ? 'gouvernorat' : c.zone === 'national' ? 'nationale' : 'chantier'}{c.includes?.length ? ` · comprend : ${c.includes.join(', ')}` : ''}</p>
          {c.source?.licenseNote && <p className="mt-1 text-xs text-ink/55">Licence : {c.source.licenseNote}</p>}
        </div>)}
        {line.missing.map((m: string) => <p key={m} className="text-red-700">{MISSING[m] ?? m}</p>)}
        {line.warnings.map((w: string) => <p key={w} className="text-amber-800">{WARNINGS[w] ?? w}</p>)}
      </div>
    </details></li>)}</ul>
    <details className="mt-5 text-xs text-ink/60"><summary className="cursor-pointer font-semibold">Règles de calcul ({result.rules.version})</summary><ul className="mt-2 list-disc space-y-1 pl-5">{[...result.rules.selection, result.rules.rounding, result.rules.tax, result.rules.freshness].map((r: string) => <li key={r}>{r}</li>)}</ul></details>
  </Card>;
}

function PrivateAssumptionForm({ projectId, works, units, onSaved }: { projectId: string; works: Work[]; units: Record<string, string>; onSaved: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ workId: '', amount: '', taxBasis: 'HT', vat: '', locator: '', validFrom: today, validTo: '' });
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm(f => ({ ...f, ...patch }));
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError('');
    const amount = Math.round(Number(form.amount.replace(',', '.')) * 1000);
    if (!Number.isFinite(amount) || amount <= 0) { setError('Indiquez un prix unitaire positif.'); return; }
    const vat = form.vat.trim() ? Math.round(Number(form.vat.replace(',', '.')) * 100) : undefined;
    setSaving(true);
    try {
      await api('/api/btp/prices', { method: 'POST', body: { action: 'record', idempotencyKey: idem('priv'), priceKind: 'private_assumption', projectId, workId: form.workId,
        amountMinMinor: amount, taxBasis: form.taxBasis, ...(vat != null ? { vatRateBp: vat } : {}), observedOn: form.validFrom, validFrom: form.validFrom,
        ...(form.validTo ? { validTo: form.validTo } : {}), sourceLocator: form.locator.trim() } });
      onSaved();
    } catch (e: any) { setError(e.message); } finally { setSaving(false); }
  }
  const w = works.find(x => x.id === form.workId);
  return <form onSubmit={submit} className="mt-4 grid gap-3 rounded-xl bg-sand p-4 sm:grid-cols-2">
    <label className="text-xs font-semibold text-ink/70 sm:col-span-2">Ouvrage<select aria-label="Ouvrage de l’hypothèse" required className={cn(fieldClass, 'mt-1')} value={form.workId} onChange={e => set({ workId: e.target.value })}><option value="">Choisir</option>{works.map(o => <option key={o.id} value={o.id}>{o.lot} › {o.label} ({units[o.unitCode] ?? o.unitCode})</option>)}</select></label>
    <label className="text-xs font-semibold text-ink/70">Prix unitaire (TND / {w ? units[w.unitCode] ?? w.unitCode : 'unité'})<input aria-label="Prix unitaire" required inputMode="decimal" className={cn(fieldClass, 'mt-1')} value={form.amount} onChange={e => set({ amount: e.target.value })} /></label>
    <div className="grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-ink/70">Base<select aria-label="Base HT ou TTC" className={cn(fieldClass, 'mt-1')} value={form.taxBasis} onChange={e => set({ taxBasis: e.target.value })}><option>HT</option><option>TTC</option></select></label>
      <label className="text-xs font-semibold text-ink/70">TVA (%) si connue<input aria-label="Taux de TVA" inputMode="decimal" className={cn(fieldClass, 'mt-1')} value={form.vat} onChange={e => set({ vat: e.target.value })} /></label></div>
    <label className="text-xs font-semibold text-ink/70 sm:col-span-2">Justification (devis, date, fournisseur…)<input aria-label="Justification" required minLength={2} maxLength={300} className={cn(fieldClass, 'mt-1')} value={form.locator} onChange={e => set({ locator: e.target.value })} /></label>
    <label className="text-xs font-semibold text-ink/70">Valable à partir du<input aria-label="Début de validité" type="date" required className={cn(fieldClass, 'mt-1')} value={form.validFrom} onChange={e => set({ validFrom: e.target.value })} /></label>
    <label className="text-xs font-semibold text-ink/70">Jusqu’au (facultatif)<input aria-label="Fin de validité" type="date" className={cn(fieldClass, 'mt-1')} value={form.validTo} onChange={e => set({ validTo: e.target.value })} /></label>
    {error && <p className="text-sm text-red-700 sm:col-span-2" role="alert">{error}</p>}
    <div className="sm:col-span-2"><button type="submit" className={primaryAction} disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer l’hypothèse'}</button></div>
  </form>;
}
