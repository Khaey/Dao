'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Copy, Lock, Plus, Trash2, Users } from 'lucide-react';
import { supabaseBrowser } from '../../../../../lib/supabase-browser';
import { paymentLabels, projectApi, stageLabels } from '../../../../../lib/collaboration';
import { cn } from '../../../../../lib/utils';
import InvitationEmailButton from '../../../../../components/InvitationEmailButton';
import { primaryAction, secondaryAction } from '../../_components/ProjectUi';
import { controlClass, CreationHeader, describe, Field, FormAlert, formatTnd, Panel, StepActions, Stepper, SummaryBlock } from './CreationUi';

/*
 * Parcours Client « J'ai déjà mes artisans / entreprises » (#203).
 * Interface Client isolée de CollaborativeProjectForm (partagé avec l'Artisan, #161) :
 * même appel POST /api/projects (project_origin = client_existing_team), mêmes champs,
 * budgets en millimes, création atomique côté serveur. Seule la présentation change.
 */

type Trade = { id: string; name_fr: string };
type ArtisanDraft = { key: number; recipientName: string; email: string; tradeId: string; lotTitle: string; budget: string };
type TeamInvitation = { id: string; token: string; recipientName: string; email: string; lotTitle: string; requestId: string; link: string };
type FieldErrors = Record<string, string>;

const moneyToMillimes = (value: string) => value.trim() === '' ? null : Math.round(Number(value) * 1000);
const steps = ['Chantier', 'État', 'Artisans + lots', 'Récapitulatif'];
const stageHints: Record<string, string> = { not_started: 'Les travaux n’ont pas encore démarré.', started: 'Les premiers travaux viennent de commencer.', in_progress: 'Le chantier est bien engagé.', completed: 'Les travaux sont achevés.' };
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ClientTeamProjectForm({ onCancel }: { onCancel: () => void }) {
  const nextArtisanKey = useRef(2); const panelRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState(''); const [description, setDescription] = useState('');
  const [governorate, setGovernorate] = useState(''); const [territories, setTerritories] = useState<{ id: string; name_fr: string }[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]); const [referenceError, setReferenceError] = useState(false);
  const [stage, setStage] = useState('not_started'); const [payment, setPayment] = useState('not_set'); const [privateAccess, setPrivateAccess] = useState(false);
  const [artisans, setArtisans] = useState<ArtisanDraft[]>([{ key: 1, recipientName: '', email: '', tradeId: '', lotTitle: '', budget: '' }]);
  const [projectId, setProjectId] = useState(''); const [teamInvitations, setTeamInvitations] = useState<TeamInvitation[]>([]);
  const [error, setError] = useState(''); const [fieldErrors, setFieldErrors] = useState<FieldErrors>({}); const [saving, setSaving] = useState(false);
  const [copiedInvitationId, setCopiedInvitationId] = useState('');

  useEffect(() => {
    const supabase = supabaseBrowser();
    void Promise.all([
      supabase.from('governorates').select('id,name_fr').order('name_fr'),
      supabase.from('trades').select('id,name_fr').eq('active', true).order('name_fr'),
    ]).then(([territoryResult, tradeResult]) => {
      setTerritories(territoryResult.data ?? []); setTrades(tradeResult.data ?? []);
      setReferenceError(Boolean(territoryResult.error || tradeResult.error));
    });
  }, []);
  const firstStepRender = useRef(true);
  // On step change (not on first display), bring the new step to the top so mobile users see its title.
  useEffect(() => { if (firstStepRender.current) { firstStepRender.current = false; return; } panelRef.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }, [step]);

  const updateArtisan = (key: number, patch: Partial<ArtisanDraft>) => { setArtisans(current => current.map(item => item.key === key ? { ...item, ...patch } : item)); setFieldErrors(current => { const next = { ...current }; for (const field of Object.keys(patch)) delete next[`${key}.${field}`]; return next; }); };
  const addArtisan = () => setArtisans(current => [...current, { key: nextArtisanKey.current++, recipientName: '', email: '', tradeId: '', lotTitle: '', budget: '' }]);
  const removeArtisan = (key: number) => setArtisans(current => current.length === 1 ? current : current.filter(item => item.key !== key));
  const clearField = (name: string) => setFieldErrors(current => { const next = { ...current }; delete next[name]; return next; });

  /** Même règle et mêmes messages que le formulaire partagé, avec en plus l'erreur placée sur le champ. */
  function validateTeam(): { message: string; fields: FieldErrors } {
    const fields: FieldErrors = {}; let message = '';
    const set = (key: string, text: string) => { fields[key] = text; if (!message) message = text; };
    const emails = new Map<string, number>();
    artisans.forEach((artisan, index) => {
      const number = index + 1;
      if (!artisan.recipientName.trim()) set(`${artisan.key}.recipientName`, `Renseignez le nom de l’artisan ${number}.`);
      if (!artisan.email.trim()) set(`${artisan.key}.email`, `Renseignez l’email de l’artisan ${number}.`);
      else if (!emailPattern.test(artisan.email.trim())) set(`${artisan.key}.email`, `L’email de l’artisan ${number} n’est pas valide.`);
      if (!artisan.tradeId) set(`${artisan.key}.tradeId`, `Choisissez le métier de l’artisan ${number}.`);
      if (!artisan.lotTitle.trim()) set(`${artisan.key}.lotTitle`, `Renseignez le titre du lot principal de l’artisan ${number}.`);
      if (artisan.budget.trim() && (!Number.isFinite(Number(artisan.budget)) || Number(artisan.budget) < 0)) set(`${artisan.key}.budget`, `Le budget du lot ${number} est invalide.`);
      const normalized = artisan.email.trim().toLowerCase();
      if (normalized) { if (emails.has(normalized)) set(`${artisan.key}.email`, 'Chaque artisan doit avoir une adresse e-mail différente. Pour une entreprise multi-lots, invitez-la sur son lot principal puis ajoutez les autres lots après son acceptation.'); else emails.set(normalized, artisan.key); }
    });
    return { message, fields };
  }

  function focusFirst(fields: FieldErrors) {
    const first = Object.keys(fields)[0]; if (!first) return;
    const [key, field] = first.split('.');
    const id = field ? `artisan-${key}-${field}` : first;
    window.setTimeout(() => document.getElementById(id)?.focus(), 0);
  }

  function next(event: FormEvent) {
    event.preventDefault(); setError('');
    if (step === 1) {
      const fields: FieldErrors = {};
      if (!title.trim()) fields['team-title'] = 'Indiquez le titre du chantier.';
      if (!governorate) fields['team-location'] = 'Choisissez le gouvernorat du chantier.';
      if (Object.keys(fields).length) { setFieldErrors(fields); setError('Renseignez le titre et la localisation du chantier.'); focusFirst(fields); return; }
    }
    if (step === 3) {
      const { message, fields } = validateTeam();
      if (message) { setFieldErrors(fields); setError(message); focusFirst(fields); return; }
    }
    setFieldErrors({}); setStep(value => value + 1);
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (saving || projectId) return;
    const { message, fields } = validateTeam();
    if (message) { setFieldErrors(fields); setError(message); setStep(3); return; }
    setSaving(true); setError(''); setCopiedInvitationId('');
    try {
      const result = await projectApi<{ id: string; invitations: any[] }>('/api/projects', {
        project_origin: 'client_existing_team',
        title: title.trim(),
        description: description.trim(),
        governorate_id: governorate,
        project_stage: stage,
        payment_status: payment,
        team: artisans.map(item => ({
          recipient_name: item.recipientName.trim(),
          recipient_email: item.email.trim().toLowerCase(),
          trade_id: item.tradeId,
          lot_title: item.lotTitle.trim(),
          budget_millimes: moneyToMillimes(item.budget),
          can_view_private_details: privateAccess,
        })),
      });
      setProjectId(result.id);
      setTeamInvitations((result.invitations ?? []).map(item => ({ id: item.id, token: item.token, recipientName: item.recipient_name, email: item.recipient_email, lotTitle: item.lot_title, requestId: item.request_id, link: `${window.location.origin}/invite/${item.token}` })));
    } catch (exception: any) {
      // A network failure may hide a creation that succeeded: never encourage a blind retry.
      const offline = exception instanceof TypeError || /fetch|network/i.test(String(exception?.message));
      setError(offline ? 'La connexion a été interrompue. Vérifiez dans Mes chantiers si le chantier a été créé avant de réessayer.' : exception.message || 'Création impossible pour le moment.');
    } finally { setSaving(false); }
  }

  const tradeName = (id: string) => trades.find(item => item.id === id)?.name_fr;
  const territoryName = territories.find(item => item.id === governorate)?.name_fr;

  if (teamInvitations.length > 0) return <section className="mx-auto max-w-3xl space-y-6">
    <CreationHeader backHref="/app/projects" eyebrow="Nouveau chantier" title="Créer un chantier avec mon équipe" description="Votre chantier est prêt. Transmettez maintenant chaque invitation à son destinataire." />
    <Panel title="Chantier et invitations prêts">
      <div className="flex items-start gap-3 rounded-xl border border-teal/20 bg-teal/[0.06] p-4"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal text-white"><Check size={17} aria-hidden="true" /></span><div className="min-w-0"><p role="status" className="font-semibold text-teal">{teamInvitations.length} artisan{teamInvitations.length > 1 ? 's' : ''} · {teamInvitations.length} lot{teamInvitations.length > 1 ? 's' : ''} principal{teamInvitations.length > 1 ? 'aux' : ''}</p><p className="mt-1 text-sm text-ink/70">Chaque artisan rejoindra automatiquement son lot principal après acceptation. Vous pourrez ensuite lui rattacher d’autres lots depuis le chantier.</p></div></div>
      <ul className="mt-5 space-y-4">{teamInvitations.map((item, index) => <li key={item.id} className="rounded-2xl border border-black/[0.08] p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-wide text-teal">Artisan {index + 1}</p><h3 className="mt-1 break-words font-bold text-ink">{item.recipientName}</h3><p className="break-all text-sm text-ink/70">{item.email}</p><p className="mt-2 text-sm text-ink"><span className="text-ink/65">Lot principal :</span> <strong className="font-semibold">{item.lotTitle}</strong></p></div><div className="shrink-0 [&_button]:min-h-11"><InvitationEmailButton invitation={{ id: item.id, token: item.token, hasEmail: true }} /></div></div>
        <label className="mt-4 block text-xs font-semibold text-ink/70">Lien d’invitation<input aria-label={`Lien d’invitation de ${item.recipientName}`} value={item.link} readOnly onFocus={event => event.currentTarget.select()} className={cn(controlClass(), 'mt-1.5 font-mono text-xs')} /></label>
        <button type="button" className={cn(secondaryAction, 'mt-3')} onClick={async () => { try { await navigator.clipboard.writeText(item.link); setCopiedInvitationId(item.id); } catch { setError('Sélectionnez et copiez le lien ci-dessus.'); } }}>{copiedInvitationId === item.id ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}{copiedInvitationId === item.id ? 'Lien copié' : 'Copier le lien'}</button>
      </li>)}</ul>
      {error && <FormAlert>{error}</FormAlert>}
      <div className="mt-6 border-t border-black/[0.06] pt-5"><Link href={`/app/projects/${projectId}?tab=team`} className={cn(primaryAction, 'w-full sm:w-auto')}>Ouvrir le chantier<ArrowRight size={16} aria-hidden="true" /></Link></div>
    </Panel>
  </section>;

  return <section className="mx-auto max-w-3xl space-y-6">
    <CreationHeader eyebrow="Nouveau chantier" title="Créer un chantier avec mon équipe" description="Préparez en une fois le chantier, les lots principaux et les invitations de votre équipe." onBack={step === 1 ? onCancel : undefined} backLabel="Changer de parcours" />
    <Stepper steps={steps} current={step - 1} />
    {referenceError && <p role="status" className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">Les listes de gouvernorats ou de métiers n’ont pas pu être chargées. Rechargez la page pour réessayer.</p>}
    <div ref={panelRef} className="scroll-mt-24">
      <form onSubmit={step === 4 ? create : next} noValidate>
        {step === 1 && <Panel title="Le chantier" description="Ces informations identifient le chantier auprès de votre équipe.">
          <div className="grid gap-5">
            <Field id="team-title" label="Titre du chantier" error={fieldErrors['team-title']}><input {...describe('team-title', fieldErrors['team-title'])} aria-label="Titre du chantier" className={controlClass(fieldErrors['team-title'])} required maxLength={200} value={title} placeholder="Ex. Rénovation de l’appartement Lac 2" onChange={event => { setTitle(event.target.value); clearField('team-title'); }} /></Field>
            <Field id="team-description" label="Description courte" optional hint="Ce que vos artisans doivent savoir en ouvrant le chantier."><textarea {...describe('team-description', undefined, 'x')} aria-label="Description courte" className={cn(controlClass(), 'min-h-24 resize-y')} value={description} onChange={event => setDescription(event.target.value)} /></Field>
            <Field id="team-location" label="Localisation" error={fieldErrors['team-location']} hint="Seul le territoire sera affiché dans l’invitation. L’adresse exacte reste privée."><select {...describe('team-location', fieldErrors['team-location'], 'x')} aria-label="Localisation" className={controlClass(fieldErrors['team-location'])} required value={governorate} onChange={event => { setGovernorate(event.target.value); clearField('team-location'); }}><option value="">Choisir un gouvernorat</option>{territories.map(item => <option key={item.id} value={item.id}>{item.name_fr}</option>)}</select></Field>
          </div>
          {error && <FormAlert>{error}</FormAlert>}
          <StepActions primaryLabel="Continuer" />
        </Panel>}

        {step === 2 && <Panel title="Où en est le chantier ?" description="Information déclarative, sans effet sur les travaux ni sur le DAO.">
          <fieldset><legend className="text-sm font-semibold text-ink">Quel est l’avancement actuel du chantier ?</legend>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">{Object.entries(stageLabels).map(([value, label]) => <div key={value} className={cn('rounded-xl border transition', stage === value ? 'border-teal bg-teal/[0.06] ring-1 ring-teal/30' : 'border-black/10 bg-white hover:border-black/20')}>
              <label className="flex min-h-12 cursor-pointer items-center gap-3 px-4 pt-3 text-sm font-semibold text-ink"><input type="radio" name="stage" value={value} checked={stage === value} onChange={() => setStage(value)} aria-describedby={`stage-${value}-hint`} className="h-5 w-5 shrink-0 accent-teal" />{label}</label>
              <p id={`stage-${value}-hint`} className="px-4 pb-3 pl-12 text-xs text-ink/65">{stageHints[value]}</p>
            </div>)}</div>
          </fieldset>
          <Field id="team-payment" label="Situation du paiement — optionnel" className="mt-6" hint="Déclaratif : aucun paiement n’est déclenché."><select {...describe('team-payment', undefined, 'x')} aria-label="Situation du paiement — optionnel" className={controlClass()} value={payment} onChange={event => setPayment(event.target.value)}>{Object.entries(paymentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
          {error && <FormAlert>{error}</FormAlert>}
          <StepActions onPrevious={() => { setError(''); setStep(1); }} primaryLabel="Continuer" />
        </Panel>}

        {step === 3 && <Panel title="Votre équipe et ses lots principaux" description="1 artisan = 1 lot principal. Si une entreprise réalise plusieurs lots, indiquez ici son lot principal puis rattachez-lui les autres lots après son acceptation.">
          <ul className="space-y-4">{artisans.map((artisan, index) => { const err = (field: string) => fieldErrors[`${artisan.key}.${field}`]; const id = (field: string) => `artisan-${artisan.key}-${field}`; return <li key={artisan.key} className="rounded-2xl border border-black/[0.08] p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-3"><div className="flex items-center gap-3"><span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full bg-teal/10 text-sm font-bold text-teal">{index + 1}</span><div><p className="text-xs font-bold uppercase tracking-wide text-teal">Artisan {index + 1}</p><p className="text-xs text-ink/65">Coordonnées + lot principal</p></div></div>{artisans.length > 1 && <button type="button" className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-red-700 transition hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-600" onClick={() => removeArtisan(artisan.key)}><Trash2 size={15} aria-hidden="true" />Retirer</button>}</div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id={id('recipientName')} label="Nom de l’artisan / entreprise" error={err('recipientName')}><input {...describe(id('recipientName'), err('recipientName'))} aria-label={`Nom de l’artisan ${index + 1}`} className={controlClass(err('recipientName'))} value={artisan.recipientName} onChange={event => updateArtisan(artisan.key, { recipientName: event.target.value })} maxLength={160} autoComplete="organization" required /></Field>
              <Field id={id('email')} label="Email" error={err('email')}><input {...describe(id('email'), err('email'))} aria-label={`Email de l’artisan ${index + 1}`} type="email" inputMode="email" autoComplete="email" className={controlClass(err('email'))} value={artisan.email} onChange={event => updateArtisan(artisan.key, { email: event.target.value })} required /></Field>
              <Field id={id('tradeId')} label="Métier" error={err('tradeId')}><select {...describe(id('tradeId'), err('tradeId'))} aria-label={`Métier de l’artisan ${index + 1}`} className={controlClass(err('tradeId'))} value={artisan.tradeId} onChange={event => updateArtisan(artisan.key, { tradeId: event.target.value })} required><option value="">Choisir un métier</option>{trades.map(item => <option key={item.id} value={item.id}>{item.name_fr}</option>)}</select></Field>
              <Field id={id('lotTitle')} label="Titre du lot principal" error={err('lotTitle')}><input {...describe(id('lotTitle'), err('lotTitle'))} aria-label={`Titre du lot de l’artisan ${index + 1}`} placeholder="Ex. Plomberie sanitaire" className={controlClass(err('lotTitle'))} value={artisan.lotTitle} onChange={event => updateArtisan(artisan.key, { lotTitle: event.target.value })} maxLength={200} required /></Field>
              <Field id={id('budget')} label="Budget indicatif du lot (TND)" optional error={err('budget')} className="sm:col-span-2"><input {...describe(id('budget'), err('budget'))} aria-label={`Budget du lot de l’artisan ${index + 1}`} type="number" inputMode="decimal" min="0" step="0.001" className={controlClass(err('budget'))} value={artisan.budget} onChange={event => updateArtisan(artisan.key, { budget: event.target.value })} /></Field>
            </div>
          </li>; })}</ul>
          <button type="button" className={cn(secondaryAction, 'mt-4 w-full sm:w-auto')} onClick={addArtisan}><Plus size={16} aria-hidden="true" />Ajouter un autre artisan</button>
          <label className="mt-5 flex min-h-11 items-start gap-3 rounded-xl bg-sand/80 px-4 py-3 text-sm text-ink"><input type="checkbox" checked={privateAccess} onChange={event => setPrivateAccess(event.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-teal" /><span className="flex items-start gap-1.5"><Lock size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-ink/55" />Autoriser les professionnels invités à accéder aux coordonnées privées du chantier après acceptation</span></label>
          {error && <FormAlert>{error}</FormAlert>}
          <StepActions onPrevious={() => { setError(''); setFieldErrors({}); setStep(2); }} primaryLabel="Continuer" />
        </Panel>}

        {step === 4 && <Panel title="Vérifier avant de créer le chantier" description="La création est atomique : le chantier, les lots principaux et les invitations sont préparés ensemble. Aucun DAO n’est publié automatiquement.">
          <div className="grid gap-3 sm:grid-cols-2">
            <SummaryBlock title="Chantier" onEdit={() => setStep(1)} editLabel="Modifier le chantier"><p className="break-words font-semibold">{title}</p><p className="mt-0.5 text-ink/70">{territoryName ?? 'Localisation à préciser'}</p>{description && <p className="mt-1.5 whitespace-pre-wrap text-ink/70">{description}</p>}</SummaryBlock>
            <SummaryBlock title="État déclaré" onEdit={() => setStep(2)} editLabel="Modifier l’état du chantier"><p className="font-semibold">{stageLabels[stage]}</p><p className="mt-0.5 text-ink/70">Paiement : {paymentLabels[payment]}</p></SummaryBlock>
            <SummaryBlock title={`Équipe préparée · ${artisans.length} artisan${artisans.length > 1 ? 's' : ''}`} onEdit={() => setStep(3)} editLabel="Modifier l’équipe"><ul className="mt-1 divide-y divide-black/[0.06]">{artisans.map((artisan, index) => <li key={artisan.key} className="py-2 first:pt-0 last:pb-0"><p className="font-semibold">{index + 1}. {artisan.recipientName} <span className="font-normal text-ink/70">· {tradeName(artisan.tradeId) || 'Métier'}</span></p><p className="text-ink/70">{artisan.lotTitle}{artisan.budget ? ` · ${formatTnd(artisan.budget)}` : ''}</p><p className="break-all text-xs text-ink/65">{artisan.email}</p></li>)}</ul></SummaryBlock>
            <SummaryBlock title="Accès aux coordonnées privées"><p className="flex items-center gap-1.5"><Users size={14} aria-hidden="true" className="text-ink/55" />{privateAccess ? 'Autorisé après acceptation' : 'Non autorisé'}</p></SummaryBlock>
          </div>
          {error && <FormAlert>{error}</FormAlert>}
          <StepActions onPrevious={() => { setError(''); setStep(3); }} previousDisabled={saving} primaryLabel={saving ? 'Création…' : 'Créer le chantier et préparer les invitations'} busy={saving} />
        </Panel>}
      </form>
    </div>
  </section>;
}
