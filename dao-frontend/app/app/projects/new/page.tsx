'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Building2, CalendarDays, Info, MapPin, Search, Users, Wallet } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '../../../../lib/supabase-browser';
import CollaborativeProjectForm from '../../../../components/CollaborativeProjectForm';
import { cn } from '../../../../lib/utils';
import { ErrorPanel } from '../_components/ProjectUi';
import ClientTeamProjectForm from './_components/ClientTeamProjectForm';
import { controlClass, CreationHeader, describe, Field, FormAlert, formatDay, formatTnd, Panel, StepActions, Stepper, SummaryBlock } from './_components/CreationUi';

type Territory = { id: string; name_fr: string; governorate_id?: string; delegation_id?: string };
type FieldErrors = Record<string, string>;
const moneyToMillimes = (value: string) => value ? Math.round(Number(value) * 1000) : null;
const types = { construction: 'Construction', renovation: 'Rénovation', repair: 'Réparation', extension: 'Extension', other: 'Autre' };

export default function NewProject() {
  const [ready, setReady] = useState(false);
  const [contractor, setContractor] = useState(false);
  const [client, setClient] = useState(false);
  const [mode, setMode] = useState<'marketplace' | 'existing' | ''>('');
  useEffect(() => { void (async () => {
    const { data } = await supabaseBrowser().auth.getSession();
    if (data.session) {
      const { data: roles } = await supabaseBrowser().from('user_roles').select('role').eq('user_id', data.session.user.id);
      const isClient = Boolean(roles?.some(row => row.role === 'client'));
      const isContractor = Boolean(roles?.some(row => row.role === 'contractor'));
      setClient(isClient); setContractor(isContractor && !isClient);
    }
    setReady(true);
  })(); }, []);
  if (!ready) return <div aria-busy="true" className="mx-auto max-w-3xl space-y-6"><span className="sr-only">Chargement…</span><div className="h-5 w-28 animate-pulse rounded bg-ink/[0.07]" /><div className="h-9 w-2/3 animate-pulse rounded bg-ink/[0.08]" /><div className="grid gap-4 sm:grid-cols-2">{[0, 1].map(item => <div key={item} className="h-56 animate-pulse rounded-2xl border border-black/[0.04] bg-white" />)}</div></div>;
  if (contractor) return <CollaborativeProjectForm contractor />;
  if (!client) return <div className="mx-auto max-w-3xl"><ErrorPanel title="Création indisponible" message="Un compte client ou artisan est nécessaire pour créer un chantier." backHref="/app/projects" /></div>;
  if (mode === 'marketplace') return <MarketplaceProjectForm onCancel={() => setMode('')} />;
  if (mode === 'existing') return <ClientTeamProjectForm onCancel={() => setMode('')} />;
  const choices = [
    { id: 'marketplace' as const, icon: Search, title: 'Je cherche des professionnels', text: 'Préparer un DAO pour recevoir des offres.', steps: ['Décrivez le chantier et sa localisation', 'Structurez-le en lots de travaux', 'D.A.O. relit le dossier avant publication'] },
    { id: 'existing' as const, icon: Users, title: 'J’ai déjà mes artisans / entreprises', text: 'Inviter mon équipe et suivre mes travaux.', steps: ['Décrivez le chantier et son avancement', 'Un lot principal par artisan', 'Chaque artisan reçoit son lien d’invitation'] },
  ];
  return <section className="mx-auto max-w-4xl space-y-8">
    <CreationHeader backHref="/app/projects" eyebrow="Espace de travail" title="Nouveau chantier" description="Comment souhaitez-vous démarrer ? Vous pourrez compléter le chantier à tout moment après sa création." />
    <div className="grid gap-4 md:grid-cols-2">{choices.map(choice => { const Icon = choice.icon; return <button key={choice.id} type="button" onClick={() => setMode(choice.id)} className="group flex h-full flex-col rounded-2xl border border-black/[0.08] bg-white p-5 text-left shadow-[0_1px_2px_rgba(23,32,42,0.04)] transition hover:-translate-y-0.5 hover:border-teal/50 hover:shadow-[0_12px_30px_rgba(23,32,42,0.08)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:p-6">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal/10 text-teal"><Icon size={20} aria-hidden="true" /></span>
      <span className="mt-4 block text-lg font-bold leading-snug text-ink">{choice.title}</span>
      <span className="mt-1.5 block text-sm text-ink/70">{choice.text}</span>
      <span className="mt-5 block border-t border-black/[0.06] pt-4">{choice.steps.map((step, index) => <span key={step} className="mt-2 flex items-start gap-2.5 text-sm text-ink/80 first:mt-0"><span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sand text-[11px] font-bold text-ink/70">{index + 1}</span>{step}</span>)}</span>
      <span aria-hidden="true" className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-teal">Commencer<ArrowRight size={15} className="transition group-hover:translate-x-0.5 motion-reduce:transition-none" /></span>
    </button>; })}</div>
  </section>;
}

const marketplaceSteps = ['Projet', 'Localisation', 'Budget', 'Vérification'];
const stepTitles = ['Décrivez le projet', 'Situez le chantier', 'Budget et calendrier', 'Vérifiez les informations'];
const stepDescriptions = ['Un titre clair aide les professionnels à comprendre votre besoin.', 'La localisation publique sera limitée au territoire. L’adresse exacte se complète ensuite dans le projet privé.', 'Le budget est indicatif et exprimé en dinars tunisiens. Vous pourrez le préciser lot par lot.', 'Relisez votre dossier. Vous pourrez ajouter les lots et documents depuis la fiche projet.'];

function MarketplaceProjectForm({ onCancel }: { onCancel: () => void }) {
  const router = useRouter(); const panelRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ title: '', description: '', type: 'renovation', surface: '', budget: '', date: '', endDate: '', governorate: '', delegation: '', locality: '' });
  const [governorates, setGovernorates] = useState<Territory[]>([]); const [delegations, setDelegations] = useState<Territory[]>([]); const [localities, setLocalities] = useState<Territory[]>([]);
  const [territoryError, setTerritoryError] = useState(false);
  const [error, setError] = useState(''); const [fieldErrors, setFieldErrors] = useState<FieldErrors>({}); const [saving, setSaving] = useState(false);
  // Keep the id of a project already created so a retry after a failed update never creates a duplicate.
  const [createdId, setCreatedId] = useState('');
  const update = (key: keyof typeof form, value: string) => { setForm(current => ({ ...current, [key]: value, ...(key === 'governorate' ? { delegation: '', locality: '' } : {}), ...(key === 'delegation' ? { locality: '' } : {}) })); setFieldErrors(current => { const next = { ...current }; delete next[key]; if (key === 'date') delete next.endDate; return next; }); };
  useEffect(() => { void (async () => { const { data, error: loadError } = await supabaseBrowser().from('governorates').select('id,name_fr').order('name_fr'); setGovernorates(data ?? []); setTerritoryError(Boolean(loadError)); })(); }, []);
  useEffect(() => { if (!form.governorate) { setDelegations([]); return; } void (async () => { const { data } = await supabaseBrowser().from('delegations').select('id,name_fr,governorate_id').eq('governorate_id', form.governorate).order('name_fr'); setDelegations(data ?? []); })(); }, [form.governorate]);
  useEffect(() => { if (!form.delegation) { setLocalities([]); return; } void (async () => { const { data } = await supabaseBrowser().from('localities').select('id,name_fr,delegation_id').eq('delegation_id', form.delegation).order('name_fr'); setLocalities(data ?? []); })(); }, [form.delegation]);
  const firstStepRender = useRef(true);
  // On step change (not on first display), bring the new step to the top so mobile users see its title.
  useEffect(() => { if (firstStepRender.current) { firstStepRender.current = false; return; } panelRef.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }, [step]);
  const selected = useMemo(() => ({ governorate: governorates.find(item => item.id === form.governorate)?.name_fr, delegation: delegations.find(item => item.id === form.delegation)?.name_fr, locality: localities.find(item => item.id === form.locality)?.name_fr }), [delegations, form.delegation, form.governorate, form.locality, governorates, localities]);
  const fieldIds: Record<string, string> = { title: 'project-title', surface: 'project-surface', governorate: 'project-governorate', budget: 'project-budget', endDate: 'project-end' };

  /** Validates every step up to `nextStep - 1`; the summary message keeps the wording used before (E2E). */
  function validate(nextStep: number) {
    setError(''); const fields: FieldErrors = {}; let message = '';
    const set = (key: string, text: string, summary = text) => { fields[key] = text; if (!message) message = summary; };
    if (nextStep >= 2 && !form.title.trim()) set('title', 'Indiquez un titre pour le projet.', 'Ajoutez un titre pour votre projet.');
    if (nextStep >= 2 && form.surface && !(Number(form.surface) > 0)) set('surface', 'La surface doit être supérieure à 0.');
    if (nextStep >= 3 && !form.governorate) set('governorate', 'Choisissez le gouvernorat du chantier.', 'Choisissez au moins un gouvernorat.');
    if (nextStep >= 4 && form.budget && !(Number(form.budget) >= 0)) set('budget', 'Le budget doit être un montant positif.');
    if (form.date && form.endDate && form.endDate < form.date) set('endDate', 'Choisissez une date de fin égale ou postérieure au début.', 'La date de fin doit être postérieure ou égale à la date de début.');
    setFieldErrors(fields);
    if (message) { setError(message); const first = Object.keys(fields)[0]; window.setTimeout(() => document.getElementById(fieldIds[first])?.focus(), 0); return false; }
    return true;
  }
  function next() { if (validate(step + 1)) setStep(value => Math.min(4, value + 1)); }
  function previous() { setError(''); setFieldErrors({}); setStep(value => value - 1); }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (saving || !validate(4)) return;
    setSaving(true); setError('');
    try {
      const { data } = await supabaseBrowser().auth.getSession(); if (!data.session) { router.push('/auth/login'); return; }
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` };
      const fields = { project_type: form.type, surface_m2: form.surface ? Number(form.surface) : null, desired_start_date: form.date || null, desired_end_date: form.endDate || null, indicative_budget_millimes: moneyToMillimes(form.budget), governorate_id: form.governorate, delegation_id: form.delegation || null, locality_id: form.locality || null };
      let projectId = createdId;
      if (!projectId) {
        const created = await fetch('/api/projects', { method: 'POST', headers, body: JSON.stringify(fields) });
        const payload = await created.json().catch(() => ({}));
        if (!created.ok || !payload.data?.id) { setError(payload.error || 'Impossible de créer le projet.'); setSaving(false); return; }
        projectId = payload.data.id; setCreatedId(projectId);
      }
      const updated = await fetch('/api/projects', { method: 'PATCH', headers, body: JSON.stringify({ project_id: projectId, title: form.title, description: form.description, ...fields }) });
      const updatePayload = await updated.json().catch(() => ({}));
      if (!updated.ok) { setError(`${updatePayload.error || 'Projet créé mais informations incomplètes.'} Réessayez : le projet déjà créé sera complété, sans doublon.`); setSaving(false); return; }
      router.push(`/app/projects/${projectId}`);
    } catch {
      setError(createdId ? 'La connexion a été interrompue. Réessayez : le projet déjà créé sera complété, sans doublon.' : 'La connexion a été interrompue. Vérifiez dans Mes chantiers si le projet a été créé avant de réessayer.');
      setSaving(false);
    }
  }
  const budgetHint = form.budget && !fieldErrors.budget ? formatTnd(form.budget) || undefined : undefined;
  const location = [selected.governorate, selected.delegation, selected.locality].filter(Boolean).join(' · ');
  const icons = [Building2, MapPin, Wallet, Info];
  const StepIcon = icons[step - 1];

  return <section className="mx-auto max-w-3xl space-y-6">
    <CreationHeader eyebrow="Nouveau projet" title="Préparons votre chantier" description="Quelques étapes simples pour créer un dossier clair, prêt à recevoir des offres." onBack={step === 1 ? onCancel : undefined} backLabel="Changer de parcours" />
    <Stepper steps={marketplaceSteps} current={step - 1} />
    <div ref={panelRef} className="scroll-mt-24">
      <form noValidate onSubmit={event => { if (step < 4) { event.preventDefault(); next(); return; } void submit(event); }}>
        <Panel title={stepTitles[step - 1]} description={step === 4 ? stepDescriptions[3] : undefined}>
          {step !== 4 && <div className="mb-5 flex items-start gap-3 rounded-xl bg-sand/80 p-4 text-sm text-ink/75"><StepIcon size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-teal" /><p>{stepDescriptions[step - 1]}</p></div>}
          {step === 1 && <div className="grid gap-5">
            <Field id="project-title" label="Titre du projet" error={fieldErrors.title}><input {...describe('project-title', fieldErrors.title)} aria-label="Titre du projet" className={controlClass(fieldErrors.title)} required maxLength={200} value={form.title} onChange={event => update('title', event.target.value)} placeholder="Ex. Maison S+3 à Sahloul" /></Field>
            <Field id="project-description" label="Description" optional hint="Le besoin global, les pièces concernées ou vos priorités."><textarea {...describe('project-description', undefined, 'x')} aria-label="Description" className={cn(controlClass(), 'min-h-32 resize-y')} value={form.description} onChange={event => update('description', event.target.value)} placeholder="Décrivez le besoin global, les pièces concernées ou vos priorités." /></Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="project-type" label="Type de projet"><select id="project-type" aria-label="Type de projet" className={controlClass()} value={form.type} onChange={event => update('type', event.target.value)}>{Object.entries(types).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
              <Field id="project-surface" label="Surface (m²)" optional error={fieldErrors.surface}><input {...describe('project-surface', fieldErrors.surface)} aria-label="Surface (m²)" className={controlClass(fieldErrors.surface)} type="number" inputMode="decimal" min="1" value={form.surface} onChange={event => update('surface', event.target.value)} placeholder="180" /></Field>
            </div>
          </div>}
          {step === 2 && <>
            {territoryError && <p role="status" className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">La liste des gouvernorats n’a pas pu être chargée. Rechargez la page pour réessayer.</p>}
            <div className="grid gap-5 sm:grid-cols-3">
              <Field id="project-governorate" label="Gouvernorat" error={fieldErrors.governorate}><select {...describe('project-governorate', fieldErrors.governorate)} aria-label="Gouvernorat" required className={controlClass(fieldErrors.governorate)} value={form.governorate} onChange={event => update('governorate', event.target.value)}><option value="">Choisir…</option>{governorates.map(item => <option key={item.id} value={item.id}>{item.name_fr}</option>)}</select></Field>
              <Field id="project-delegation" label="Délégation" optional hint={!form.governorate ? 'Choisissez d’abord le gouvernorat.' : undefined}><select {...describe('project-delegation', undefined, !form.governorate ? 'x' : undefined)} aria-label="Délégation" className={controlClass()} disabled={!form.governorate} value={form.delegation} onChange={event => update('delegation', event.target.value)}><option value="">Choisir…</option>{delegations.map(item => <option key={item.id} value={item.id}>{item.name_fr}</option>)}</select></Field>
              <Field id="project-locality" label="Localité" optional hint={!form.delegation ? 'Choisissez d’abord la délégation.' : undefined}><select {...describe('project-locality', undefined, !form.delegation ? 'x' : undefined)} aria-label="Localité" className={controlClass()} disabled={!form.delegation} value={form.locality} onChange={event => update('locality', event.target.value)}><option value="">Choisir…</option>{localities.map(item => <option key={item.id} value={item.id}>{item.name_fr}</option>)}</select></Field>
            </div>
          </>}
          {step === 3 && <div className="grid gap-5 sm:grid-cols-3">
            <Field id="project-budget" label="Budget indicatif (TND)" optional error={fieldErrors.budget} hint={budgetHint}><input {...describe('project-budget', fieldErrors.budget, budgetHint)} aria-label="Budget indicatif (TND)" className={controlClass(fieldErrors.budget)} type="number" inputMode="decimal" min="0" step="0.001" value={form.budget} onChange={event => update('budget', event.target.value)} placeholder="150000" /></Field>
            <Field id="project-start" label="Début souhaité" hint="Nécessaire avant la revue du DAO."><input {...describe('project-start', undefined, 'x')} aria-label="Début souhaité" className={controlClass()} type="date" value={form.date} onChange={event => update('date', event.target.value)} /></Field>
            <Field id="project-end" label="Fin souhaitée" error={fieldErrors.endDate} hint="Nécessaire avant la revue du DAO."><input {...describe('project-end', fieldErrors.endDate, 'x')} aria-label="Fin souhaitée" className={controlClass(fieldErrors.endDate)} type="date" min={form.date || undefined} value={form.endDate} onChange={event => update('endDate', event.target.value)} /></Field>
          </div>}
          {step === 4 && <div className="grid gap-3 sm:grid-cols-2">
            <SummaryBlock title="Projet" onEdit={() => setStep(1)} editLabel="Modifier le projet"><p className="break-words font-semibold">{form.title}</p><p className="mt-0.5 text-ink/70">{types[form.type as keyof typeof types]}{form.surface ? ` · ${form.surface} m²` : ''}</p></SummaryBlock>
            <SummaryBlock title="Localisation" onEdit={() => setStep(2)} editLabel="Modifier la localisation"><p className="flex items-start gap-1.5 font-semibold"><MapPin size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-ink/55" />{location || 'À préciser'}</p></SummaryBlock>
            <SummaryBlock title="Budget" onEdit={() => setStep(3)} editLabel="Modifier le budget"><p className="font-semibold tabular-nums">{form.budget ? formatTnd(form.budget) : 'À préciser'}</p></SummaryBlock>
            <SummaryBlock title="Calendrier" onEdit={() => setStep(3)} editLabel="Modifier le calendrier"><p className="flex items-start gap-1.5 font-semibold"><CalendarDays size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-ink/55" />{form.date ? formatDay(form.date) : 'À préciser'}{form.endDate ? ` → ${formatDay(form.endDate)}` : ''}</p>{(!form.date || !form.endDate) && <p className="mt-1 text-xs text-amber-800">Les deux dates seront nécessaires avant la revue du DAO.</p>}</SummaryBlock>
            {form.description && <SummaryBlock title="Description" onEdit={() => setStep(1)} editLabel="Modifier la description"><p className="whitespace-pre-wrap text-ink/80">{form.description}</p></SummaryBlock>}
          </div>}
          {error && <FormAlert>{error}</FormAlert>}
          <StepActions onPrevious={step > 1 ? previous : undefined} previousDisabled={saving} primaryLabel={step < 4 ? 'Continuer' : saving ? 'Création…' : 'Créer le projet'} busy={saving} />
        </Panel>
      </form>
    </div>
  </section>;
}
