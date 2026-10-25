'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ChevronRight, ClipboardCheck, FolderPlus, Hourglass, Inbox, Mail, MessageSquare, Plus, Search } from 'lucide-react';
import { supabaseBrowser } from '../../lib/supabase-browser';
import { Badge, Card } from '../../components/ui';
import { stageLabels } from '../../lib/collaboration';
import { effectiveProjectStatus, displayProjectStatus } from '../../lib/utils';
import { primaryAction, secondaryAction, StatusPill } from './projects/_components/ProjectUi';
import { useClientOffers } from '../../components/projects/offer-signals';
import { readAgreement } from '../../lib/precontract';
import ReviewInvitation from './_components/ReviewInvitation';
import { AwardedProjects, useAwardedWork } from '../../components/artisan/AwardedWork';

type Row = { id: string; status: string; project_type: string; surface_m2?: number | null; indicative_budget_millimes?: number | null; created_at: string; title?: string; lots?: number; client_id: string | null; initiator_id:string; project_origin:string; project_stage: string; projectStatus: string; versionStatus?: string | null; versionNo?: number | null };
const typeLabels: Record<string, string> = { construction: 'Construction', renovation: 'Rénovation', repair: 'Réparation', extension: 'Extension', other: 'Autre' };
const formatTnd = (value?: number | null) => value == null ? 'Budget à préciser' : new Intl.NumberFormat('fr-TN', { style: 'currency', currency: 'TND', maximumFractionDigits: 3 }).format(Number(value) / 1000);

export default function Dashboard() {
  const [contractor, setContractor] = useState(false);
  const awarded = useAwardedWork(contractor);
  const [name, setName] = useState(''); const [rows, setRows] = useState<Row[]>([]); const [loading, setLoading] = useState(true);
  const [lots, setLots] = useState<{ id: string; project_id: string }[]>([]); const [showAll, setShowAll] = useState(false);
  const clientIds = useMemo(() => contractor ? [] : rows.filter(row => ['open', 'published', 'closed'].includes(row.projectStatus)).map(row => row.id), [rows, contractor]);
  const offerSignals = useClientOffers(clientIds, lots, !loading && !contractor);
  const agreements = useClientAgreements(clientIds, !loading && !contractor);
  useEffect(() => { void (async () => {
    const supabase = supabaseBrowser();
    const [{ data: user }, projects, versions, requests] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from('projects').select('id,status,project_type,surface_m2,indicative_budget_millimes,created_at,client_id,initiator_id,project_origin,project_stage').order('created_at', { ascending: false }),
      supabase.from('project_versions').select('project_id,title,status,version_no').order('version_no', { ascending: false }),
      supabase.from('project_requests').select('id,project_id').neq('status', 'withdrawn'),
    ]);
    let contractorMode=false;let profileName:string|null=null;if (user.user) { const [{ data: roles }, { data: profile }] = await Promise.all([supabase.from('user_roles').select('role').eq('user_id', user.user.id),supabase.from('profiles').select('display_name,last_workspace').eq('user_id',user.user.id).maybeSingle()]); const hasContractor=Boolean(roles?.some(row=>row.role==='contractor')); const hasClient=Boolean(roles?.some(row=>row.role==='client')); contractorMode=hasContractor&&(!hasClient||profile?.last_workspace==='contractor');profileName=profile?.display_name??null;setContractor(contractorMode); }
    setName(profileName ?? user.user?.user_metadata?.display_name ?? user.user?.email?.split('@')[0] ?? '');
    const latest = new Map<string, any>(); for (const version of versions.data ?? []) if (!latest.has(version.project_id)) latest.set(version.project_id, version);
    const lotCounts = new Map<string, number>(); for (const request of requests.data ?? []) lotCounts.set(request.project_id, (lotCounts.get(request.project_id) ?? 0) + 1);
    setLots((requests.data ?? []) as { id: string; project_id: string }[]);
    setRows((projects.data ?? []).filter(project=>{if(!user.user)return false;return contractorMode?(project.client_id!==user.user.id||(project.project_origin==='contractor_existing_client'&&project.initiator_id===user.user.id)):project.client_id===user.user.id}).map(project => { const version = latest.get(project.id); return { ...project, status: effectiveProjectStatus(project.status, version?.status), projectStatus: project.status, versionStatus: version?.status ?? null, versionNo: version?.version_no ?? null, title: version?.title, lots: lotCounts.get(project.id) ?? 0 }; }));
    setLoading(false);
  })(); }, []);
  if (loading) return <div className="space-y-6" aria-busy="true"><p role="status" className="sr-only">Chargement du tableau de bord…</p><div className="h-10 w-64 animate-pulse rounded-xl bg-black/5" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{[0, 1, 2, 3, 4].map((key) => <div key={key} className="h-28 animate-pulse rounded-2xl bg-black/5" />)}</div><div className="h-36 animate-pulse rounded-2xl bg-black/5" /></div>;
  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

  if (contractor) return <section className="space-y-8">
    <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
      <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-teal">Tableau de bord artisan</p><h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Bonjour {name}</h1><p className="mt-2 max-w-xl text-sm text-black/55">Retrouvez vos chantiers clients, invitations et offres.</p></div>
    </div>
    {!awarded.ready
      ? <Card aria-busy="true" className="p-5"><p className="text-sm text-black/60">Chargement de vos attributions…</p></Card>
      : awarded.failed
        ? <Card className="space-y-3 p-5"><p role="alert" className="text-sm font-semibold text-red-700">Vos chantiers attribués sont momentanément indisponibles. Leur absence ne signifie pas que vous n’avez remporté aucun lot.</p><button type="button" onClick={() => window.location.reload()} className="min-h-11 rounded-xl border border-black/10 px-4 text-sm font-semibold text-teal">Réessayer</button></Card>
        : <AwardedProjects projects={awarded.projects} />}
    <Card className="p-5 sm:p-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div><h2 className="text-xl font-bold text-ink">Mes chantiers clients</h2><p className="mt-1 text-sm text-black/55">Vos chantiers confirmés et ceux dont le client reste à confirmer.</p></div>
        <Link href="/app/projects/new" className={primaryAction}><Plus aria-hidden="true" size={17} />Ajouter un chantier client</Link>
      </div>
      {rows.length === 0 ? <p className="mt-5 rounded-xl bg-sand/70 p-4 text-sm text-black/55">Aucun chantier pour le moment.</p>
        : <div className="mt-5 grid gap-3 sm:grid-cols-2">{rows.slice(0, 6).map(row => <Link key={row.id} href={`/app/projects/${row.id}`} className="group rounded-2xl border border-black/[0.08] p-4 transition hover:border-teal/40 hover:shadow-sm">
          <div className="flex items-start justify-between gap-3"><h3 className="min-w-0 truncate font-bold text-ink group-hover:text-teal">{row.title || 'Chantier'}</h3>{!row.client_id && <Badge tone="clay">Client à confirmer</Badge>}</div>
          <p className="mt-2 text-sm text-black/55">{stageLabels[row.project_stage]}</p>
        </Link>)}</div>}
      <Link href="/app/projects" className="mt-4 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-teal">Voir mes chantiers<ArrowRight aria-hidden="true" size={15} /></Link>
    </Card>
    <div className="grid gap-4 md:grid-cols-3">{([['DAO disponibles', '/app/artisan', 'Consulter les opportunités accessibles.', Search], ['Mes offres', '/app/artisan/offers', 'Suivre brouillons, envois et résultats.', ClipboardCheck], ['Mes invitations', '/app/invitations', 'Répondre aux invitations reçues.', Mail]] as const).map(([title, href, description, Icon]) => <Link key={href} href={href} className="group block rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal">
      <Card className="flex h-full flex-col gap-3 transition group-hover:border-teal/30 group-hover:shadow-md"><span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal/10 text-teal"><Icon size={19} /></span><h2 className="font-bold text-ink">{title}</h2><p className="text-sm text-black/55">{description}</p><span className="mt-auto inline-flex items-center gap-1 text-sm font-semibold text-teal">Ouvrir<ArrowRight aria-hidden="true" size={15} /></span></Card>
    </Link>)}</div>
  </section>;

  // Client dashboard (#477, proposal A): real next actions first, one « Nouveau chantier », compact chantier rows.
  const published = (row: Row) => ['open', 'published', 'closed'].includes(row.projectStatus);
  const signalOf = (row: Row) => published(row) ? offerSignals.signals[row.id] : undefined;
  const awardedLots = (row: Row) => signalOf(row)?.awardedLots ?? 0;
  const worksStarted = (row: Row) => ['started', 'in_progress', 'completed'].includes(row.project_stage);
  const bucket = (row: Row) => worksStarted(row) && awardedLots(row) > 0 ? 'works'
    : awardedLots(row) > 0 && awardedLots(row) >= (signalOf(row)?.lots ?? Infinity) ? 'awarded'
    : published(row) ? 'published'
    : row.status === 'client_review' ? 'client-review'
    : ['dao_review', 'approved'].includes(row.status) ? 'dao-review' : 'preparation';
  const pills = ([['preparation', 'En préparation'], ['client-review', 'Validation client'], ['dao-review', 'En revue D.A.O.'], ['published', 'Publiés, en attente de choix'], ['awarded', 'Artisan choisi'], ['works', 'Travaux en cours']] as const)
    .map(([key, label]) => ({ key, label, count: rows.filter(row => bucket(row) === key).length }));
  const offersReady = rows.filter(published).every(row => offerSignals.signals[row.id]);
  type Todo = { key: string; title: string; detail: string; href: string; cta: string; waiting?: boolean; rank: number };
  const todos: Todo[] = [];
  for (const row of rows) {
    const title = row.title || typeLabels[row.project_type] || 'Votre chantier';
    const signal = signalOf(row);
    if (row.status === 'rejected') todos.push({ key: `${row.id}-fix`, title: 'Corrections demandées par D.A.O.', detail: title, href: `/app/projects/${row.id}`, cta: 'Corriger le dossier', rank: 3 });
    else if (row.status === 'draft') todos.push({ key: `${row.id}-draft`, title: row.lots ? 'Dossier à terminer et à envoyer' : 'Ajouter le lot principal de votre chantier', detail: `${title} · ${row.lots ?? 0} lot${(row.lots ?? 0) > 1 ? 's' : ''}`, href: `/app/projects/${row.id}`, cta: 'Continuer le dossier', rank: 4 });
    else if (row.status === 'client_review') todos.push({ key: `${row.id}-cr`, title: 'Dossier envoyé à D.A.O.', detail: `${title} · en attente de prise en charge`, href: `/app/projects/${row.id}`, cta: 'Suivre le dossier', waiting: true, rank: 5 });
    else if (row.status === 'dao_review') todos.push({ key: `${row.id}-dr`, title: 'Revue D.A.O. en cours', detail: `${title} · vous serez prévenu de la décision`, href: `/app/projects/${row.id}`, cta: 'Suivre le dossier', waiting: true, rank: 5 });
    if (signal?.state === 'to_compare' && signal.publicationId) todos.push({ key: `${row.id}-offers`, title: `${signal.offers} offre${signal.offers > 1 ? 's' : ''} reçue${signal.offers > 1 ? 's' : ''} à comparer`, detail: `${title} · ${signal.lots - signal.awardedLots} lot${signal.lots - signal.awardedLots > 1 ? 's' : ''} sans Artisan choisi`, href: `/app/publications/${signal.publicationId}#offres`, cta: 'Comparer les offres', rank: 1 });
    for (const agreement of agreements.filter(item => item.projectId === row.id)) {
      if (agreement.state === 'none') todos.push({ key: agreement.awardId, title: 'Définir les conditions avec l’Artisan', detail: `${title} · calendrier et modalités, sans engagement juridique`, href: `/app/awards/${agreement.awardId}/conditions`, cta: 'Définir les conditions', rank: 2 });
      else if (agreement.state === 'to_answer') todos.push({ key: agreement.awardId, title: 'Proposition de conditions à valider', detail: `${title} · l’Artisan attend votre réponse`, href: `/app/awards/${agreement.awardId}/conditions`, cta: 'Voir la proposition', rank: 0 });
      else if (agreement.state === 'waiting') todos.push({ key: agreement.awardId, title: 'Conditions envoyées à l’Artisan', detail: `${title} · en attente de sa réponse`, href: `/app/awards/${agreement.awardId}/conditions`, cta: 'Suivre', waiting: true, rank: 5 });
    }
  }
  const actions = todos.filter(item => !item.waiting).length;
  todos.sort((a, b) => a.rank - b.rank);
  const rowPill = (row: Row) => {
    const signal = signalOf(row);
    if (!signal) return null;
    if (signal.awardedLots > 0) return signal.awardedLots >= signal.lots ? { text: worksStarted(row) ? stageLabels[row.project_stage] : 'Artisan choisi', tone: 'teal' } : { text: `${signal.awardedLots}/${signal.lots} lots attribués`, tone: 'clay' };
    return { text: signal.state === 'to_compare' ? 'Offres à comparer' : signal.state === 'unknown' ? 'Offres indisponibles' : 'En attente d’offres', tone: signal.state === 'to_compare' ? 'clay' : 'neutral' };
  };
  const steps = (row: Row) => {
    const signal = signalOf(row);
    const done = [!['draft', 'rejected'].includes(row.status), published(row), Boolean(signal && (signal.offers > 0 || signal.awardedLots > 0)), Boolean(signal && signal.awardedLots > 0 && signal.awardedLots >= signal.lots), worksStarted(row) && awardedLots(row) > 0];
    const current = done.indexOf(false);
    return ['Préparé', 'Publié', 'Offres', 'Artisan', 'Travaux'].map((label, index) => ({ label, state: done[index] ? 'done' : index === current ? 'current' : 'todo' }));
  };
  const pillTone: Record<string, string> = { teal: 'bg-teal/10 text-teal', clay: 'bg-clay/15 text-[#9a4520]', neutral: 'bg-ink/[0.06] text-ink/75' };
  const newProject = <Link href="/app/projects/new" className={`${secondaryAction} w-full sm:w-auto`}><Plus aria-hidden="true" size={17} />Nouveau chantier</Link>;

  if (!rows.length) return <section className="space-y-8">
    <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-teal">Tableau de bord · <span className="normal-case tracking-normal">{today}</span></p><h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Bonjour {name}</h1></div>
    <Card className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
      <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sand"><FolderPlus size={22} className="text-teal" /></span>
      <div><h2 className="font-bold text-ink">Votre espace est prêt</h2><p className="mt-1 text-sm text-black/60">Créez votre premier chantier et structurez vos travaux lot par lot.</p></div>
      <Link className={`${primaryAction} sm:ml-auto`} href="/app/projects/new"><Plus aria-hidden="true" size={17} />Nouveau chantier</Link>
    </Card>
    <p data-testid="dashboard-stat-total" className="sr-only">0 chantier</p>
    <ReviewInvitation />
  </section>;

  return <section className="space-y-7">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal">Tableau de bord · <span className="normal-case tracking-normal">{today}</span></p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Bonjour {name}</h1>
        <p className="mt-1.5 text-sm text-black/60"><span data-testid="dashboard-stat-total">{rows.length} chantier{rows.length > 1 ? 's' : ''}</span>{offersReady && <> · {actions ? `${actions} action${actions > 1 ? 's' : ''} vous attend${actions > 1 ? 'ent' : ''}` : 'aucune action en attente'}</>}</p>
      </div>
      {newProject}
    </div>

    <section aria-labelledby="todo-title" className="rounded-2xl border border-teal/20 bg-white p-4 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="todo-title" className="text-xl font-bold text-ink">À faire maintenant</h2>{offerSignals.failed && <p role="status" className="text-xs text-red-700">Offres momentanément indisponibles : certaines actions peuvent manquer.</p>}</div>
      {!offersReady ? <div aria-busy="true" className="mt-4 h-20 animate-pulse rounded-xl bg-black/[0.04]"><span className="sr-only">Chargement des actions…</span></div>
        : todos.length === 0 ? <p className="mt-3 rounded-xl bg-sand/70 px-4 py-3 text-sm text-black/65">Rien à faire pour le moment. Vous serez prévenu dès qu’une offre arrive ou qu’une décision est prise.</p>
        : <ul className="mt-4 space-y-3">{(showAll ? todos : todos.slice(0, 5)).map(item => <li key={item.key} className={`flex flex-col gap-3 rounded-xl p-4 sm:flex-row sm:items-center ${item.waiting ? 'bg-sand/60' : 'bg-clay/[0.07]'}`}>
          <span aria-hidden="true" className={`hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white sm:flex ${item.waiting ? 'text-ink/60' : 'text-[#b4532a]'}`}>{item.waiting ? <Hourglass size={19} /> : <Inbox size={19} />}</span>
          <div className="min-w-0 flex-1"><h3 className="font-bold text-ink">{item.title}</h3><p className="mt-0.5 break-words text-sm text-black/60">{item.detail}</p></div>
          <Link href={item.href} className={`${item.waiting ? secondaryAction : primaryAction} w-full shrink-0 sm:w-auto`}>{item.cta}<ArrowRight aria-hidden="true" size={16} /></Link>
        </li>)}</ul>}
      {offersReady && todos.length > 5 && <button type="button" aria-expanded={showAll} onClick={() => setShowAll(value => !value)} className="mt-3 inline-flex min-h-11 items-center gap-1 rounded-lg px-1 text-sm font-semibold text-teal hover:underline">{showAll ? 'Afficher moins' : `Afficher les ${todos.length - 5} autres`}</button>}
    </section>

    <ReviewInvitation />

    <section aria-labelledby="sites-title" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2"><h2 id="sites-title" className="text-xl font-bold text-ink">Mes chantiers</h2><Link href="/app/projects" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-teal">Voir tous les chantiers<ArrowRight aria-hidden="true" size={15} /></Link></div>
      <ul aria-label="État de mes chantiers" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible">{pills.map(pill => <li key={pill.key} data-testid={`dashboard-stat-${pill.key}`} className={`shrink-0 rounded-full border px-3.5 py-2 text-xs sm:text-sm ${pill.count ? 'border-teal/25 bg-teal/[0.08] font-semibold text-teal' : 'border-black/[0.08] bg-white text-black/55'}`}>{pill.label} <strong className={pill.count ? '' : 'text-ink'}>{pill.count}</strong></li>)}</ul>
      <ul className="space-y-2.5">{rows.slice(0, 6).map(row => { const pill = rowPill(row); return <li key={row.id}><Link href={`/app/projects/${row.id}`} className="group grid gap-3 rounded-2xl border border-black/[0.07] bg-white p-4 transition hover:border-teal/35 hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal sm:p-5 md:grid-cols-[minmax(0,2fr)_minmax(0,2.4fr)_auto] md:items-center md:gap-6">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-teal">{typeLabels[row.project_type] ?? 'Projet'} · {row.lots ?? 0} lot{(row.lots ?? 0) > 1 ? 's' : ''}</p>
          <h3 className="mt-0.5 line-clamp-2 font-bold text-ink group-hover:text-teal">{row.title || 'Projet sans titre'}</h3>
          <div className="mt-1.5">{pill ? <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${pillTone[pill.tone]}`}>{pill.text}</span> : <StatusPill status={displayProjectStatus(row.status)} />}</div>
        </div>
        <ol aria-label="Avancement du chantier" className="grid grid-cols-5 gap-1.5">{steps(row).map(step => <li key={step.label} className={`flex flex-col gap-1.5 text-[11px] font-semibold ${step.state === 'done' ? 'text-teal' : step.state === 'current' ? 'text-[#9a4520]' : 'text-black/50'}`}><span aria-hidden="true" className={`h-1.5 rounded-full ${step.state === 'done' ? 'bg-teal' : step.state === 'current' ? 'bg-clay' : 'bg-black/[0.08]'}`} />{step.label}<span className="sr-only">{step.state === 'done' ? ' : fait' : step.state === 'current' ? ' : en cours' : ' : à venir'}</span></li>)}</ol>
        <div className="flex items-center justify-between gap-3 border-t border-black/5 pt-3 md:border-0 md:pt-0"><span className="text-sm font-bold tabular-nums text-ink">{formatTnd(row.indicative_budget_millimes)}</span><ChevronRight aria-hidden="true" size={18} className="text-black/40 group-hover:text-teal" /></div>
      </Link></li>; })}</ul>
    </section>

    <section aria-label="Aide" className="grid gap-3 sm:grid-cols-2">
      {([['Inviter un professionnel', '/app/professionals', 'Annuaire des professionnels vérifiés, notes et avis.', Search], ['Une question ?', '/app/messages', 'Écrire à l’assistance D.A.O.', MessageSquare]] as const).map(([title, href, description, Icon]) => <Link key={href} href={href} className="group flex min-h-11 items-center gap-3 rounded-2xl border border-black/5 bg-white p-4 transition hover:border-teal/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal">
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal/10 text-teal"><Icon size={17} /></span>
        <span className="min-w-0"><span className="block text-sm font-semibold text-ink group-hover:text-teal">{title}</span><span className="block text-xs text-black/60">{description}</span></span>
      </Link>)}
    </section>
  </section>;
}

type AgreementTodo = { awardId: string; projectId: string; state: 'none' | 'to_answer' | 'waiting' | 'done' };
/** Live awards of the Client's chantiers and where their « Conditions et calendrier » stands (nothing on failure). */
function useClientAgreements(projectIds: string[], enabled: boolean) {
  const [rows, setRows] = useState<AgreementTodo[]>([]);
  const key = projectIds.join(',');
  useEffect(() => {
    if (!enabled || !projectIds.length) { setRows([]); return; }
    let active = true;
    void (async () => {
      const supabase = supabaseBrowser();
      const items = await supabase.from('award_items').select('award_id,project_id').in('project_id', projectIds).eq('active', true);
      if (items.error || !items.data?.length) { if (active) setRows([]); return; }
      const byAward = new Map((items.data as { award_id: string; project_id: string }[]).map(row => [row.award_id, row.project_id]));
      const awards = await supabase.from('awards').select('id,status').in('id', [...byAward.keys()]);
      if (awards.error) { if (active) setRows([]); return; }
      const live = (awards.data as { id: string; status: string }[]).filter(row => row.status !== 'cancelled').map(row => row.id);
      const result = await Promise.all(live.map(id => readAgreement(id).then(snapshot => {
        const status = snapshot?.agreement?.status;
        const state: AgreementTodo['state'] = !snapshot?.agreement ? 'none' : status === 'agreed' ? 'done' : snapshot.permissions?.can_accept ? 'to_answer' : status === 'negotiating' ? 'waiting' : 'none';
        return { awardId: id, projectId: byAward.get(id)!, state };
      }).catch(() => null)));
      if (active) setRows(result.filter((row): row is AgreementTodo => Boolean(row)));
    })();
    return () => { active = false; };
  }, [key, enabled]);
  return rows;
}
