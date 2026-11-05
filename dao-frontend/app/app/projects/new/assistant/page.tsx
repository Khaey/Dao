'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, CircleHelp, Info, Loader2, MapPin, RotateCcw, Sparkles, Wand2 } from 'lucide-react';
import { supabaseBrowser } from '../../../../../lib/supabase-browser';
import { fetchMySettings } from '../../../../../lib/settings';
import { cn } from '../../../../../lib/utils';
import { primaryAction, secondaryAction } from '../../_components/ProjectUi';
import { controlClass, CreationHeader, FormAlert, Panel } from '../_components/CreationUi';

/*
 * Assistant BTP (Coordinateur Mission 1) — parcours court :
 * description libre → proposition immédiate → corrections → création du chantier.
 * Aucune donnée n'est inventée ici : tout vient de l'API, elle-même fondée sur le référentiel.
 */

type Kind = 'construction' | 'renovation' | 'extension' | 'other';
type Item = { id: string; code: string; kind: 'lot' | 'sub_lot' | 'work'; parentId: string | null; label: string; unit: string | null; relevance: 'usual' | 'verify' | 'conditional' | 'optional' | 'unusual'; selected: boolean; origin: string | null; tentative: boolean };
type Fact = { key: string; label: string; value: string; status: 'known' | 'proposed' | 'to_confirm' };
type Proposal = {
  title: string; summary: string; facts: Fact[]; question: { key: string; text: string } | null; items: Item[];
  lastCommand: { message: string; applied: unknown[] } | null; limitations: string[];
  referential: { provider: string; catalogVersion: string; completeness: 'fixture' | 'partial' | 'complete' };
  engine: { mode: string }; governorateStatus: string;
};
type Draft = { draftId: string; revision: number; status: string; projectType: Kind; title: string; description: string; governorateId: string | null; updatedAt: string; proposal: Proposal };
type Territory = { id: string; name_fr: string };

const KINDS: Array<[Kind, string]> = [['construction', 'Construction neuve'], ['renovation', 'Rénovation'], ['extension', 'Extension'], ['other', 'Autre']];
// #577 — questions guidées, une à la fois, toutes facultatives (« Passer » / « Je ne sais pas »).
const SPACES: Array<[string, string]> = [['house', 'Maison / villa'], ['apartment', 'Appartement'], ['shop', 'Local commercial'], ['office', 'Bureau'], ['unknown', 'Autre / je ne sais pas']];
const SPACE_TEXT: Record<string, string> = { house: 'Maison', apartment: 'Appartement', shop: 'Local commercial', office: 'Locaux de bureaux' };
const NATURES: Array<[string, string, Kind | null]> = [['construction', 'Construction', 'construction'], ['renovation', 'Rénovation', 'renovation'], ['extension', 'Extension', 'extension'], ['repair', 'Réparation', 'renovation'], ['other', 'Autre', 'other']];
const GUIDE_STEPS = ['Lieu', 'Travaux', 'Surface', 'Description'];
const EXAMPLES = [
  'Villa R+1 à Sousse sur un terrain de 206 m², 2 chambres à l’étage, garage, cuisine séparée, 2 salles de bain, jardin et terrasse si possible, sans piscine.',
  'Rénover mon appartement à Tunis : refaire la salle de bain et la cuisine, changer le carrelage et repeindre.',
  'Extension de ma maison à Nabeul : ajouter une chambre et une salle d’eau au rez-de-chaussée.',
];
const RELEVANCE: Record<Item['relevance'], { label: string; className: string }> = {
  usual: { label: 'Habituel', className: 'bg-teal/10 text-teal' },
  verify: { label: 'À vérifier', className: 'bg-amber-50 text-amber-900' },
  conditional: { label: 'Selon votre situation', className: 'bg-sand text-ink/75' },
  optional: { label: 'Facultatif', className: 'bg-sand text-ink/75' },
  unusual: { label: 'Inhabituel — à vérifier', className: 'bg-amber-50 text-amber-900' },
};
const FACT_STATUS: Record<Fact['status'], { label: string; className: string }> = {
  known: { label: 'Connu', className: 'bg-teal/10 text-teal' },
  proposed: { label: 'Proposé', className: 'bg-sky-50 text-sky-900' },
  to_confirm: { label: 'À confirmer', className: 'bg-amber-50 text-amber-900' },
};

async function authHeaders() {
  const { data } = await supabaseBrowser().auth.getSession();
  if (!data.session) return null;
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` };
}

export default function ProjectAssistantPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<'loading' | 'describe' | 'proposal'>('loading');
  const [resumable, setResumable] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<Kind | ''>('');
  const [guideStep, setGuideStep] = useState(0);
  const [guide, setGuide] = useState<{ space: string; nature: string; surface: string }>({ space: '', nature: '', surface: '' });
  const [assistantOff, setAssistantOff] = useState(false);
  const [command, setCommand] = useState('');
  const [answer, setAnswer] = useState('');
  const [governorates, setGovernorates] = useState<Territory[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const creationKey = useRef('');
  const headingRef = useRef<HTMLHeadingElement>(null);

  const call = useCallback(async (method: 'GET' | 'POST', body?: Record<string, unknown>) => {
    const headers = await authHeaders();
    if (!headers) { router.push('/auth/login'); return null; }
    const response = await fetch('/api/projects/assistant', { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(payload.error || 'Assistant temporairement indisponible.'), { status: response.status });
    return payload.data;
  }, [router]);

  useEffect(() => { void (async () => {
    try {
      const [current, territories, settings] = await Promise.all([call('GET'), supabaseBrowser().from('governorates').select('id,name_fr').order('name_fr'), fetchMySettings('client').catch(() => null)]);
      setGovernorates(territories.data ?? []);
      // #577 — réglage Settings : l'assistant masqué renvoie vers la création manuelle (la base refuse aussi).
      const entry = settings?.settings['client.project_assistant'];
      if (entry && (entry.value === false || entry.state === 'unavailable')) { setAssistantOff(true); setPhase('describe'); return; }
      if (current) setResumable(current);
    } catch (e: any) { if (e.status === 403) setAssistantOff(true); else setError(e.message); }
    setPhase('describe');
  })(); }, [call]);

  useEffect(() => { if (phase === 'proposal') headingRef.current?.focus(); }, [phase]);

  async function run(body: Record<string, unknown>, success?: string) {
    if (busy) return; setBusy(true); setError(''); setStatus('');
    try {
      const data = await call('POST', body);
      if (data) { setDraft(data); setPhase('proposal'); if (success || data.proposal?.lastCommand?.message) setStatus(data.proposal?.lastCommand?.message ?? success); }
      return data;
    } catch (e: any) {
      if (e.status === 403 && !draft) setAssistantOff(true);
      setError(e.status === 409 ? `${e.message} Votre brouillon est conservé.` : e.message);
    } finally { setBusy(false); }
  }

  async function analyze(event: FormEvent) {
    event.preventDefault();
    const nature = NATURES.find(([value]) => value === guide.nature);
    const surface = Number(guide.surface.replace(',', '.'));
    // Les réponses guidées sont reprises en clair dans la description : l'assistant les lit comme le reste,
    // sans en déduire de quantité (la surface reste une information, jamais un métré).
    const preamble = [SPACE_TEXT[guide.space], nature && nature[0] !== 'other' ? (nature[0] === 'repair' ? 'Travaux de réparation' : nature[1]) : '', surface > 0 ? `Surface d’environ ${guide.surface.replace('.', ',')} m²` : ''].filter(Boolean).join('. ');
    const full = [preamble, description.trim()].filter(Boolean).join('. ');
    if (full.length < 3) { setError('Décrivez votre projet en quelques mots.'); document.getElementById('assistant-description')?.focus(); return; }
    creationKey.current = '';
    const projectType = kind || nature?.[2] || null;
    await run({ action: 'analyze', description: full.slice(0, 4000), ...(projectType ? { projectType } : {}) });
  }
  const edit = (patch: Record<string, unknown>, success?: string) => draft && run({ action: 'edit', draftId: draft.draftId, expectedRevision: draft.revision, ...patch }, success);

  async function applyCommand(event: FormEvent) {
    event.preventDefault();
    if (command.trim().length < 2) return;
    const done = await edit({ command: command.trim() });
    if (done) setCommand('');
  }

  async function restart() {
    const target = draft ?? resumable;
    if (target) { try { await call('POST', { action: 'abandon', draftId: target.draftId }); } catch { /* le brouillon reste repris plus tard */ } }
    setDraft(null); setResumable(null); setStatus(''); setError(''); setPhase('describe');
  }

  async function create() {
    if (!draft || busy) return;
    if (!draft.governorateId) { setError('Indiquez le gouvernorat du chantier.'); document.getElementById('assistant-governorate')?.focus(); return; }
    creationKey.current ||= (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '');
    setBusy(true); setError('');
    try {
      const data = await call('POST', { action: 'create', draftId: draft.draftId, creationKey: creationKey.current });
      if (data?.projectId) router.push(`/app/projects/${data.projectId}?tab=lots`);
    } catch (e: any) { setError(`${e.message} Réessayer ne créera pas de doublon.`); setBusy(false); }
  }

  if (phase === 'loading') return <div aria-busy="true" className="mx-auto max-w-3xl space-y-4"><span className="sr-only">Chargement…</span><div className="h-9 w-2/3 animate-pulse rounded bg-ink/[0.08]" /><div className="h-48 animate-pulse rounded-2xl bg-white" /></div>;

  if (assistantOff) return <section className="mx-auto max-w-3xl space-y-6">
    <CreationHeader backHref="/app/projects/new" backLabel="Changer de parcours" eyebrow="Assistant D.A.O." title="Assistant indisponible" description="L’assistant de création n’est pas activé pour votre compte. Vous pouvez créer votre chantier manuellement : lots, sous-lots et ouvrages restent disponibles." />
    <a href="/app/projects/new#creer-manuellement" className={cn(primaryAction, 'w-full sm:w-auto')}>Créer manuellement</a>
  </section>;

  if (phase === 'describe' || !draft) {
    const pick = (key: 'space' | 'nature', value: string) => { setGuide(g => ({ ...g, [key]: value })); setError(''); setGuideStep(s => s + 1); };
    const chip = (active: boolean) => cn('inline-flex min-h-11 items-center justify-center rounded-xl border px-3.5 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal', active ? 'border-teal bg-teal/10 text-teal' : 'border-black/10 bg-white text-ink hover:bg-sand');
    const skip = <button type="button" className={cn(secondaryAction, 'w-full sm:w-auto')} onClick={() => setGuideStep(s => s + 1)}>Passer</button>;
    const back = guideStep > 0 ? <button type="button" className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-ink/70 hover:text-teal" onClick={() => setGuideStep(s => s - 1)}>Retour</button> : null;
    const answered = [SPACES.find(([v]) => v === guide.space)?.[1], NATURES.find(([v]) => v === guide.nature)?.[1], guide.surface ? `${guide.surface} m²` : ''].filter(Boolean);
    return <section className="mx-auto max-w-3xl space-y-6">
    <CreationHeader backHref="/app/projects/new" backLabel="Changer de parcours" eyebrow="Assistant D.A.O." title="Décrivez votre projet" description="Une question à la fois, toutes facultatives. L’assistant propose ensuite les lots et ouvrages ; vous corrigez avant de créer le chantier." />
    {resumable && <div role="status" className="flex flex-col gap-3 rounded-2xl border border-teal/30 bg-teal/5 p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-ink"><span className="font-semibold">Brouillon en cours :</span> {resumable.title}</p>
      <div className="flex gap-2"><button type="button" className={primaryAction} onClick={() => { setDraft(resumable); setPhase('proposal'); }}>Reprendre</button><button type="button" className={secondaryAction} onClick={() => void restart()}>Recommencer</button></div>
    </div>}
    <ol className="flex gap-1.5" aria-label="Étapes de l’assistant">{GUIDE_STEPS.map((label, index) => <li key={label} aria-current={index === guideStep ? 'step' : undefined} className="min-w-0 flex-1"><span className={cn('block h-1.5 rounded-full', index <= guideStep ? 'bg-teal' : 'bg-ink/10')} /><span className={cn('mt-1 block truncate text-[11px]', index === guideStep ? 'font-semibold text-ink' : 'text-ink/55')}>{label}</span></li>)}</ol>
    {guideStep === 0 && <Panel title="Quel type de lieu ?">
      <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2" role="group" aria-label="Type de lieu">{SPACES.map(([value, label]) => <button key={value} type="button" aria-pressed={guide.space === value} className={chip(guide.space === value)} onClick={() => pick('space', value)}>{label}</button>)}</div>
      <div className="mt-5 flex flex-col gap-2 border-t border-black/[0.06] pt-4 sm:flex-row sm:items-center sm:justify-between">
        <button type="button" className={cn(secondaryAction, 'w-full sm:w-auto')} onClick={() => setGuideStep(3)}>Décrire directement</button>
        <p className="text-xs text-ink/60">Écrivez votre besoin avec vos mots, sans questions.</p>
      </div>
    </Panel>}
    {guideStep === 1 && <Panel title="Quelle nature de travaux ?">
      <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2" role="group" aria-label="Nature des travaux">{NATURES.map(([value, label]) => <button key={value} type="button" aria-pressed={guide.nature === value} className={chip(guide.nature === value)} onClick={() => pick('nature', value)}>{label}</button>)}</div>
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">{back}{skip}</div>
    </Panel>}
    {guideStep === 2 && <Panel title="Quelle surface, si vous la connaissez ?">
      <form noValidate onSubmit={event => { event.preventDefault(); setGuideStep(3); }}>
        <label htmlFor="assistant-surface" className="block text-sm font-semibold text-ink">Surface approximative (m²) <span className="ml-1 text-xs font-medium text-ink/65">facultatif</span></label>
        <input id="assistant-surface" inputMode="decimal" className={cn(controlClass(), 'mt-2 sm:max-w-xs')} value={guide.surface} onChange={event => setGuide(g => ({ ...g, surface: event.target.value.replace(/[^0-9.,]/g, '').slice(0, 8) }))} placeholder="Ex. 120" />
        <p className="mt-1.5 text-xs text-ink/65">Une simple indication : aucune quantité n’en est déduite. Les dimensions se renseignent plus tard, ouvrage par ouvrage.</p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">{back}<div className="flex flex-col gap-2 sm:flex-row">
          <button type="button" className={cn(secondaryAction, 'w-full sm:w-auto')} onClick={() => { setGuide(g => ({ ...g, surface: '' })); setGuideStep(3); }}>Je ne sais pas</button>
          <button type="submit" className={cn(primaryAction, 'w-full sm:w-auto')}>Continuer</button></div></div>
      </form>
    </Panel>}
    {guideStep === 3 && <form noValidate onSubmit={event => void analyze(event)}>
      <Panel title="Votre projet">
        {answered.length > 0 && <p className="mb-4 flex flex-wrap items-center gap-2 text-xs text-ink/70">Vos réponses :{answered.map(a => <span key={a} className="rounded-full bg-sand px-2.5 py-1 font-semibold text-ink">{a}</span>)}</p>}
        {answered.length === 0 && <fieldset className="mb-5">
          <legend className="text-sm font-semibold text-ink">Type de projet <span className="ml-1 text-xs font-medium text-ink/65">facultatif — détecté depuis votre texte</span></legend>
          <div className="mt-2 flex flex-wrap gap-2">{KINDS.map(([value, label]) => <label key={value} className={cn('inline-flex min-h-11 cursor-pointer items-center rounded-xl border px-3.5 text-sm font-medium transition focus-within:outline focus-within:outline-2 focus-within:outline-teal', kind === value ? 'border-teal bg-teal/10 text-teal' : 'border-black/10 bg-white text-ink hover:bg-sand')}>
            <input type="radio" name="assistant-kind" value={value} checked={kind === value} onChange={() => setKind(value)} onClick={() => kind === value && setKind('')} className="sr-only" />{label}</label>)}</div>
        </fieldset>}
        <div>
          <label htmlFor="assistant-description" className="block text-sm font-semibold text-ink">Description libre</label>
          <textarea id="assistant-description" aria-describedby="assistant-description-hint" className={cn(controlClass(), 'mt-2 min-h-40 resize-y')} maxLength={3800} value={description} onChange={event => setDescription(event.target.value)} placeholder="Ex. refaire la salle de bain et la cuisine, changer le carrelage, sans toucher au salon…" />
          <p id="assistant-description-hint" className="mt-1.5 text-xs text-ink/65">Pièces, niveaux, ce que vous voulez ou ne voulez pas. {answered.length ? 'Facultatif si vos réponses suffisent. ' : ''}{description.length}/3800</p>
        </div>
        <div className="mt-4"><p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink/65">Exemples</p><div className="mt-2 grid gap-2">{EXAMPLES.map(example => <button key={example} type="button" onClick={() => setDescription(example)} className="min-h-11 rounded-xl bg-sand/80 px-3.5 py-2 text-left text-sm text-ink/80 transition hover:bg-sand focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal">{example}</button>)}</div></div>
        {error && <FormAlert>{error}</FormAlert>}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">{guideStep > 0 && answered.length > 0 ? back : <span />}<button type="submit" className={cn(primaryAction, 'w-full sm:w-auto')} disabled={busy} aria-busy={busy || undefined}>{busy ? <Loader2 size={16} aria-hidden="true" className="animate-spin" /> : <Wand2 size={16} aria-hidden="true" />}{busy ? 'Analyse…' : 'Voir la proposition'}</button></div>
      </Panel>
    </form>}
    {guideStep < 3 && error && <FormAlert>{error}</FormAlert>}
  </section>;
  }

  return <ProposalView draft={draft} governorates={governorates} busy={busy} error={error} status={status} headingRef={headingRef}
    command={command} setCommand={setCommand} answer={answer} setAnswer={setAnswer}
    onCommand={applyCommand} onEdit={edit} onRestart={() => void restart()} onCreate={() => void create()} />;
}

function ProposalView({ draft, governorates, busy, error, status, headingRef, command, setCommand, answer, setAnswer, onCommand, onEdit, onRestart, onCreate }: {
  draft: Draft; governorates: Territory[]; busy: boolean; error: string; status: string; headingRef: React.RefObject<HTMLHeadingElement | null>;
  command: string; setCommand: (v: string) => void; answer: string; setAnswer: (v: string) => void;
  onCommand: (e: FormEvent) => void; onEdit: (patch: Record<string, unknown>, success?: string) => unknown; onRestart: () => void; onCreate: () => void;
}) {
  const { proposal } = draft;
  const children = useMemo(() => { const map = new Map<string | null, Item[]>(); for (const item of proposal.items) map.set(item.parentId, [...(map.get(item.parentId) ?? []), item]); return map; }, [proposal.items]);
  const lots = children.get(null) ?? [];
  const selectedLots = lots.filter(lot => lot.selected);
  const otherLots = lots.filter(lot => !lot.selected);
  const toggle = (item: Item) => onEdit({ toggle: { itemId: item.id, selected: !item.selected } }, `${item.selected ? 'Retiré' : 'Ajouté'} : ${item.label}.`);
  const canCreate = Boolean(draft.governorateId) && selectedLots.length > 0;

  return <section className="mx-auto max-w-4xl space-y-6" aria-busy={busy || undefined}>
    <CreationHeader onBack={onRestart} backLabel="Recommencer" eyebrow="Proposition de l’assistant" title={proposal.title} description={proposal.summary} />
    <h2 ref={headingRef} tabIndex={-1} className="sr-only">Proposition : {proposal.title}</h2>
    <p className="flex flex-wrap items-center gap-2 text-xs text-ink/70">
      <span className="inline-flex items-center gap-1 rounded-full bg-sand px-2.5 py-1"><Sparkles size={12} aria-hidden="true" />Proposition établie par règles à partir du référentiel (sans IA générative)</span>
      <span className={cn('rounded-full px-2.5 py-1', proposal.referential.completeness === 'complete' ? 'bg-teal/10 text-teal' : 'bg-amber-50 text-amber-900')}>
        {proposal.referential.completeness === 'fixture' ? 'Référentiel provisoire (données de démonstration)' : proposal.referential.completeness === 'partial' ? 'Référentiel en cours de constitution' : 'Référentiel D.A.O.'} · version {proposal.referential.catalogVersion}
      </span>
      <span className="rounded-full bg-sand px-2.5 py-1">Brouillon enregistré · révision {draft.revision}</span>
    </p>
    <div aria-live="polite" className="min-h-0">{status && <p className="flex items-start gap-2 rounded-xl bg-teal/5 px-4 py-3 text-sm text-ink"><Check size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-teal" />{status}</p>}</div>
    {error && <FormAlert>{error}</FormAlert>}

    {proposal.question && <section aria-labelledby="assistant-question" className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 sm:p-5">
      <h2 id="assistant-question" className="flex items-start gap-2 text-sm font-semibold text-ink"><CircleHelp size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-amber-800" />{proposal.question.text}</h2>
      {proposal.question.key === 'project_type'
        ? <div className="mt-3 flex flex-wrap gap-2">{KINDS.filter(([v]) => v !== 'other').map(([value, label]) => <button key={value} type="button" disabled={busy} className={secondaryAction} onClick={() => onEdit({ projectType: value }, `Type de projet : ${label}.`)}>{label}</button>)}</div>
        : <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={event => { event.preventDefault(); if (answer.trim()) { void Promise.resolve(onEdit({ answer: answer.trim() }, 'Réponse prise en compte.')).then(() => setAnswer('')); } }}>
          <label htmlFor="assistant-answer" className="sr-only">Votre réponse</label>
          <input id="assistant-answer" className={controlClass()} maxLength={500} value={answer} onChange={event => setAnswer(event.target.value)} placeholder="Ex. la cuisine et la salle de bain" />
          <button type="submit" className={secondaryAction} disabled={busy || !answer.trim()}>Répondre</button>
        </form>}
      <p className="mt-2 text-xs text-ink/65">Vous pouvez aussi ignorer cette question et corriger directement la liste.</p>
    </section>}

    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-6">
        <Panel title="Lots et ouvrages proposés" description="Cochez ou décochez. Chaque élément provient du référentiel ; rien n’est ajouté sans votre accord.">
          {selectedLots.length === 0 && <p className="rounded-xl bg-sand/80 p-4 text-sm text-ink/75">Aucun lot retenu pour l’instant. Ajoutez-en un ci-dessous ou décrivez-le avec vos mots.</p>}
          <ul className="space-y-4">{selectedLots.map(lot => <li key={lot.id}><LotCard lot={lot} childrenOf={children} busy={busy} onToggle={toggle} /></li>)}</ul>
          {otherLots.length > 0 && <details className="mt-5 rounded-xl border border-black/[0.06] p-4">
            <summary className="min-h-11 cursor-pointer text-sm font-semibold text-teal">Autres lots possibles ({otherLots.length})</summary>
            <ul className="mt-3 space-y-2">{otherLots.map(lot => <li key={lot.id} className="flex items-center justify-between gap-3 text-sm"><span>{lot.label} <Badge relevance={lot.relevance} /></span><button type="button" disabled={busy} className={secondaryAction} onClick={() => toggle(lot)} aria-label={`Ajouter le lot ${lot.label}`}>Ajouter</button></li>)}</ul>
          </details>}
        </Panel>

        <Panel title="Modifier avec vos mots">
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={onCommand}>
            <label htmlFor="assistant-command" className="sr-only">Modifier avec vos mots</label>
            <input id="assistant-command" aria-describedby="assistant-command-hint" className={controlClass()} maxLength={500} value={command} onChange={event => setCommand(event.target.value)} placeholder="Ex. ajoute une terrasse, retire le garage" />
            <button type="submit" className={primaryAction} disabled={busy || command.trim().length < 2}>{busy ? <Loader2 size={16} aria-hidden="true" className="animate-spin" /> : null}Appliquer</button>
          </form>
          <p id="assistant-command-hint" className="mt-1.5 text-xs text-ink/65">Vos choix précédents sont conservés. Seuls des éléments du référentiel peuvent être ajoutés.</p>
        </Panel>
      </div>

      <aside className="space-y-6">
        <Panel title="Ce que j’ai compris">
          <dl className="space-y-2.5 text-sm">{proposal.facts.map(fact => <div key={fact.key} className="flex flex-col gap-0.5">
            <dt className="flex items-center gap-2 text-xs font-semibold text-ink/65">{fact.label}<span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', FACT_STATUS[fact.status].className)}>{FACT_STATUS[fact.status].label}</span></dt>
            <dd className="break-words text-ink">{fact.value}</dd>
          </div>)}</dl>
          <div className="mt-4 border-t border-black/[0.06] pt-4">
            <label htmlFor="assistant-type" className="block text-xs font-semibold text-ink/65">Type de projet</label>
            <select id="assistant-type" className={cn(controlClass(), 'mt-1')} disabled={busy} value={draft.projectType} onChange={event => onEdit({ projectType: event.target.value }, 'Type de projet mis à jour.')}>{KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          </div>
        </Panel>
        <Panel title="Ce que l’assistant ne fait pas">
          <ul className="space-y-2 text-sm text-ink/75">{proposal.limitations.map(limit => <li key={limit} className="flex items-start gap-2"><Info size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-ink/55" />{limit}</li>)}</ul>
        </Panel>
      </aside>
    </div>

    <Panel title="Créer mon chantier" description="Le chantier est créé en brouillon : vous pourrez tout modifier, ajouter dates et documents avant la revue D.A.O.">
      <label htmlFor="assistant-governorate" className="flex items-center gap-1.5 text-sm font-semibold text-ink"><MapPin size={14} aria-hidden="true" />Gouvernorat</label>
      <select id="assistant-governorate" className={cn(controlClass(!draft.governorateId && error ? 'x' : undefined), 'mt-2 sm:max-w-sm')} disabled={busy} value={draft.governorateId ?? ''} onChange={event => event.target.value && onEdit({ governorateId: event.target.value }, 'Gouvernorat enregistré.')}>
        <option value="">Choisir…</option>{governorates.map(item => <option key={item.id} value={item.id}>{item.name_fr}</option>)}
      </select>
      {draft.governorateId && proposal.governorateStatus === 'proposed' && <p className="mt-1.5 text-xs text-amber-900">Déduit de votre description : vérifiez-le.</p>}
      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button type="button" className={secondaryAction} onClick={onRestart} disabled={busy}><RotateCcw size={15} aria-hidden="true" />Recommencer</button>
        <button type="button" className={primaryAction} onClick={onCreate} disabled={busy || !canCreate} aria-describedby={!canCreate ? 'assistant-create-hint' : undefined}>Créer mon chantier</button>
      </div>
      {!canCreate && <p id="assistant-create-hint" className="mt-2 text-xs text-ink/70 sm:text-right">{!draft.governorateId ? 'Choisissez le gouvernorat pour créer le chantier.' : 'Gardez au moins un lot.'}</p>}
    </Panel>
  </section>;
}

function Badge({ relevance, tentative }: { relevance: Item['relevance']; tentative?: boolean }) {
  const meta = tentative ? { label: 'Si possible', className: 'bg-amber-50 text-amber-900' } : RELEVANCE[relevance];
  return <span className={cn('ml-1.5 inline-block rounded-full px-2 py-0.5 align-middle text-[11px] font-semibold', meta.className)}>{meta.label}</span>;
}

function ItemCheck({ item, busy, onToggle, strong }: { item: Item; busy: boolean; onToggle: (item: Item) => void; strong?: boolean }) {
  return <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1.5">
    <input type="checkbox" checked={item.selected} disabled={busy} onChange={() => onToggle(item)} className="mt-1 h-4 w-4 shrink-0 accent-[#0f766e]" />
    <span className={cn('text-sm', strong ? 'font-semibold text-ink' : 'text-ink/85', !item.selected && 'text-ink/60')}>{item.label}<Badge relevance={item.relevance} tentative={item.tentative} />{item.unit && item.kind === 'work' && <span className="ml-1.5 text-[11px] text-ink/55">unité prévue : {item.unit}</span>}</span>
  </label>;
}

function LotCard({ lot, childrenOf, busy, onToggle }: { lot: Item; childrenOf: Map<string | null, Item[]>; busy: boolean; onToggle: (item: Item) => void }) {
  const subs = childrenOf.get(lot.id) ?? [];
  const hidden = subs.filter(sub => !sub.selected).length + subs.flatMap(sub => sub.selected ? (childrenOf.get(sub.id) ?? []).filter(w => !w.selected) : []).length;
  return <article className="rounded-xl border border-black/[0.08] p-3 sm:p-4">
    <ItemCheck item={lot} busy={busy} onToggle={onToggle} strong />
    <ul className="ml-7 space-y-1">{subs.filter(sub => sub.selected).map(sub => <li key={sub.id}>
      <ItemCheck item={sub} busy={busy} onToggle={onToggle} />
      <ul className="ml-7">{(childrenOf.get(sub.id) ?? []).filter(work => work.selected).map(work => <li key={work.id}><ItemCheck item={work} busy={busy} onToggle={onToggle} /></li>)}</ul>
    </li>)}</ul>
    {hidden > 0 && <details className="ml-7 mt-1">
      <summary className="min-h-11 cursor-pointer py-2 text-xs font-semibold text-teal">Autres possibilités dans ce lot ({hidden})</summary>
      <ul>{subs.map(sub => sub.selected
        ? (childrenOf.get(sub.id) ?? []).filter(w => !w.selected).map(work => <li key={work.id}><ItemCheck item={work} busy={busy} onToggle={onToggle} /></li>)
        : <li key={sub.id}><ItemCheck item={sub} busy={busy} onToggle={onToggle} /></li>)}</ul>
    </details>}
  </article>;
}
