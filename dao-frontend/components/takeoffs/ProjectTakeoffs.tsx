'use client';

// #560 — Métrés du chantier (Client propriétaire, Gestionnaire affecté, Admin).
// Écran seulement : formulaires pilotés par les modèles publiés du référentiel (#541/#547),
// calcul, révisions et droits par l'API du moteur #548, budget par l'API d'estimation #551.
// Aucune quantité, valeur par défaut ni prix n'est créé ici.
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Calculator, Check, ChevronDown, ClipboardCheck, History, Plus, Ruler, Search, Send, ShieldCheck, X } from 'lucide-react';
import { supabaseBrowser } from '../../lib/supabase-browser';
import { fetchMySettings } from '../../lib/settings';
import { Badge, Card, SectionHeading } from '../ui';
import { cn } from '../../lib/utils';
import { fieldClass, primaryAction, secondaryAction } from '../../app/app/projects/_components/ProjectUi';
import {
  checkDraft, compareInputs, EVENT_LABELS, fieldLabel, formulaText, INPUT_UNITS, dimensionOf, scopeKeyFrom, SOURCE_KINDS,
  STATUS_LABELS, takeoffActions, templateFields, uniqueScopeKey, UNIT_SYMBOLS, VALIDATION_BASIS_LABELS,
  type TakeoffDraftField, type TakeoffSchema, type TakeoffStatus, type ViewerRole,
} from '../../../dao-backend/src/btp-takeoff-ui/presentation';

type Work = { id: string; label: string; unitCode: string; lot: string; subLot: string; order: number; note: string; aliases: string[] };
type Template = { id: string; workId: string; outputUnitCode: string; inputSchema: TakeoffSchema; formulaAst: Record<string, unknown>; roundingScale: number; assumptions: string[]; sourceRef: string };
type Revision = { id: string; revision: number; status: 'calculated' | 'insufficient_data'; inputs: Record<string, any>; formula: Record<string, any>; justification: Record<string, any>; inputSha256: string; resultSha256: string; createdBy: string; createdAt: string };
type Takeoff = { id: string; workId: string; scopeKey: string; label: string; status: TakeoffStatus; currentRevision: number; validatedRevision: number | null; catalogVersionId: string;
  current: Revision | null; validated: Revision | null; history: Array<{ revision: number; status: string; result: any; createdBy: string; createdAt: string }>;
  events: Array<{ id: string; revision: number; type: string; actorId: string; note?: string; validationBasis?: string; createdAt: string }> };
type Editor = { workId: string; takeoff: Takeoff | null };

const STATUS_TONE: Record<TakeoffStatus, 'neutral' | 'waiting' | 'success'> = { draft: 'neutral', submitted: 'waiting', validated: 'success' };
const SOURCE_LABEL = Object.fromEntries(SOURCE_KINDS.map(s => [s.kind, s.label]));
const ESTIMATE_CAUSES: Record<string, string> = {
  quantity_missing: 'Aucune quantité : métré absent ou non validé.',
  quantity_not_validated: 'Métré pas encore validé.',
  quantity_unit_mismatch: 'Le métré n’est pas dans l’unité de l’ouvrage.',
  quantity_precision_unsupported: 'Quantité avec trop de décimales.',
  price_missing: 'Aucun tarif sourcé et vérifié pour cet ouvrage.',
  price_out_of_validity_period: 'Tarif hors période de validité.',
  price_currency_without_sourced_rate: 'Tarif dans une autre devise, sans taux sourcé.',
  price_unit_differs_from_work_unit: 'Tarif dans une autre unité que l’ouvrage.',
  work_not_in_catalog: 'Ouvrage absent du référentiel publié.',
};
const COVERAGE: Record<string, { label: string; tone: 'success' | 'waiting' | 'red' }> = {
  complete: { label: 'Budget complet', tone: 'success' }, partial: { label: 'Budget partiel', tone: 'waiting' }, unavailable: { label: 'Budget indisponible', tone: 'red' },
};

const sym = (unit?: string | null) => unit ? UNIT_SYMBOLS[unit] ?? unit : '';
const fmt = (value?: string | number | null) => value == null ? '—' : String(value).replace('.', ',');
const when = (value?: string | null) => value ? new Intl.DateTimeFormat('fr-TN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
const idem = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }
async function api(path: string, body?: unknown) {
  const { data } = await supabaseBrowser().auth.getSession();
  if (!data.session) throw new ApiError('Session expirée. Reconnectez-vous.', 401);
  const response = await fetch(path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token }, body: body ? JSON.stringify(body) : undefined });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status === 401 ? 'Session expirée. Reconnectez-vous.' : payload.error ?? 'Opération refusée.', response.status);
  return payload.data;
}

export default function ProjectTakeoffs({ projectId }: { projectId: string }) {
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState<'forbidden' | 'session' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [works, setWorks] = useState<Map<string, Work>>(new Map());
  const [templates, setTemplates] = useState<Map<string, Template>>(new Map());
  const [catalogVersion, setCatalogVersion] = useState<{ id: string; code: string } | null>(null);
  const [scopeWorkIds, setScopeWorkIds] = useState<string[]>([]);
  const [addedWorkIds, setAddedWorkIds] = useState<string[]>([]);
  const [takeoffs, setTakeoffs] = useState<Takeoff[]>([]);
  const [role, setRole] = useState<ViewerRole & { userId: string; clientId: string | null }>({ isOwner: false, isAdmin: false, isAssignedManager: false, hasAssignedManager: false, userId: '', clientId: null });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [estimate, setEstimate] = useState<any>(null);
  const [estimateError, setEstimateError] = useState('');
  const [picker, setPicker] = useState(false);

  const fail = useCallback((e: any) => {
    if (e instanceof ApiError && e.status === 401) setDenied('session');
    else if (e instanceof ApiError && e.status === 403) setDenied('forbidden');
    else setError(e?.message ?? 'Opération refusée.');
  }, []);

  const refreshEstimate = useCallback(async () => {
    setEstimateError('');
    try { setEstimate(await api('/api/btp/estimates', { action: 'preview', projectId, mode: 'reference' })); }
    catch (e: any) { setEstimate(null); setEstimateError(e.message); }
  }, [projectId]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      // Les droits réels viennent de la base : l'estimation #551 n'est ouverte qu'au Client
      // propriétaire, au Gestionnaire affecté et à l'Admin ; un Artisan reçoit 403.
      const snapshot = await api(`/api/btp/estimates?project_id=${projectId}`);
      const supabase = supabaseBrowser();
      const [list, catalog, user] = await Promise.all([
        api(`/api/btp/takeoffs?project_id=${projectId}`),
        api('/api/btp/catalog?country=TN'),
        supabase.auth.getUser(),
      ]);
      const uid = user.data.user?.id ?? '';
      const [roles, project, assignments] = await Promise.all([
        supabase.from('user_roles').select('role').eq('user_id', uid),
        supabase.from('projects').select('client_id').eq('id', projectId).maybeSingle(),
        supabase.from('review_assignments').select('reviewer_id').eq('project_id', projectId),
      ]);
      const roleNames = (roles.data ?? []).map((r: { role: string }) => r.role);
      const reviewers = (assignments.data ?? []).map((a: { reviewer_id: string }) => a.reviewer_id);
      const clientId = (project.data as { client_id?: string } | null)?.client_id ?? null;
      const isOwner = Boolean(uid) && clientId === uid;
      // #556 §5.1 : réglage Admin résolu pour ce chantier ; en cas d'erreur, règle par défaut (la base décide).
      const clientCanValidate = isOwner && await fetchMySettings('client', projectId)
        .then(s => s.settings['takeoffs.client_validation']?.value === true).catch(() => false);
      setRole({ userId: uid, clientId, isOwner, clientCanValidate, isAdmin: roleNames.includes('dao_admin'),
        isAssignedManager: (roleNames.includes('dao_reviewer') || roleNames.includes('dao_admin')) && reviewers.includes(uid), hasAssignedManager: reviewers.length > 0 });
      const workMap = new Map<string, Work>(); let order = 0;
      for (const lot of catalog.lots ?? []) for (const sub of lot.subLots ?? []) for (const w of sub.works ?? []) {
        workMap.set(w.id, { id: w.id, label: w.label, unitCode: w.unitCode, lot: lot.label, subLot: sub.label, order: order++, note: w.measurementNote ?? '', aliases: w.aliases ?? [] });
      }
      setWorks(workMap);
      setTemplates(new Map((catalog.measurementTemplates ?? []).map((t: Template) => [t.workId, t])));
      setCatalogVersion(catalog.catalogVersion ? { id: catalog.catalogVersion.id, code: catalog.catalogVersion.code } : null);
      setScopeWorkIds((snapshot.scopeWorks ?? []).map((s: any) => String(s.workId).toLowerCase()));
      setTakeoffs(list.items ?? []);
      void refreshEstimate();
    } catch (e: any) { fail(e); } finally { setLoading(false); }
  }, [projectId, fail, refreshEstimate]);
  useEffect(() => { void load(); }, [load]);

  const visibleWorkIds = useMemo(() => {
    const ids = new Set<string>([...scopeWorkIds, ...takeoffs.map(t => t.workId), ...addedWorkIds]);
    return [...ids].sort((a, b) => (works.get(a)?.order ?? 1e9) - (works.get(b)?.order ?? 1e9));
  }, [scopeWorkIds, takeoffs, addedWorkIds, works]);
  const selected = takeoffs.find(t => t.id === selectedId) ?? null;
  const counts = { draft: takeoffs.filter(t => t.status === 'draft').length, submitted: takeoffs.filter(t => t.status === 'submitted').length, validated: takeoffs.filter(t => t.validatedRevision).length };
  const actions = takeoffActions(role, null);

  function upsert(takeoff: Takeoff) {
    setTakeoffs(all => [takeoff, ...all.filter(t => t.id !== takeoff.id)]);
    setSelectedId(takeoff.id);
  }

  async function command(body: Record<string, unknown>, success: string) {
    setBusy(true); setError(''); setNotice('');
    try {
      const saved = await api('/api/btp/takeoffs', body);
      upsert(saved); setNotice(success); setEditor(null);
      void refreshEstimate();
      return true;
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 409) { setError('Ce métré a été modifié entre-temps. La version à jour est rechargée.'); void load(); }
      else fail(e);
      return false;
    } finally { setBusy(false); }
  }

  if (loading) return <Card className="p-6" aria-busy="true"><p className="text-sm text-ink/65" role="status">Chargement des métrés…</p></Card>;
  if (denied === 'session') return <Card className="p-6"><p className="font-semibold text-ink">Session expirée</p><p className="mt-1 text-sm text-ink/65">Reconnectez-vous pour consulter les métrés. Aucune saisie n’a été enregistrée sans calcul.</p><Link href="/auth/login" className={cn(primaryAction, 'mt-4')}>Se reconnecter</Link></Card>;
  if (denied === 'forbidden') return <Card className="p-6"><p className="font-semibold text-ink">Accès réservé</p><p className="mt-1 text-sm text-ink/65">Les métrés et le budget prévisionnel sont réservés au client du chantier, au gestionnaire D.A.O. affecté et à l’administration D.A.O.</p></Card>;

  return <div className="space-y-5">
    <div className="flex items-start gap-3 rounded-2xl border border-teal/20 bg-teal/[0.06] p-4 text-sm text-ink/80" role="note">
      <Ruler size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-teal" />
      <p><strong>Quantités prévisionnelles, calculées à partir de vos dimensions réelles.</strong> Chaque dimension garde sa provenance ; D.A.O. n’invente aucune valeur, n’applique aucune perte et ne lit pas les plans. Un métré compte dans le budget prévisionnel seulement une fois <strong>validé</strong>.</p>
    </div>
    <ValidationPolicy role={role} />
    {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{error}</p>}
    {notice && <p className="flex items-center gap-2 rounded-xl border border-teal/20 bg-teal/[0.07] px-4 py-3 text-sm text-teal" role="status"><Check size={16} aria-hidden="true" />{notice}</p>}

    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <div className="space-y-4 min-w-0">
        <Card className="p-5 sm:p-6">
          <SectionHeading eyebrow={catalogVersion ? `Référentiel ${catalogVersion.code}` : 'Référentiel'} title="Ouvrages du chantier"
            description={`${counts.draft} brouillon(s) · ${counts.submitted} en attente de validation · ${counts.validated} validé(s)`}
            action={actions.canWrite ? <button type="button" className={secondaryAction} onClick={() => setPicker(v => !v)} aria-expanded={picker}><Plus size={15} aria-hidden="true" />Ajouter un ouvrage</button> : undefined} />
          {picker && <WorkPicker works={works} templates={templates} exclude={visibleWorkIds} onPick={id => { setAddedWorkIds(all => [...all, id]); setPicker(false); if (templates.has(id)) { setEditor({ workId: id, takeoff: null }); setSelectedId(null); } }} onClose={() => setPicker(false)} />}
          {visibleWorkIds.length === 0
            ? <div className="mt-5 rounded-xl bg-sand p-4 text-sm text-ink/70"><p className="font-semibold text-ink">Aucun ouvrage pour l’instant</p><p className="mt-1">Les ouvrages retenus avec l’assistant apparaissent ici automatiquement. Vous pouvez aussi ajouter un ouvrage du référentiel.</p></div>
            : <ul className="mt-5 space-y-3" aria-label="Ouvrages du chantier">{visibleWorkIds.map(workId => <WorkRow key={workId} work={works.get(workId)} workId={workId} template={templates.get(workId)}
                takeoffs={takeoffs.filter(t => t.workId === workId)} selectedId={selectedId} canWrite={actions.canWrite} fromAssistant={scopeWorkIds.includes(workId)}
                onSelect={id => { setSelectedId(id); setEditor(null); }} onNew={() => { setEditor({ workId, takeoff: null }); setSelectedId(null); }} />)}</ul>}
        </Card>
        <BudgetPanel projectId={projectId} estimate={estimate} error={estimateError} works={works} takeoffs={takeoffs} />
      </div>

      <div className="min-w-0 space-y-4">
        {editor && templates.get(editor.workId) && <TakeoffEditor key={`${editor.workId}-${editor.takeoff?.id ?? 'new'}`} work={works.get(editor.workId)} template={templates.get(editor.workId)!}
          takeoff={editor.takeoff} takenScopes={takeoffs.filter(t => t.workId === editor.workId).map(t => t.scopeKey)} busy={busy}
          onCancel={() => { setEditor(null); if (editor.takeoff) setSelectedId(editor.takeoff.id); }}
          onSubmit={(payload) => command({ action: 'calculate', project_id: projectId, work_id: editor.workId, idempotency_key: idem('calc'), ...payload,
            ...(editor.takeoff ? { takeoff_id: editor.takeoff.id, expected_revision: editor.takeoff.currentRevision } : {}) }, 'Révision calculée et enregistrée.')} />}
        {!editor && selected && <TakeoffDetail takeoff={selected} work={works.get(selected.workId)} template={templates.get(selected.workId)} catalogVersion={catalogVersion} role={role} busy={busy}
          onRevise={() => setEditor({ workId: selected.workId, takeoff: selected })}
          onSubmit={note => command({ action: 'submit', takeoff_id: selected.id, expected_revision: selected.currentRevision, idempotency_key: idem('submit'), ...(note ? { note } : {}) }, 'Métré soumis : en attente de validation technique.')}
          onValidate={note => command({ action: 'validate', takeoff_id: selected.id, expected_revision: selected.currentRevision, idempotency_key: idem('validate'), ...(note ? { note } : {}) }, 'Métré validé : il devient la référence du budget prévisionnel.')} />}
        {!editor && !selected && <Card className="p-5 sm:p-6"><p className="font-semibold text-ink">Choisissez un métré</p><p className="mt-1 text-sm text-ink/65">Sélectionnez un métré pour voir son calcul justifié, ou créez-en un avec « Nouveau métré » sur un ouvrage calculable.</p></Card>}
      </div>
    </div>
  </div>;
}

function ValidationPolicy({ role }: { role: ViewerRole }) {
  if (role.isOwner && role.clientCanValidate) return <p className="rounded-xl bg-sand px-4 py-3 text-sm text-ink/75" data-testid="validation-policy">Les paramètres D.A.O. vous autorisent à valider vous-même les métrés de ce chantier{role.hasAssignedManager ? ' (le gestionnaire affecté peut aussi les valider)' : ''}. Chaque validation est tracée comme « validée par le Client » et ne modifie jamais une révision.</p>;
  if (role.isOwner && !role.hasAssignedManager) return <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="note" data-testid="validation-policy">
    <AlertTriangle size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
    <p><strong>Aucun gestionnaire n’est affecté à ce chantier.</strong> Vous pouvez calculer et soumettre vos métrés, mais vous ne pouvez pas les valider vous-même. Ils restent « en attente de validation technique » jusqu’à la validation par un gestionnaire affecté ou l’administration D.A.O. ; d’ici là, le budget prévisionnel ne les utilise pas.</p>
  </div>;
  if (role.isOwner) return <p className="rounded-xl bg-sand px-4 py-3 text-sm text-ink/75" data-testid="validation-policy">Un gestionnaire D.A.O. est affecté à ce chantier : il valide les métrés que vous soumettez.</p>;
  if (role.isAssignedManager || role.isAdmin) return <p className="rounded-xl bg-sand px-4 py-3 text-sm text-ink/75" data-testid="validation-policy">{role.isAssignedManager ? 'Vous êtes le gestionnaire affecté à ce chantier' : 'Vous intervenez comme administration D.A.O.'} : vous pouvez valider les métrés soumis. La validation est tracée et ne modifie jamais une révision.</p>;
  return null;
}

function WorkPicker({ works, templates, exclude, onPick, onClose }: { works: Map<string, Work>; templates: Map<string, Template>; exclude: string[]; onPick: (id: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const options = [...works.values()].filter(w => !exclude.includes(w.id))
    .filter(w => !q || norm(`${w.label} ${w.lot} ${w.subLot} ${w.aliases.join(' ')}`).includes(q)).sort((a, b) => a.order - b.order);
  return <div className="mt-4 rounded-xl bg-sand p-4">
    <div className="flex items-center gap-2">
      <label className="relative flex-1"><span className="sr-only">Rechercher un ouvrage</span><Search size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/45" />
        <input className={cn(fieldClass, 'pl-9')} value={query} onChange={e => setQuery(e.target.value)} placeholder="Rechercher : carrelage, mur, terrasse…" aria-label="Rechercher un ouvrage" autoFocus /></label>
      <button type="button" className={secondaryAction} onClick={onClose} aria-label="Fermer la recherche"><X size={15} aria-hidden="true" /></button>
    </div>
    <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto" aria-label="Ouvrages du référentiel">
      {options.length === 0 && <li className="px-2 py-2 text-sm text-ink/60">Aucun ouvrage correspondant dans le référentiel publié.</li>}
      {options.map(w => <li key={w.id}><button type="button" onClick={() => onPick(w.id)} className="flex min-h-11 w-full flex-wrap items-center gap-x-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal">
        <span className="font-semibold text-ink">{w.label}</span><span className="text-xs text-ink/60">{w.lot} › {w.subLot} · {sym(w.unitCode)}</span>
        {!templates.has(w.id) && <span className="text-xs text-amber-800">· pas encore calculable</span>}
      </button></li>)}
    </ul>
  </div>;
}

function WorkRow({ work, workId, template, takeoffs, selectedId, canWrite, fromAssistant, onSelect, onNew }: { work?: Work; workId: string; template?: Template; takeoffs: Takeoff[]; selectedId: string | null; canWrite: boolean; fromAssistant: boolean; onSelect: (id: string) => void; onNew: () => void }) {
  return <li className="rounded-xl border border-black/[0.06] p-3.5" data-testid="takeoff-work">
    <div className="flex flex-wrap items-start gap-2">
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink">{work?.label ?? 'Ouvrage retiré du référentiel publié'}</p>
        <p className="text-xs text-ink/60">{work ? `${work.lot} › ${work.subLot} · unité ${sym(work.unitCode)}` : workId}{fromAssistant ? ' · retenu avec l’assistant' : ''}</p>
      </div>
      {template && canWrite && <button type="button" className={cn(secondaryAction, 'min-h-10 px-3')} onClick={onNew} aria-label={`Nouveau métré : ${work?.label ?? ''}`}><Plus size={14} aria-hidden="true" />Nouveau métré</button>}
    </div>
    {!template && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">Aucun modèle de métré publié pour cet ouvrage : il n’est pas encore calculable. D.A.O. ne déduit aucune quantité ; le budget le signalera comme manquant.</p>}
    {template && work?.note && <p className="mt-2 text-xs text-ink/60">{work.note}</p>}
    {takeoffs.length > 0 && <ul className="mt-3 space-y-1.5">{takeoffs.map(t => <li key={t.id}>
      <button type="button" onClick={() => onSelect(t.id)} aria-pressed={selectedId === t.id} className={cn('flex min-h-11 w-full flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal', selectedId === t.id ? 'bg-teal/10' : 'bg-sand hover:bg-sand/70')}>
        <span className="min-w-0 flex-1 font-semibold text-ink">{t.label}<span className="block text-xs font-normal text-ink/60">Périmètre {t.scopeKey} · révision {t.currentRevision}</span></span>
        <span className="tabular-nums text-ink/80">{t.current?.status === 'calculated' ? `${fmt(t.current.justification?.result?.value)} ${sym(t.current.justification?.result?.unit)}` : 'Données insuffisantes'}</span>
        <Badge tone={STATUS_TONE[t.status]}>{STATUS_LABELS[t.status]}</Badge>
      </button>
    </li>)}</ul>}
  </li>;
}

function TakeoffEditor({ work, template, takeoff, takenScopes, busy, onCancel, onSubmit }: { work?: Work; template: Template; takeoff: Takeoff | null; takenScopes: string[]; busy: boolean; onCancel: () => void; onSubmit: (payload: { scope_key: string; label: string; inputs: Record<string, unknown> }) => Promise<boolean> }) {
  const fields = templateFields(template.inputSchema);
  const [label, setLabel] = useState(takeoff?.label ?? '');
  const [draft, setDraft] = useState<Record<string, TakeoffDraftField>>(() => Object.fromEntries(fields.map(name => {
    const prior = takeoff?.current?.inputs?.[name];
    const dimension = dimensionOf(name)!;
    return [name, prior ? { value: String(prior.original?.value ?? prior.value).replace('.', ','), unit: prior.original?.unit ?? prior.unit, kind: prior.source?.kind ?? '', reference: prior.source?.reference ?? '' }
      : { value: '', unit: dimension, kind: '', reference: '' }];
  })));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [labelError, setLabelError] = useState('');
  const scopeKey = takeoff?.scopeKey ?? uniqueScopeKey(scopeKeyFrom(label), takenScopes);
  const set = (name: string, patch: Partial<TakeoffDraftField>) => setDraft(d => ({ ...d, [name]: { ...d[name], ...patch } }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const check = checkDraft(fields, draft);
    setErrors(check.errors);
    const trimmed = label.trim();
    setLabelError(trimmed ? '' : 'Nommez ce métré (ex. Mur nord, Salle de bain RDC).');
    if (!trimmed || Object.keys(check.errors).length) return;
    await onSubmit({ scope_key: scopeKey, label: trimmed, inputs: check.inputs });
  }

  return <Card className="p-5 sm:p-6" data-testid="takeoff-editor">
    <SectionHeading eyebrow={takeoff ? `Recalcul — révision ${takeoff.currentRevision + 1}` : 'Nouveau métré'} title={work?.label ?? 'Ouvrage'} description={`Résultat en ${sym(template.outputUnitCode)} · formule : ${formulaText(template.formulaAst, template.inputSchema)}`} />
    <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
      <label className="block text-sm font-semibold text-ink">Nom du métré (pièce, mur, niveau…)
        <input aria-label="Nom du métré" className={cn(fieldClass, 'mt-2')} value={label} maxLength={160} onChange={e => setLabel(e.target.value)} placeholder="Ex. Mur nord, Salle de bain RDC" aria-invalid={Boolean(labelError)} aria-describedby="takeoff-label-hint" />
        <span id="takeoff-label-hint" className={cn('mt-1 block text-xs font-normal', labelError ? 'text-red-700' : 'text-ink/60')}>{labelError || `Périmètre : ${scopeKey}${takeoff ? ' (inchangé lors d’un recalcul)' : ''}`}</span>
      </label>
      {fields.map(name => {
        const d = draft[name]; const dimension = dimensionOf(name)!; const err = errors[name]; const hint = SOURCE_KINDS.find(s => s.kind === d.kind)?.hint ?? 'Plan, relevé, date de mesure…';
        const id = `f-${name}`;
        return <fieldset key={name} className={cn('rounded-xl p-3.5', err ? 'bg-red-50 ring-1 ring-red-200' : 'bg-sand')} aria-describedby={`${id}-help`}>
          <legend className="sr-only">{fieldLabel(name, template.inputSchema)}</legend>
          <p className="text-sm font-semibold text-ink" aria-hidden="true">{fieldLabel(name, template.inputSchema)} <span className="font-normal text-ink/55">({sym(dimension)})</span></p>
          <div className="mt-2 grid grid-cols-[minmax(0,1fr)_6rem] gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_minmax(0,1fr)]">
            <input aria-label={`${fieldLabel(name, template.inputSchema)} — valeur`} inputMode="decimal" autoComplete="off" className={fieldClass} value={d.value} onChange={e => set(name, { value: e.target.value })} placeholder="Ex. 12,5" aria-invalid={Boolean(err)} />
            <select aria-label={`${fieldLabel(name, template.inputSchema)} — unité`} className={fieldClass} value={d.unit} onChange={e => set(name, { unit: e.target.value })}>{INPUT_UNITS[dimension].map(u => <option key={u} value={u}>{sym(u)}</option>)}</select>
            <select aria-label={`${fieldLabel(name, template.inputSchema)} — provenance`} className={cn(fieldClass, 'col-span-2 sm:col-span-1')} value={d.kind} onChange={e => set(name, { kind: e.target.value as TakeoffDraftField['kind'] })}>
              <option value="">Provenance…</option>{SOURCE_KINDS.map(s => <option key={s.kind} value={s.kind}>{s.label}</option>)}
            </select>
          </div>
          <input aria-label={`${fieldLabel(name, template.inputSchema)} — référence`} className={cn(fieldClass, 'mt-2')} value={d.reference} maxLength={300} onChange={e => set(name, { reference: e.target.value })} placeholder={hint} />
          <p id={`${id}-help`} className={cn('mt-1 text-xs', err ? 'text-red-700' : 'text-ink/55')} role={err ? 'alert' : undefined}>{err || 'Laissez vide si inconnu : le métré restera en « données insuffisantes », sans valeur supposée.'}</p>
        </fieldset>;
      })}
      {template.assumptions.length > 0 && <ul className="list-disc space-y-1 pl-5 text-xs text-ink/65">{template.assumptions.map(a => <li key={a}>{a}</li>)}</ul>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="submit" className={primaryAction} disabled={busy}><Calculator size={15} aria-hidden="true" />{busy ? 'Calcul…' : 'Calculer et enregistrer'}</button>
        <button type="button" className={secondaryAction} onClick={onCancel} disabled={busy}>Annuler</button>
      </div>
      <p className="text-xs text-ink/55">Chaque calcul crée une révision immuable. Un recalcul après validation conserve la révision validée, qui reste la référence du budget jusqu’à une nouvelle validation.</p>
    </form>
  </Card>;
}

function TakeoffDetail({ takeoff, work, template, catalogVersion, role, busy, onRevise, onSubmit, onValidate }: { takeoff: Takeoff; work?: Work; template?: Template; catalogVersion: { id: string; code: string } | null; role: ViewerRole & { userId: string; clientId: string | null }; busy: boolean; onRevise: () => void; onSubmit: (note: string) => Promise<boolean>; onValidate: (note: string) => Promise<boolean> }) {
  const [note, setNote] = useState('');
  const cur = takeoff.current;
  const act = takeoffActions(role, { status: takeoff.status, currentStatus: cur?.status ?? null });
  const schema = template?.inputSchema ?? null;
  const j = cur?.justification ?? {};
  const actor = (id: string) => id === role.userId ? 'vous' : id === role.clientId ? 'le client' : 'l’équipe D.A.O.';
  const versionLabel = cur?.formula?.catalogVersionId && catalogVersion && catalogVersion.id === cur.formula.catalogVersionId ? catalogVersion.code : 'version antérieure du référentiel';
  const stale = takeoff.validatedRevision != null && takeoff.validatedRevision !== takeoff.currentRevision;
  return <Card className="p-5 sm:p-6" data-testid="takeoff-detail">
    <div className="flex flex-wrap items-center gap-2"><Badge tone={STATUS_TONE[takeoff.status]}>{STATUS_LABELS[takeoff.status]}</Badge><Badge>Révision {takeoff.currentRevision}</Badge>{takeoff.validatedRevision && <Badge tone="teal">Révision validée de référence : {takeoff.validatedRevision}</Badge>}</div>
    <h2 className="mt-3 text-lg font-bold text-ink">{takeoff.label}</h2>
    <p className="text-sm text-ink/65">{work?.label ?? takeoff.workId} · périmètre {takeoff.scopeKey}</p>

    {cur?.status === 'calculated'
      ? <div className="mt-4 rounded-xl bg-sand p-4"><p className="text-xs font-medium text-ink/65">Quantité calculée</p><p className="mt-1 text-2xl font-bold tabular-nums text-ink" data-testid="takeoff-result">{fmt(j.result?.value)} {sym(j.result?.unit)}</p>
          <p className="mt-1 text-xs text-ink/60">Valeur exacte {fmt(j.rawResult)} · arrondie à {j.result?.roundingScale} décimale(s)</p></div>
      : <div className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900" data-testid="takeoff-insufficient"><p className="font-semibold">Données insuffisantes : aucune quantité n’est produite.</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">{(j.missingFields ?? []).map((f: string) => <li key={f}>Renseignez « {fieldLabel(f, schema)} » ({sym(dimensionOf(f))}) avec sa provenance.</li>)}</ul></div>}

    {takeoff.status === 'submitted' && act.awaitingValidation && <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">
      En attente de validation technique. {role.hasAssignedManager ? 'Le gestionnaire affecté au chantier doit le valider.' : 'Aucun gestionnaire n’est affecté : seul un gestionnaire affecté ou l’administration D.A.O. peut le valider.'} Tant qu’il n’est pas validé, le budget prévisionnel ne l’utilise pas.</p>}
    {stale && <p className="mt-4 rounded-xl bg-teal/[0.07] p-3 text-sm text-ink/80">La révision {takeoff.currentRevision} n’est pas validée : la révision {takeoff.validatedRevision} ({fmt(takeoff.validated?.justification?.result?.value)} {sym(takeoff.validated?.justification?.result?.unit)}) reste la référence du budget prévisionnel.</p>}

    {(act.canSubmit || act.canValidate || act.canCalculate) && <div className="mt-5 space-y-3">
      {(act.canSubmit || act.canValidate) && <label className="block text-xs font-semibold text-ink/70">Note (facultative)<input aria-label="Note" className={cn(fieldClass, 'mt-1')} value={note} maxLength={1000} onChange={e => setNote(e.target.value)} placeholder={act.canValidate ? 'Ex. Dimensions vérifiées sur plan A-12' : 'Ex. Mesures prises le 03/11'} /></label>}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {act.canSubmit && <button type="button" className={primaryAction} disabled={busy} onClick={() => void onSubmit(note.trim()).then(ok => ok && setNote(''))}><Send size={15} aria-hidden="true" />Soumettre pour validation</button>}
        {act.canValidate && <button type="button" className={primaryAction} disabled={busy} onClick={() => void onValidate(note.trim()).then(ok => ok && setNote(''))}><ShieldCheck size={15} aria-hidden="true" />Valider la révision {takeoff.currentRevision}</button>}
        {act.canCalculate && template && <button type="button" className={secondaryAction} disabled={busy} onClick={onRevise}><Calculator size={15} aria-hidden="true" />{cur?.status === 'calculated' ? 'Corriger les dimensions' : 'Compléter les dimensions'}</button>}
      </div>
    </div>}

    {cur && <details className="group mt-5 rounded-xl border border-black/[0.06] [&_summary::-webkit-details-marker]:hidden" open>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3.5 py-2 text-sm font-semibold text-ink"><ClipboardCheck size={15} aria-hidden="true" />Calcul justifié<ChevronDown size={15} aria-hidden="true" className="ml-auto text-ink/50 transition group-open:rotate-180" /></summary>
      <div className="space-y-3 border-t border-black/[0.06] px-3.5 py-3 text-sm text-ink/80">
        <p><span className="font-semibold">Formule :</span> {formulaText(cur.formula?.ast ?? template?.formulaAst, schema)} = {sym(cur.formula?.outputUnitCode)}</p>
        <div className="overflow-x-auto"><table className="w-full min-w-[28rem] text-left text-xs"><caption className="sr-only">Dimensions saisies et conversions</caption>
          <thead><tr className="border-b border-black/10 text-ink/60"><th className="py-1.5 pr-2 font-medium">Dimension</th><th className="py-1.5 pr-2 font-medium">Saisie</th><th className="py-1.5 pr-2 font-medium">Convertie</th><th className="py-1.5 font-medium">Provenance</th></tr></thead>
          <tbody>{Object.entries(cur.inputs ?? {}).map(([name, v]: [string, any]) => <tr key={name} className="border-b border-black/[0.05] align-top">
            <td className="py-1.5 pr-2 font-semibold">{fieldLabel(name, schema)}</td><td className="py-1.5 pr-2 tabular-nums">{fmt(v.original?.value)} {sym(v.original?.unit)}</td>
            <td className="py-1.5 pr-2 tabular-nums">{fmt(v.value)} {sym(v.unit)}</td><td className="py-1.5">{SOURCE_LABEL[v.source?.kind] ?? v.source?.kind} — {v.source?.reference}</td></tr>)}</tbody></table></div>
        {Array.isArray(j.steps) && j.steps.length > 0 && <div><p className="font-semibold">Opérations</p><ol className="mt-1 list-decimal space-y-0.5 pl-5 text-xs tabular-nums">{j.steps.map((s: any, i: number) => <li key={i}>{
          s.op === 'identity' ? `${fieldLabel(s.field, schema)} = ${fmt(s.value)} ${sym(s.unit)}` : s.op === 'multiply' ? `Produit = ${fmt(s.value)} ${sym(s.unit)}` : s.op === 'subtract' ? `${fmt(s.left)} − ${fmt(s.right)} = ${fmt(s.value)} ${sym(s.unit)}` : JSON.stringify(s)}</li>)}</ol></div>}
        {(cur.formula?.assumptions ?? []).length > 0 && <div><p className="font-semibold">Hypothèses du modèle</p><ul className="mt-1 list-disc pl-5 text-xs">{cur.formula.assumptions.map((a: string) => <li key={a}>{a}</li>)}</ul></div>}
        <p className="text-xs text-ink/60">Modèle : {versionLabel} · source {cur.formula?.sourceRef ?? '—'} · moteur {cur.formula?.engineVersion ?? '—'} · révision du {when(cur.createdAt)} par {actor(cur.createdBy)}</p>
        <p className="break-all text-[11px] text-ink/50">Empreintes SHA-256 — entrées {cur.inputSha256?.slice(0, 16)}… · résultat {cur.resultSha256?.slice(0, 16)}…</p>
      </div>
    </details>}

    {stale && takeoff.validated && <div className="mt-5"><h3 className="text-sm font-bold text-ink">Comparaison avec la révision validée {takeoff.validatedRevision}</h3>
      <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[24rem] text-left text-xs"><thead><tr className="border-b border-black/10 text-ink/60"><th className="py-1.5 pr-2 font-medium">Dimension</th><th className="py-1.5 pr-2 font-medium">Révision {takeoff.currentRevision}</th><th className="py-1.5 font-medium">Validée ({takeoff.validatedRevision})</th></tr></thead>
        <tbody>{compareInputs(cur?.inputs, takeoff.validated.inputs).map(row => <tr key={row.field} className={cn('border-b border-black/[0.05]', row.changed && 'bg-amber-50')}><td className="py-1.5 pr-2 font-semibold">{fieldLabel(row.field, schema)}{row.changed && <span className="sr-only"> (modifiée)</span>}</td><td className="py-1.5 pr-2 tabular-nums">{fmt(row.current)}</td><td className="py-1.5 tabular-nums">{fmt(row.reference)}</td></tr>)}
          <tr className="font-semibold"><td className="py-1.5 pr-2">Résultat</td><td className="py-1.5 pr-2 tabular-nums">{cur?.status === 'calculated' ? `${fmt(j.result?.value)} ${sym(j.result?.unit)}` : 'Données insuffisantes'}</td><td className="py-1.5 tabular-nums">{fmt(takeoff.validated.justification?.result?.value)} {sym(takeoff.validated.justification?.result?.unit)}</td></tr></tbody></table></div></div>}

    <div className="mt-5"><h3 className="flex items-center gap-2 text-sm font-bold text-ink"><History size={15} aria-hidden="true" />Historique</h3>
      <ul className="mt-2 space-y-1.5" aria-label="Révisions">{takeoff.history.map(h => <li key={h.revision} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-sand px-3 py-2 text-xs">
        <span className="font-semibold text-ink">Révision {h.revision}</span><span className="tabular-nums">{h.status === 'calculated' ? `${fmt(h.result?.value)} ${sym(h.result?.unit)}` : 'Données insuffisantes'}</span>
        {takeoff.validatedRevision === h.revision && <Badge tone="teal">Validée</Badge>}<span className="ml-auto text-ink/55">{when(h.createdAt)} · {actor(h.createdBy)}</span></li>)}</ul>
      <ol className="mt-3 space-y-1 border-l border-black/10 pl-3 text-xs text-ink/70" aria-label="Événements">{takeoff.events.map(e => <li key={e.id}><span className="font-semibold text-ink">{EVENT_LABELS[e.type] ?? e.type}</span> · révision {e.revision} · {when(e.createdAt)} · {actor(e.actorId)}{e.validationBasis && VALIDATION_BASIS_LABELS[e.validationBasis] ? ` (${VALIDATION_BASIS_LABELS[e.validationBasis]})` : ''}{e.note ? ` — « ${e.note} »` : ''}</li>)}</ol>
    </div>
  </Card>;
}

function BudgetPanel({ projectId, estimate, error, works, takeoffs }: { projectId: string; estimate: any; error: string; works: Map<string, Work>; takeoffs: Takeoff[] }) {
  const result = estimate?.result;
  const coverage = result ? COVERAGE[result.coverage?.status] : null;
  const validated = takeoffs.filter(t => t.validatedRevision).length;
  const pending = takeoffs.filter(t => !t.validatedRevision).length;
  return <Card className="p-5 sm:p-6" data-testid="takeoff-budget">
    <SectionHeading eyebrow="Budget prévisionnel" title="Ce que le budget peut utiliser" description="Le budget prévisionnel lit seulement les métrés validés et les tarifs sourcés vérifiés. Aucun prix n’est affiché ici." />
    <p className="mt-3 text-sm text-ink/75">{validated} métré(s) validé(s) utilisable(s){pending ? ` · ${pending} métré(s) pas encore validé(s), ignoré(s) par le budget` : ''}.</p>
    {error && <p className="mt-3 text-sm text-red-700" role="alert">État du budget indisponible : {error}</p>}
    {result && coverage && <>
      <div className="mt-3 flex flex-wrap items-center gap-2"><Badge tone={coverage.tone}>{coverage.label}</Badge><span className="text-xs text-ink/60">{result.coverage.pricedLines}/{result.coverage.totalLines} ligne(s) chiffrée(s) · tarifs sourcés vérifiés uniquement</span></div>
      {result.lines?.length > 0 && <ul className="mt-3 space-y-1.5" aria-label="Causes par ligne">{result.lines.map((line: any) => <li key={`${line.workId}/${line.scopeKey}`} className="rounded-lg bg-sand px-3 py-2 text-xs">
        <span className="font-semibold text-ink">{line.workLabel ?? works.get(line.workId)?.label ?? line.workId}</span>
        <span className="text-ink/60"> · {line.quantitySource?.kind === 'takeoff' ? `métré validé (révision ${line.quantitySource.revision ?? '—'})` : line.quantitySource?.kind === 'declared' ? 'quantité déclarée' : 'sans quantité'}</span>
        {line.status === 'missing' ? <ul className="mt-1 list-disc pl-5 text-red-800">{(line.missing ?? []).map((c: string) => <li key={c}>{ESTIMATE_CAUSES[c] ?? c}</li>)}</ul> : <span className="text-emerald-800"> · chiffrée</span>}
      </li>)}</ul>}
    </>}
    <Link href={`/app/projects/${projectId}/estimate`} className={cn(secondaryAction, 'mt-4 w-full sm:w-auto')}>Ouvrir le budget prévisionnel</Link>
  </Card>;
}
