'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { supabaseBrowser } from '../../../lib/supabase-browser';
import { Badge, Button, Card, Input } from '../../../components/ui';
import { statusLabel } from '../../../lib/utils';

type ProjectRow = {
  id: string;
  title: string;
  description?: string;
  project_type: string;
  surface_m2?: number | null;
  status: string;
  desired_start_date?: string | null;
  desired_end_date?: string | null;
  indicative_budget_millimes?: number | null;
  location: string;
  lotCount: number;
  lotBudget: number;
};

const typeLabels: Record<string, string> = { construction: 'Construction', renovation: 'Rénovation', repair: 'Réparation', extension: 'Extension', other: 'Autre' };
const formatTnd = (value?: number | null) => value == null ? 'Non renseigné' : new Intl.NumberFormat('fr-TN', { style: 'currency', currency: 'TND', maximumFractionDigits: 3 }).format(Number(value) / 1000);
const formatDate = (value?: string | null) => value ? new Intl.DateTimeFormat('fr-TN', { dateStyle: 'medium' }).format(new Date(value)) : 'Non renseignée';

export default function Projects() {
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  async function load() {
    setLoading(true); setError('');
    const supabase = supabaseBrowser();
    const [projects, versions, requests, requestVersions, governors, delegations, localities] = await Promise.all([
      supabase.from('projects').select('id,project_type,surface_m2,status,desired_start_date,desired_end_date,indicative_budget_millimes,created_at').order('created_at', { ascending: false }),
      supabase.from('project_versions').select('project_id,title,description,governorate_id,delegation_id,locality_id,version_no').order('version_no', { ascending: false }),
      supabase.from('project_requests').select('id,project_id,status').neq('status', 'withdrawn'),
      supabase.from('project_request_versions').select('request_id,budget_millimes,version_no').order('version_no', { ascending: false }),
      supabase.from('governorates').select('id,name_fr'),
      supabase.from('delegations').select('id,name_fr'),
      supabase.from('localities').select('id,name_fr'),
    ]);
    if (projects.error) { setError('Impossible de charger vos projets.'); setLoading(false); return; }
    const latest = new Map<string, any>();
    for (const version of versions.data ?? []) if (!latest.has(version.project_id)) latest.set(version.project_id, version);
    const latestRequestVersions = new Map<string, any>();
    for (const version of requestVersions.data ?? []) if (!latestRequestVersions.has(version.request_id)) latestRequestVersions.set(version.request_id, version);
    const govMap = new Map((governors.data ?? []).map(row => [row.id, row.name_fr]));
    const delegationMap = new Map((delegations.data ?? []).map(row => [row.id, row.name_fr]));
    const localityMap = new Map((localities.data ?? []).map(row => [row.id, row.name_fr]));
    const requestsByProject = new Map<string, { count: number; budget: number }>();
    for (const request of requests.data ?? []) {
      const current = requestsByProject.get(request.project_id) ?? { count: 0, budget: 0 };
      current.count += 1;
      current.budget += Number(latestRequestVersions.get(request.id)?.budget_millimes ?? 0);
      requestsByProject.set(request.project_id, current);
    }
    setRows((projects.data ?? []).map(project => {
      const version = latest.get(project.id);
      const lotSummary = requestsByProject.get(project.id) ?? { count: 0, budget: 0 };
      const location = [govMap.get(version?.governorate_id), delegationMap.get(version?.delegation_id), localityMap.get(version?.locality_id)].filter(Boolean).join(' · ');
      return { ...project, title: version?.title && version.title !== 'Nouveau projet' ? version.title : typeLabels[project.project_type] ?? 'Projet', description: version?.description, location: location || 'Localisation à préciser', lotCount: lotSummary.count, lotBudget: lotSummary.budget };
    }));
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('fr');
    return normalized ? rows.filter(row => [row.title, row.location, typeLabels[row.project_type], statusLabel[row.status]].join(' ').toLocaleLowerCase('fr').includes(normalized)) : rows;
  }, [query, rows]);

  return <section>
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><p className="text-sm font-semibold text-teal">Espace client</p><h1 className="mt-1 text-3xl font-bold">Mes projets</h1><p className="mt-2 text-black/60">Suivez la préparation de vos travaux, lot par lot.</p></div>
      <Link href="/app/projects/new"><Button>+ Nouveau projet</Button></Link>
    </div>
    {!loading && rows.length > 0 && <div className="mt-6 max-w-md"><Input aria-label="Rechercher un projet" placeholder="Rechercher par titre, lieu ou statut…" value={query} onChange={event => setQuery(event.target.value)} /></div>}
    {error && <p className="mt-8 text-sm text-red-600" role="alert">{error}</p>}
    {loading ? <p className="mt-10 text-black/50">Chargement de vos projets…</p> : rows.length === 0 ? <Card className="mt-8 border-dashed text-center"><h2 className="text-lg font-semibold">Votre premier projet commence ici</h2><p className="mt-2 text-sm text-black/60">Décrivez le chantier et les lots à confier.</p><Link href="/app/projects/new"><Button className="mt-5 bg-clay">Créer un projet</Button></Link></Card> : filtered.length === 0 ? <p className="mt-8 text-sm text-black/50">Aucun projet ne correspond à votre recherche.</p> :
      <div className="mt-8 grid gap-5 md:grid-cols-2">{filtered.map(project => <Link key={project.id} href={'/app/projects/' + project.id}>
        <Card className="h-full transition hover:-translate-y-0.5 hover:shadow-md"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-teal">{typeLabels[project.project_type] ?? 'Projet'}</p><h2 className="mt-1 text-lg font-semibold">{project.title}</h2></div><Badge>{statusLabel[project.status] ?? project.status}</Badge></div>
          <p className="mt-3 line-clamp-2 text-sm text-black/60">{project.description || 'Description à compléter.'}</p>
          <div className="mt-5 grid grid-cols-2 gap-3 text-sm"><div><p className="text-xs text-black/45">Localisation</p><p className="font-medium">{project.location}</p></div><div><p className="text-xs text-black/45">Surface</p><p className="font-medium">{project.surface_m2 ? project.surface_m2 + ' m²' : 'Non renseignée'}</p></div><div><p className="text-xs text-black/45">Budget projet</p><p className="font-medium">{formatTnd(project.indicative_budget_millimes)}</p></div><div><p className="text-xs text-black/45">Budget des lots</p><p className="font-medium">{formatTnd(project.lotBudget)}</p></div></div>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-black/5 pt-3 text-xs text-black/45"><span>{project.lotCount} lot{project.lotCount > 1 ? 's' : ''}</span><span>Début : {formatDate(project.desired_start_date)}</span><span>Fin : {formatDate(project.desired_end_date)}</span></div>
        </Card>
      </Link>)}</div>}
  </section>;
}
