'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ArrowUpRight, Building2, CalendarDays, ChevronRight, Filter, MapPin, Plus, Search, X } from 'lucide-react';
import { supabaseBrowser } from '../../../lib/supabase-browser';
import { stageLabels } from '../../../lib/collaboration';
import { effectiveProjectStatus, displayProjectStatus, approvedVersionLabel, statusLabel } from '../../../lib/utils';
import { DossierMeter, dossierStepText, dossierSummary, ErrorPanel, fieldClass, Pill, primaryAction, StatusPill } from './_components/ProjectUi';

type ProjectRow = { id: string; title: string; project_type: string; surface_m2?: number | null; status: string; desired_end_date?: string | null; indicative_budget_millimes?: number | null; location: string; lotCount: number; client_id: string | null; project_stage: string; projectStatus: string; versionStatus?: string | null; versionNo?: number | null; myRole?: string };
const typeLabels: Record<string, string> = { construction: 'Construction', renovation: 'Rénovation', repair: 'Réparation', extension: 'Extension', other: 'Autre' };
const formatTnd = (value?: number | null) => value == null ? 'Non renseigné' : new Intl.NumberFormat('fr-TN', { style: 'currency', currency: 'TND', maximumFractionDigits: 3 }).format(Number(value) / 1000);
const formatDate = (value?: string | null) => value ? new Intl.DateTimeFormat('fr-TN', { dateStyle: 'medium' }).format(new Date(value)) : '—';
const lotsLabel = (count: number) => `${count} lot${count > 1 ? 's' : ''}`;
const roleLabel = (role?: string) => role ? `Mon rôle : ${role === 'client' ? 'Client' : 'Artisan / Entreprise'}` : '';

// The list renders only after the client-side fetch, so choosing one layout here never causes a hydration mismatch:
// only the table (lg and up) or the cards are built, instead of both with one hidden by CSS.
const wideQuery = '(min-width: 1024px)';
const subscribeWide = (notify: () => void) => { const media = window.matchMedia(wideQuery); media.addEventListener('change', notify); return () => media.removeEventListener('change', notify); };
const useWideLayout = () => useSyncExternalStore(subscribeWide, () => window.matchMedia(wideQuery).matches, () => true);

export default function Projects() {
  const wide = useWideLayout();
  const [contractor, setContractor] = useState(false);
  const [rows, setRows] = useState<ProjectRow[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [query, setQuery] = useState(''); const [status, setStatus] = useState(''); const [stage, setStage] = useState('');
  async function load() { setLoading(true); setError(''); const supabase = supabaseBrowser(); const { data: session } = await supabase.auth.getSession(); const userId = session.session?.user.id ?? null; if (userId) { const [{ data: roles }, { data: profile }] = await Promise.all([supabase.from('user_roles').select('role').eq('user_id', userId), supabase.from('profiles').select('last_workspace').eq('user_id', userId).maybeSingle()]); const hasContractor = Boolean(roles?.some(row => row.role === 'contractor')); const hasClient = Boolean(roles?.some(row => row.role === 'client')); setContractor(hasContractor && (!hasClient || profile?.last_workspace === 'contractor')); } const [projects, versions, requests, governors, delegations, localities, memberships] = await Promise.all([supabase.from('projects').select('id,project_type,status,desired_end_date,indicative_budget_millimes,surface_m2,created_at,client_id,project_stage').order('created_at', { ascending: false }), supabase.from('project_versions').select('project_id,title,status,governorate_id,delegation_id,locality_id,version_no').order('version_no', { ascending: false }), supabase.from('project_requests').select('id,project_id,status').neq('status', 'withdrawn'), supabase.from('governorates').select('id,name_fr'), supabase.from('delegations').select('id,name_fr'), supabase.from('localities').select('id,name_fr'), userId ? supabase.from('project_members').select('project_id,participation_role').eq('user_id', userId).eq('status', 'accepted') : Promise.resolve({ data: [] as { project_id: string; participation_role: string }[] })]); if (projects.error) { setError('Impossible de charger vos projets.'); setLoading(false); return; }
    const latest = new Map<string, any>(); for (const version of versions.data ?? []) if (!latest.has(version.project_id)) latest.set(version.project_id, version); const govMap = new Map((governors.data ?? []).map(row => [row.id, row.name_fr])); const delegationMap = new Map((delegations.data ?? []).map(row => [row.id, row.name_fr])); const localityMap = new Map((localities.data ?? []).map(row => [row.id, row.name_fr])); const ownRoleByProject = new Map((memberships.data ?? []).map(member => [member.project_id, member.participation_role]));
    setRows((projects.data ?? []).map(project => { const version = latest.get(project.id); return { ...project, status: effectiveProjectStatus(project.status, version?.status), projectStatus: project.status, versionStatus: version?.status ?? null, versionNo: version?.version_no ?? null, title: version?.title && version.title !== 'Nouveau projet' ? version.title : typeLabels[project.project_type] ?? 'Projet', location: [govMap.get(version?.governorate_id), delegationMap.get(version?.delegation_id), localityMap.get(version?.locality_id)].filter(Boolean).join(' · ') || 'Localisation à préciser', lotCount: (requests.data ?? []).filter(request => request.project_id === project.id).length, myRole: project.client_id === userId && userId ? 'client' : ownRoleByProject.get(project.id) }; }));
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);
  const filtered = useMemo(() => { const normalized = query.trim().toLocaleLowerCase('fr'); return rows.filter(row => (!status || row.status === status) && (!stage || row.project_stage === stage) && (!normalized || [row.title, row.location, typeLabels[row.project_type], statusLabel[row.status]].join(' ').toLocaleLowerCase('fr').includes(normalized))); }, [query, rows, status, stage]);
  const filtersActive = Boolean(query || status || stage);
  const clearFilters = () => { setQuery(''); setStatus(''); setStage(''); };
  const createLabel = contractor ? 'Ajouter un chantier client' : 'Nouveau chantier';
  const isEmpty = !loading && !error && rows.length === 0;
  const counters = [
    { label: 'Chantiers', value: rows.length },
    { label: 'En préparation', value: rows.filter(row => ['draft', 'rejected'].includes(row.status)).length },
    { label: 'En revue', value: rows.filter(row => ['client_review', 'dao_review'].includes(row.status)).length },
    { label: 'Travaux en cours', value: rows.filter(row => row.project_stage === 'in_progress').length },
  ];

  return <section className="space-y-6" aria-labelledby="projects-title">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal">Espace de travail</p>
        <h1 id="projects-title" className="mt-2 text-[1.75rem] font-bold leading-tight tracking-tight text-ink sm:text-3xl">Mes chantiers</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink/70">Retrouvez chaque dossier, son avancement et ses lots, puis ouvrez-le pour agir.</p>
      </div>
      {!loading && !isEmpty && <Link href="/app/projects/new" className={`${primaryAction} w-full sm:w-auto`}><Plus size={17} aria-hidden="true" />{createLabel}</Link>}
    </header>

    {!loading && rows.length > 0 && <dl className="grid grid-cols-2 overflow-hidden rounded-2xl border border-black/[0.06] bg-white sm:grid-cols-4">
      {counters.map((item, index) => <div key={item.label} className={`px-4 py-3.5 sm:px-5 ${index % 2 ? 'border-l border-black/[0.06]' : ''} ${index > 1 ? 'border-t border-black/[0.06] sm:border-t-0' : ''} ${index === 2 ? 'sm:border-l' : ''}`}>
        <dt className="text-xs font-medium text-ink/65">{item.label}</dt>
        <dd className="mt-1 text-xl font-bold tabular-nums tracking-tight text-ink">{item.value}</dd>
      </div>)}
    </dl>}

    {(loading || rows.length > 0) && <div className="rounded-2xl border border-black/[0.06] bg-white p-3 sm:p-4">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_14rem_14rem_auto] lg:items-center">
        <div className="relative">
          <Search size={17} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink/45" />
          <input aria-label="Rechercher un projet" type="search" className={`${fieldClass} pl-10 placeholder:text-ink/45`} placeholder="Rechercher par projet, lieu ou statut…" value={query} onChange={event => setQuery(event.target.value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:contents">
          <div className="relative">
            <Filter size={15} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink/45" />
            <select aria-label="Filtrer par statut" className={`${fieldClass} pl-9`} value={status} onChange={event => setStatus(event.target.value)}><option value="">Tous les statuts</option>{['draft', 'client_review', 'dao_review', 'rejected', 'approved', 'open', 'published', 'archived'].map(value => <option key={value} value={value}>{statusLabel[value]}</option>)}</select>
          </div>
          <select aria-label="Filtrer par avancement des travaux" className={fieldClass} value={stage} onChange={event => setStage(event.target.value)}><option value="">Tous les avancements</option>{Object.entries(stageLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        </div>
        {filtersActive && <button type="button" className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-teal transition hover:bg-teal/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal" onClick={clearFilters}><X size={15} aria-hidden="true" />Effacer les filtres</button>}
      </div>
      {rows.length > 0 && <p role="status" className="mt-3 px-1 text-xs text-ink/65">{filtered.length} chantier{filtered.length > 1 ? 's' : ''} affiché{filtered.length > 1 ? 's' : ''} sur {rows.length}</p>}
    </div>}

    {error && <ErrorPanel title="Vos chantiers n’ont pas pu être chargés" message={error} onRetry={() => void load()} />}

    {loading ? <div aria-busy="true" className="space-y-3"><span className="sr-only">Chargement de vos chantiers…</span>{[0, 1, 2].map(item => <div key={item} className="flex items-center gap-4 rounded-2xl border border-black/[0.06] bg-white p-4 sm:p-5"><div className="min-w-0 flex-1 space-y-2.5"><div className="h-4 w-2/5 animate-pulse rounded bg-ink/[0.07]" /><div className="h-3 w-3/5 animate-pulse rounded bg-ink/[0.05]" /></div><div className="hidden h-6 w-28 animate-pulse rounded-full bg-ink/[0.06] sm:block" /></div>)}</div>
      : isEmpty ? <div className="rounded-2xl border border-dashed border-black/15 bg-white px-6 py-14 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-sand text-teal"><Building2 size={22} aria-hidden="true" /></span>
        <h2 className="mt-4 text-lg font-bold text-ink">{contractor ? 'Aucun chantier client pour le moment' : 'Votre premier chantier commence ici'}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink/70">{contractor ? 'Ajoutez un chantier existant ou rejoignez celui d’un client depuis son lien d’invitation.' : 'Décrivez votre chantier et structurez vos lots.'}</p>
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
              <tr><th scope="col" className="px-5 py-3.5 font-semibold">Chantier</th><th scope="col" className="px-4 py-3.5 font-semibold">Dossier D.A.O.</th><th scope="col" className="px-4 py-3.5 font-semibold">Travaux</th><th scope="col" className="px-4 py-3.5 font-semibold">Lots</th><th scope="col" className="px-4 py-3.5 text-right font-semibold">Budget indicatif</th><th scope="col" className="px-4 py-3.5 font-semibold">Fin souhaitée</th><th scope="col" className="w-14 px-3 py-3.5"><span className="sr-only">Ouvrir</span></th></tr>
            </thead>
            <tbody className="divide-y divide-black/[0.05]">{filtered.map(project => <tr key={project.id} data-testid={`project-row-${project.id}`} className="align-top transition-colors hover:bg-sand/50">
              <td className="max-w-[26rem] px-5 py-4">
                <Link href={`/app/projects/${project.id}`} className="block truncate text-[15px] font-semibold text-ink hover:text-teal focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal">{project.title}</Link>
                <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-ink/65"><MapPin size={13} aria-hidden="true" className="shrink-0" /><span className="truncate">{project.location}</span></p>
                <p className="mt-1 text-xs text-ink/65">{typeLabels[project.project_type] ?? 'Projet'}{project.surface_m2 ? ` · ${project.surface_m2} m²` : ''}{project.myRole && <> · <span className="font-medium text-ink/80">{roleLabel(project.myRole)}</span></>}</p>
              </td>
              <td className="px-4 py-4"><StatusPill status={displayProjectStatus(project.status)} /><div className="mt-2 flex items-center gap-2"><DossierMeter status={project.status} /><span className="sr-only">{dossierStepText(project.status)}</span></div><p className="mt-1.5 text-xs text-ink/65">{dossierSummary(project.status)}</p>{['open','published','closed'].includes(project.projectStatus) && approvedVersionLabel(project.versionStatus, project.versionNo) && <p className="mt-1 text-xs text-ink/65">{approvedVersionLabel(project.versionStatus, project.versionNo)}</p>}</td>
              <td className="px-4 py-4"><p className="text-sm text-ink/80">{stageLabels[project.project_stage] ?? 'À préciser'}</p>{!project.client_id && <Pill tone="clay" className="mt-2">Client à confirmer</Pill>}</td>
              <td className="whitespace-nowrap px-4 py-4 tabular-nums text-ink/80">{lotsLabel(project.lotCount)}</td>
              <td className="whitespace-nowrap px-4 py-4 text-right font-medium tabular-nums text-ink">{formatTnd(project.indicative_budget_millimes)}</td>
              <td className="whitespace-nowrap px-4 py-4 text-ink/70">{formatDate(project.desired_end_date)}</td>
              <td className="px-3 py-3 text-right"><Link aria-label={`Ouvrir ${project.title}`} href={`/app/projects/${project.id}`} className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-ink/55 transition hover:bg-sand hover:text-teal focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal"><ArrowUpRight size={18} aria-hidden="true" /></Link></td>
            </tr>)}</tbody>
          </table>
        </div>
        : <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden" aria-label="Liste de mes chantiers">{filtered.map(project => <li key={project.id} className="min-w-0">
          <article data-testid={`project-row-${project.id}`} className="relative flex h-full min-w-0 flex-col rounded-2xl border border-black/[0.06] bg-white p-4 shadow-[0_1px_2px_rgba(23,32,42,0.04)] transition focus-within:ring-2 focus-within:ring-teal hover:border-black/15">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-teal">{typeLabels[project.project_type] ?? 'Projet'}{project.surface_m2 ? ` · ${project.surface_m2} m²` : ''}</p>
                <h2 className="mt-1 text-base font-bold leading-snug text-ink"><Link href={`/app/projects/${project.id}`} className="line-clamp-2 break-words after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none">{project.title}</Link></h2>
              </div>
              <ChevronRight size={18} aria-hidden="true" className="mt-1 shrink-0 text-ink/35" />
            </div>
            <p className="mt-2 flex min-w-0 items-center gap-1.5 text-sm text-ink/70"><MapPin size={14} aria-hidden="true" className="shrink-0" /><span className="truncate">{project.location}</span></p>
            {project.myRole && <p className="mt-1 text-xs font-medium text-ink/70">{roleLabel(project.myRole)}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2"><StatusPill status={displayProjectStatus(project.status)} />{!project.client_id && <Pill tone="clay">Client à confirmer</Pill>}</div>
            <div className="mt-2.5 flex items-center gap-2"><DossierMeter status={project.status} /><span className="text-xs text-ink/65">{dossierSummary(project.status)}</span><span className="sr-only">{dossierStepText(project.status)}</span></div>
            {['open','published','closed'].includes(project.projectStatus) && approvedVersionLabel(project.versionStatus, project.versionNo) && <p className="text-xs text-ink/65">{approvedVersionLabel(project.versionStatus, project.versionNo)}</p>}
            <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-black/[0.06] pt-3 text-xs">
              <div className="min-w-0"><dt className="text-ink/65">Travaux</dt><dd className="mt-0.5 font-semibold text-ink">{stageLabels[project.project_stage] ?? 'À préciser'}</dd></div>
              <div className="min-w-0"><dt className="text-ink/65">Lots</dt><dd className="mt-0.5 font-semibold tabular-nums text-ink">{lotsLabel(project.lotCount)}</dd></div>
              <div className="min-w-0"><dt className="text-ink/65">Budget</dt><dd className="mt-0.5 break-words font-semibold tabular-nums text-ink">{formatTnd(project.indicative_budget_millimes)}</dd></div>
            </dl>
            {project.desired_end_date && <p className="mt-2 flex items-center gap-1.5 text-xs text-ink/65"><CalendarDays size={13} aria-hidden="true" />Fin souhaitée : {formatDate(project.desired_end_date)}</p>}
          </article>
        </li>)}</ul>}
      </>}
  </section>;
}
