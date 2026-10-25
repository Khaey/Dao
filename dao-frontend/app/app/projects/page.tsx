'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent } from 'react';
import { Building2, CalendarDays, Filter, MapPin, Plus, Search, Tag, X } from 'lucide-react';
import { supabaseBrowser } from '../../../lib/supabase-browser';
import { stageLabels } from '../../../lib/collaboration';
import { effectiveProjectStatus, displayProjectStatus, approvedVersionLabel, statusLabel } from '../../../lib/utils';
import { DossierMeter, dossierStepText, dossierSummary, ErrorPanel, fieldClass, Pill, primaryAction, StatusPill } from './_components/ProjectUi';
import { useAwardedWork, useLiveAgreements, useLiveJournals, type AwardedProject } from '../../../components/artisan/AwardedWork';
import RowActions, { type RowAction } from '../../../components/projects/RowActions';
import { clientOfferLabels, myOfferLabels, useClientOffers, useMyOffers, type ClientOffers, type MyOfferState } from '../../../components/projects/offer-signals';

type ProjectRow = { id: string; title: string; project_type: string; surface_m2?: number | null; status: string; desired_end_date?: string | null; indicative_budget_millimes?: number | null; location: string; lotCount: number; client_id: string | null; project_stage: string; projectStatus: string; versionStatus?: string | null; versionNo?: number | null; myRole?: string };
/** One line per chantier (#356): readable project rows merged with the Artisan's active awards, deduplicated by id. */
type Line = { id: string; title: string; project?: ProjectRow; award?: AwardedProject; offers?: ClientOffers; myOffers?: MyOfferState };
const typeLabels: Record<string, string> = { construction: 'Construction', renovation: 'Rénovation', repair: 'Réparation', extension: 'Extension', other: 'Autre' };
const formatTnd = (value?: number | null) => value == null ? 'Non renseigné' : new Intl.NumberFormat('fr-TN', { style: 'currency', currency: 'TND', maximumFractionDigits: 3 }).format(Number(value) / 1000);
const formatDate = (value?: string | null) => value ? new Intl.DateTimeFormat('fr-TN', { dateStyle: 'medium' }).format(new Date(value)) : '—';
const lotsLabel = (count: number) => `${count} lot${count > 1 ? 's' : ''}`;
const roleLabel = (role?: string) => role ? `Mon rôle : ${role === 'client' ? 'Client' : 'Artisan / Entreprise'}` : '';
const adminStatuses = ['draft', 'client_review', 'dao_review', 'rejected', 'approved', 'published', 'archived'];
const businessStatuses: Record<string, string> = { awarded: 'Attribué', partially_awarded: 'Partiellement attribué', works_in_progress: 'Travaux en cours', works_done: 'Travaux terminés' };

// The list renders only after the client-side fetch, so choosing one layout here never causes a hydration mismatch:
// only the table (lg and up) or the cards are built, instead of both with one hidden by CSS.
const wideQuery = '(min-width: 1024px)';
const subscribeWide = (notify: () => void) => { const media = window.matchMedia(wideQuery); media.addEventListener('change', notify); return () => media.removeEventListener('change', notify); };
const useWideLayout = () => useSyncExternalStore(subscribeWide, () => window.matchMedia(wideQuery).matches, () => true);

/** Commercial state of a line, from ACTIVE awards only; never « travaux » or « contrat » from an award alone. */
function commercial(line: Line): { text: string; tone: 'teal' | 'clay'; sub?: string } | null {
  if (line.award) { const count = line.award.lots.length; return { text: count > 1 ? `${count} lots attribués` : 'Lot attribué', tone: 'teal', sub: 'Conditions à convenir' }; }
  const offers = line.offers;
  if (offers && offers.awardedLots > 0) return offers.awardedLots >= offers.lots ? { text: offers.lots > 1 ? 'Tous les lots attribués' : 'Artisan choisi', tone: 'teal' } : { text: `${offers.awardedLots} lots sur ${offers.lots} attribués`, tone: 'clay' };
  return null;
}
function businessStatus(line: Line) {
  const statuses = new Set<string>();
  const stage = line.project?.project_stage;
  if (stage === 'in_progress') statuses.add('works_in_progress');
  if (stage === 'completed') statuses.add('works_done');
  if (line.award) statuses.add('awarded');
  if (line.offers && line.offers.awardedLots > 0) statuses.add(line.offers.awardedLots >= line.offers.lots ? 'awarded' : 'partially_awarded');
  return statuses;
}

export default function Projects() {
  const router = useRouter();
  const wide = useWideLayout();
  const [contractor, setContractor] = useState(false);
  const awarded = useAwardedWork(contractor);
  const [rows, setRows] = useState<ProjectRow[]>([]); const [requestRows, setRequestRows] = useState<{ id: string; project_id: string }[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [query, setQuery] = useState(''); const [status, setStatus] = useState(''); const [offerFilter, setOfferFilter] = useState('');
  async function load() { setLoading(true); setError(''); const supabase = supabaseBrowser(); const { data: session } = await supabase.auth.getSession(); const userId = session.session?.user.id ?? null; if (userId) { const [{ data: roles }, { data: profile }] = await Promise.all([supabase.from('user_roles').select('role').eq('user_id', userId), supabase.from('profiles').select('last_workspace').eq('user_id', userId).maybeSingle()]); const hasContractor = Boolean(roles?.some(row => row.role === 'contractor')); const hasClient = Boolean(roles?.some(row => row.role === 'client')); setContractor(hasContractor && (!hasClient || profile?.last_workspace === 'contractor')); } const [projects, versions, requests, governors, delegations, localities, memberships] = await Promise.all([supabase.from('projects').select('id,project_type,status,desired_end_date,indicative_budget_millimes,surface_m2,created_at,client_id,project_stage').order('created_at', { ascending: false }), supabase.from('project_versions').select('project_id,title,status,governorate_id,delegation_id,locality_id,version_no').order('version_no', { ascending: false }), supabase.from('project_requests').select('id,project_id,status').neq('status', 'withdrawn'), supabase.from('governorates').select('id,name_fr'), supabase.from('delegations').select('id,name_fr'), supabase.from('localities').select('id,name_fr'), userId ? supabase.from('project_members').select('project_id,participation_role').eq('user_id', userId).eq('status', 'accepted') : Promise.resolve({ data: [] as { project_id: string; participation_role: string }[] })]); if (projects.error) { setError('Impossible de charger vos projets.'); setLoading(false); return; }
    const latest = new Map<string, any>(); for (const version of versions.data ?? []) if (!latest.has(version.project_id)) latest.set(version.project_id, version); const govMap = new Map((governors.data ?? []).map(row => [row.id, row.name_fr])); const delegationMap = new Map((delegations.data ?? []).map(row => [row.id, row.name_fr])); const localityMap = new Map((localities.data ?? []).map(row => [row.id, row.name_fr])); const ownRoleByProject = new Map((memberships.data ?? []).map(member => [member.project_id, member.participation_role]));
    setRequestRows((requests.data ?? []) as { id: string; project_id: string }[]);
    setRows((projects.data ?? []).map(project => { const version = latest.get(project.id); return { ...project, status: effectiveProjectStatus(project.status, version?.status), projectStatus: project.status, versionStatus: version?.status ?? null, versionNo: version?.version_no ?? null, title: version?.title && version.title !== 'Nouveau projet' ? version.title : typeLabels[project.project_type] ?? 'Projet', location: [govMap.get(version?.governorate_id), delegationMap.get(version?.delegation_id), localityMap.get(version?.locality_id)].filter(Boolean).join(' · ') || 'Localisation à préciser', lotCount: (requests.data ?? []).filter(request => request.project_id === project.id).length, myRole: project.client_id === userId && userId ? 'client' : ownRoleByProject.get(project.id) }; }));
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  // Client signals only on the chantiers he owns; Artisan signals only on his own offers/awards.
  const ownedIds = useMemo(() => rows.filter(row => row.myRole === 'client').map(row => row.id), [rows]);
  const clientOffers = useClientOffers(ownedIds, requestRows, !contractor && !loading);
  const myOffers = useMyOffers(contractor, awarded.activeByVersion, awarded.cancelledByVersion);
  const lines = useMemo<Line[]>(() => {
    const byId = new Map<string, Line>();
    for (const project of rows) byId.set(project.id, { id: project.id, title: project.title, project, offers: clientOffers.signals[project.id], myOffers: contractor ? myOffers.byProject[project.id] ?? 'none' : undefined });
    if (contractor) for (const award of awarded.projects) {
      const existing = byId.get(award.projectId);
      if (existing) existing.award = award;
      else byId.set(award.projectId, { id: award.projectId, title: award.title, award, myOffers: myOffers.byProject[award.projectId] ?? 'won' });
    }
    return [...byId.values()];
  }, [rows, awarded.projects, clientOffers.signals, myOffers.byProject, contractor]);
  const liveAgreements = useLiveAgreements(lines.flatMap(line => line.award?.awardIds ?? []));
  const liveJournals = useLiveJournals(lines.filter(line => line.award && !line.project).map(line => line.id));

  const filtered = useMemo(() => { const normalized = query.trim().toLocaleLowerCase('fr'); return lines.filter(line => {
    const project = line.project;
    const matchesStatus = !status || (status in businessStatuses ? businessStatus(line).has(status) : project ? displayProjectStatus(project.status) === status : false);
    const matchesOffers = !offerFilter || (contractor ? line.myOffers === offerFilter : line.offers?.state === offerFilter);
    const text = [line.title, project?.location, project ? typeLabels[project.project_type] : '', project ? statusLabel[displayProjectStatus(project.status)] : '', commercial(line)?.text, ...(line.award?.lots.map(lot => lot.title) ?? [])].join(' ').toLocaleLowerCase('fr');
    return matchesStatus && matchesOffers && (!normalized || text.includes(normalized)); }); }, [query, lines, status, offerFilter, contractor]);
  const filtersActive = Boolean(query || status || offerFilter);
  const clearFilters = () => { setQuery(''); setStatus(''); setOfferFilter(''); };
  const createLabel = contractor ? 'Ajouter un chantier client' : 'Nouveau chantier';
  // Do not claim « Aucune candidature » or zero awarded lots while the Artisan's award/offer reads are unknown.
  const commercialFailed = contractor && (awarded.failed || myOffers.failed);
  const commercialLoading = contractor && !commercialFailed && (!awarded.ready || !myOffers.ready);
  const busy = loading || commercialLoading;
  const isEmpty = !busy && !error && !commercialFailed && lines.length === 0;
  const counters = [
    { label: 'Chantiers', value: lines.length },
    { label: 'En préparation', value: rows.filter(row => ['draft', 'rejected', 'client_review', 'dao_review'].includes(row.status)).length },
    { label: 'Attribués', value: lines.filter(line => businessStatus(line).has('awarded') || businessStatus(line).has('partially_awarded')).length },
    { label: 'Travaux en cours', value: rows.filter(row => row.project_stage === 'in_progress').length },
  ];

  const nativeTracking = (projectId: string): RowAction => ({ label: 'Tableau de suivi et Gantt', href: `/app/native-execution/${projectId}` });
  function actions(line: Line): { primary: RowAction | null; more: RowAction[] } {
    const more: RowAction[] = [];
    const conditions = (line.award?.awardIds ?? []).filter(id => liveAgreements.includes(id)).map((id, index, list) => ({ label: `Conditions et calendrier${list.length > 1 ? ` (${index + 1})` : ''}`, href: `/app/awards/${id}/conditions` }));
    const dao = line.award?.publicationId ? { label: 'Voir le DAO', href: `/app/artisan/publications/${line.award.publicationId}` } : null;
    if (line.project) {
      const open = { label: 'Ouvrir', href: `/app/projects/${line.id}` };
      const tracking = { label: 'Suivre les travaux', href: `/app/projects/${line.id}?tab=tracking` };
      const compare = line.offers?.publicationId && line.offers.state === 'to_compare' ? { label: 'Comparer les offres', href: `/app/publications/${line.offers.publicationId}#offres` } : null;
      const primary = line.project.project_stage === 'in_progress' ? tracking : compare ?? open;
      if (primary !== open) more.push({ label: 'Ouvrir le chantier', href: open.href });
      if (line.offers?.publicationId && primary !== compare && line.offers.state !== 'none' && line.offers.state !== 'unknown') more.push({ label: 'Voir les offres et l’attribution', href: `/app/publications/${line.offers.publicationId}#offres` });
      more.push(...conditions);
      if (line.award && primary !== tracking) more.push({ label: 'Carnet de chantier', href: tracking.href });
      if (line.award || (line.offers?.awardedLots ?? 0) > 0 || ['in_progress', 'completed'].includes(line.project.project_stage)) more.push(nativeTracking(line.id));
      if (dao) more.push(dao);
      return { primary, more };
    }
    // Award without team membership: never the private project page (RLS), only award-scoped destinations.
    const primary = conditions[0] ? { label: 'Conditions', href: conditions[0].href } : dao;
    more.push(...conditions.slice(primary === dao ? 0 : 1));
    if (liveJournals.includes(line.id)) more.push({ label: 'Carnet de chantier', href: `/app/execution/${line.id}` });
    if (line.award) more.push(nativeTracking(line.id));
    if (dao && primary !== dao) more.push(dao);
    return { primary, more };
  }

  // A selected Artisan without project membership can only open an award-scoped destination.
  const rowDestination = (line: Line, primary: RowAction | null) => line.project ? `/app/projects/${line.id}` : primary?.href ?? null;
  const openRow = (event: MouseEvent<HTMLElement>, href: string | null) => {
    if (!href || (event.target as Element).closest('a, button, input, select, textarea, [role="button"]')) return;
    router.push(href);
  };
  const openRowFromKeyboard = (event: KeyboardEvent<HTMLElement>, href: string | null) => {
    if (!href || event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    router.push(href);
  };

  const statusCell = (line: Line) => { const business = commercial(line), project = line.project; return <>
    {business ? <Pill tone={business.tone}>{business.text}</Pill> : project ? <StatusPill status={displayProjectStatus(project.status)} /> : null}
    {business?.sub && <p className="mt-1.5 text-xs font-medium text-ink/70">{business.sub}</p>}
    {project && business && <p className="mt-1.5 text-xs text-ink/65">Dossier : {statusLabel[displayProjectStatus(project.status)] ?? 'à préciser'}</p>}
    {project && !business && <><div className="mt-2 flex items-center gap-2"><DossierMeter status={project.status} /><span className="sr-only">{dossierStepText(project.status)}</span></div><p className="mt-1.5 text-xs text-ink/65">{dossierSummary(project.status)}</p></>}
    {project && ['open', 'published', 'closed'].includes(project.projectStatus) && approvedVersionLabel(project.versionStatus, project.versionNo) && <p className="mt-1 text-xs text-ink/65">{approvedVersionLabel(project.versionStatus, project.versionNo)}</p>}
    {line.offers && line.offers.state !== 'none' && !business && <p className={`mt-1 text-xs font-semibold ${line.offers.state === 'unknown' ? 'text-red-700' : 'text-clay'}`}>{line.offers.state === 'unknown' ? 'Offres indisponibles — réessayez' : `${line.offers.offers} offre${line.offers.offers > 1 ? 's' : ''} reçue${line.offers.offers > 1 ? 's' : ''}`}</p>}
    {line.myOffers && line.myOffers !== 'none' && !line.award && <p className="mt-1 text-xs text-ink/65">Mon offre : {myOfferLabels[line.myOffers]}</p>}
  </>; };
  const amount = (line: Line) => line.award && !line.project ? { label: 'Montant attribué', value: formatTnd(line.award.lots.reduce((sum, lot) => sum + lot.agreedMillimes, 0)) } : { label: 'Budget indicatif', value: formatTnd(line.project?.indicative_budget_millimes) };
  const lotsCell = (line: Line) => line.project ? lotsLabel(line.project.lotCount) : `${lotsLabel(line.award!.lots.length)} attribué${line.award!.lots.length > 1 ? 's' : ''}`;
  const titleCell = (line: Line, className: string) => line.project ? <Link href={`/app/projects/${line.id}`} className={className}>{line.title}</Link> : <span className={className}>{line.title}</span>;

  return <section className="space-y-6" aria-labelledby="projects-title">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal">Espace de travail</p>
        <h1 id="projects-title" className="mt-2 text-[1.75rem] font-bold leading-tight tracking-tight text-ink sm:text-3xl">Mes chantiers</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink/70">{contractor ? 'Vos chantiers clients et les lots qui vous sont attribués, dans une seule liste.' : 'Retrouvez chaque dossier, son avancement et ses offres, puis ouvrez-le pour agir.'}</p>
      </div>
      {!busy && !commercialFailed && !isEmpty && <Link href="/app/projects/new" className={`${primaryAction} w-full sm:w-auto`}><Plus size={17} aria-hidden="true" />{createLabel}</Link>}
    </header>

    {!busy && !commercialFailed && lines.length > 0 && <dl className="grid grid-cols-2 overflow-hidden rounded-2xl border border-black/[0.06] bg-white sm:grid-cols-4">
      {counters.map((item, index) => <div key={item.label} className={`px-4 py-3.5 sm:px-5 ${index % 2 ? 'border-l border-black/[0.06]' : ''} ${index > 1 ? 'border-t border-black/[0.06] sm:border-t-0' : ''} ${index === 2 ? 'sm:border-l' : ''}`}>
        <dt className="text-xs font-medium text-ink/65">{item.label}</dt>
        <dd className="mt-1 text-xl font-bold tabular-nums tracking-tight text-ink">{item.value}</dd>
      </div>)}
    </dl>}

    {(busy || (!commercialFailed && lines.length > 0)) && <div className="rounded-2xl border border-black/[0.06] bg-white p-3 sm:p-4">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_14rem_15rem_auto] lg:items-center">
        <div className="relative">
          <Search size={17} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink/45" />
          <input aria-label="Rechercher un projet" type="search" className={`${fieldClass} pl-10 placeholder:text-ink/45`} placeholder="Rechercher par projet, lot, lieu ou statut…" value={query} onChange={event => setQuery(event.target.value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:contents">
          <div className="relative">
            <Filter size={15} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink/45" />
            <select aria-label="Filtrer par statut" className={`${fieldClass} pl-9`} value={status} onChange={event => setStatus(event.target.value)}><option value="">Tous les statuts</option><optgroup label="Dossier D.A.O.">{adminStatuses.map(value => <option key={value} value={value}>{statusLabel[value]}</option>)}</optgroup><optgroup label="Attribution et travaux">{Object.entries(businessStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</optgroup></select>
          </div>
          <div className="relative">
            <Tag size={15} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink/45" />
            <select aria-label={contractor ? 'Filtrer par mes offres' : 'Filtrer par offres'} className={`${fieldClass} pl-9`} value={offerFilter} onChange={event => setOfferFilter(event.target.value)}><option value="">{contractor ? 'Toutes mes offres' : 'Toutes les offres'}</option>{(contractor ? Object.entries(myOfferLabels) : Object.entries(clientOfferLabels).filter(([value]) => value !== 'unknown')).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          </div>
        </div>
        {filtersActive && <button type="button" className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-teal transition hover:bg-teal/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal" onClick={clearFilters}><X size={15} aria-hidden="true" />Effacer les filtres</button>}
      </div>
      {lines.length > 0 && <p role="status" className="mt-3 px-1 text-xs text-ink/65">{filtered.length} chantier{filtered.length > 1 ? 's' : ''} affiché{filtered.length > 1 ? 's' : ''} sur {lines.length}</p>}
      {clientOffers.failed && <p role="alert" className="mt-2 px-1 text-xs text-red-700">Les offres reçues n’ont pas pu être vérifiées : le filtre « Offres » peut être incomplet. Rechargez la page pour réessayer.</p>}
    </div>}

    {error && <ErrorPanel title="Vos chantiers n’ont pas pu être chargés" message={error} onRetry={() => void load()} />}
    {!error && commercialFailed && <ErrorPanel title="Offres et attributions indisponibles" message="Impossible de vérifier vos candidatures et lots attribués. Aucun résultat commercial n'est affiché pour éviter un état erroné." onRetry={() => window.location.reload()} />}

    {busy ? <div aria-busy="true" className="space-y-3"><span className="sr-only">Chargement de vos chantiers…</span>{[0, 1, 2].map(item => <div key={item} className="flex items-center gap-4 rounded-2xl border border-black/[0.06] bg-white p-4 sm:p-5"><div className="min-w-0 flex-1 space-y-2.5"><div className="h-4 w-2/5 animate-pulse rounded bg-ink/[0.07]" /><div className="h-3 w-3/5 animate-pulse rounded bg-ink/[0.05]" /></div><div className="hidden h-6 w-28 animate-pulse rounded-full bg-ink/[0.06] sm:block" /></div>)}</div>
      : commercialFailed ? null
      : isEmpty ? <div className="rounded-2xl border border-dashed border-black/15 bg-white px-6 py-14 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-sand text-teal"><Building2 size={22} aria-hidden="true" /></span>
        <h2 className="mt-4 text-lg font-bold text-ink">{contractor ? 'Aucun chantier client pour le moment' : 'Votre premier chantier commence ici'}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink/70">{contractor ? 'Ajoutez un chantier existant, rejoignez celui d’un client depuis son lien d’invitation, ou remportez un lot depuis « DAO disponibles ».' : 'Décrivez votre chantier et structurez vos lots.'}</p>
        <Link href="/app/projects/new" className={`${primaryAction} mt-6`}><Plus size={17} aria-hidden="true" />{createLabel}</Link>
      </div>
      : !error && filtered.length === 0 ? <div className="rounded-2xl border border-black/[0.06] bg-white px-6 py-12 text-center">
        <p className="font-semibold text-ink">Aucun chantier ne correspond à ces critères.</p>
        <p className="mt-1 text-sm text-ink/65">Modifiez la recherche ou les filtres pour élargir les résultats.</p>
        <button type="button" onClick={clearFilters} className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-4 text-sm font-semibold text-teal ring-1 ring-inset ring-teal/25 transition hover:bg-teal/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal"><X size={15} aria-hidden="true" />Effacer les filtres</button>
      </div>
      : filtered.length > 0 && <>
        {wide ? <div className="hidden overflow-x-auto rounded-2xl border border-black/[0.06] bg-white lg:block">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Liste de mes chantiers</caption>
            <thead className="border-b border-black/[0.06] text-xs font-semibold text-ink/65">
              <tr><th scope="col" className="px-5 py-3.5 font-semibold">Chantier</th><th scope="col" className="px-4 py-3.5 font-semibold">Statut</th><th scope="col" className="px-4 py-3.5 font-semibold">Travaux</th><th scope="col" className="px-4 py-3.5 font-semibold">Lots</th><th scope="col" className="px-4 py-3.5 text-right font-semibold">Montant</th><th scope="col" className="px-4 py-3.5 font-semibold">Fin souhaitée</th><th scope="col" className="px-4 py-3.5 text-right font-semibold">Actions</th></tr>
            </thead>
            <tbody className="divide-y divide-black/[0.05]">{filtered.map(line => { const project = line.project, act = actions(line), money = amount(line), href = rowDestination(line, act.primary); return <tr key={line.id} data-testid={`project-row-${line.id}`} tabIndex={href ? 0 : undefined} aria-label={href ? `Ouvrir : ${line.title}` : undefined} onClick={event => openRow(event, href)} onKeyDown={event => openRowFromKeyboard(event, href)} className={`align-top transition-colors hover:bg-sand/50 ${href ? 'cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal' : ''}`}>
              <td className="max-w-[22rem] px-5 py-4">
                {titleCell(line, 'block truncate text-[15px] font-semibold text-ink hover:text-teal focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal')}
                {project ? <><p className="mt-1 flex items-center gap-1.5 truncate text-xs text-ink/65"><MapPin size={13} aria-hidden="true" className="shrink-0" /><span className="truncate">{project.location}</span></p>
                  <p className="mt-1 text-xs text-ink/65">{typeLabels[project.project_type] ?? 'Projet'}{project.surface_m2 ? ` · ${project.surface_m2} m²` : ''}{project.myRole && <> · <span className="font-medium text-ink/80">{roleLabel(project.myRole)}</span></>}</p></>
                  : <p className="mt-1 text-xs text-ink/65">Mon rôle : Artisan attributaire</p>}
                {line.award && <ul className="mt-1.5 space-y-0.5 text-xs text-ink/75">{line.award.lots.map(lot => <li key={lot.awardItemId} className="truncate">Lot retenu : {lot.title}</li>)}</ul>}
              </td>
              <td className="px-4 py-4">{statusCell(line)}</td>
              <td className="px-4 py-4"><p className="text-sm text-ink/80">{project ? stageLabels[project.project_stage] ?? 'À préciser' : 'Non renseigné'}</p>{project && !project.client_id && <Pill tone="clay" className="mt-2">Client à confirmer</Pill>}</td>
              <td className="whitespace-nowrap px-4 py-4 tabular-nums text-ink/80">{lotsCell(line)}</td>
              <td className="whitespace-nowrap px-4 py-4 text-right"><span className="block font-medium tabular-nums text-ink">{money.value}</span><span className="text-xs text-ink/55">{money.label}</span></td>
              <td className="whitespace-nowrap px-4 py-4 text-ink/70">{project ? formatDate(project.desired_end_date) : 'Non renseignée'}</td>
              <td className="px-4 py-3"><RowActions title={line.title} primary={act.primary} more={act.more} menuOnly /></td>
            </tr>; })}</tbody>
          </table>
        </div>
        : <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden" aria-label="Liste de mes chantiers">{filtered.map(line => { const project = line.project, act = actions(line), money = amount(line), href = rowDestination(line, act.primary); return <li key={line.id} className="min-w-0">
          <article data-testid={`project-row-${line.id}`} tabIndex={href ? 0 : undefined} aria-label={href ? `Ouvrir : ${line.title}` : undefined} onClick={event => openRow(event, href)} onKeyDown={event => openRowFromKeyboard(event, href)} className={`flex h-full min-w-0 flex-col rounded-2xl border border-black/[0.06] bg-white p-4 shadow-[0_1px_2px_rgba(23,32,42,0.04)] transition focus-within:ring-2 focus-within:ring-teal hover:border-black/15 ${href ? 'cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal' : ''}`}>
            <p className="text-xs font-semibold text-teal">{project ? `${typeLabels[project.project_type] ?? 'Projet'}${project.surface_m2 ? ` · ${project.surface_m2} m²` : ''}` : 'Lot attribué'}</p>
            <h2 className="mt-1 text-base font-bold leading-snug text-ink">{titleCell(line, 'line-clamp-2 break-words')}</h2>
            {project && <p className="mt-2 flex min-w-0 items-center gap-1.5 text-sm text-ink/70"><MapPin size={14} aria-hidden="true" className="shrink-0" /><span className="truncate">{project.location}</span></p>}
            <p className="mt-1 text-xs font-medium text-ink/70">{project ? roleLabel(project.myRole) : 'Mon rôle : Artisan attributaire'}</p>
            {line.award && <ul className="mt-1.5 space-y-0.5 text-xs text-ink/75">{line.award.lots.map(lot => <li key={lot.awardItemId} className="break-words">Lot retenu : {lot.title}</li>)}</ul>}
            <div className="mt-3">{statusCell(line)}{project && !project.client_id && <Pill tone="clay" className="mt-2">Client à confirmer</Pill>}</div>
            <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-black/[0.06] pt-3 text-xs">
              <div className="min-w-0"><dt className="text-ink/65">Travaux</dt><dd className="mt-0.5 font-semibold text-ink">{project ? stageLabels[project.project_stage] ?? 'À préciser' : 'Non renseigné'}</dd></div>
              <div className="min-w-0"><dt className="text-ink/65">Lots</dt><dd className="mt-0.5 font-semibold tabular-nums text-ink">{lotsCell(line)}</dd></div>
              <div className="min-w-0"><dt className="text-ink/65">{money.label}</dt><dd className="mt-0.5 break-words font-semibold tabular-nums text-ink">{money.value}</dd></div>
            </dl>
            {project?.desired_end_date && <p className="mt-2 flex items-center gap-1.5 text-xs text-ink/65"><CalendarDays size={13} aria-hidden="true" />Fin souhaitée : {formatDate(project.desired_end_date)}</p>}
            <div className="mt-auto border-t border-black/[0.06] pt-3"><RowActions title={line.title} primary={act.primary} more={act.more} menuOnly /></div>
          </article>
        </li>; })}</ul>}
      </>}
  </section>;
}
