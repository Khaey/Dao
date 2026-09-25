'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, FolderPlus, Plus, Sparkles } from 'lucide-react';
import { supabaseBrowser } from '../../lib/supabase-browser';
import { Badge, Button, Card, SectionHeading } from '../../components/ui';
import { effectiveProjectStatus, statusLabel } from '../../lib/utils';

type Row = { id: string; status: string; project_type: string; surface_m2?: number | null; indicative_budget_millimes?: number | null; created_at: string; title?: string; lots?: number };
const typeLabels: Record<string, string> = { construction: 'Construction', renovation: 'Rénovation', repair: 'Réparation', extension: 'Extension', other: 'Autre' };
const formatTnd = (value?: number | null) => value == null ? 'Budget à préciser' : new Intl.NumberFormat('fr-TN', { style: 'currency', currency: 'TND', maximumFractionDigits: 3 }).format(Number(value) / 1000);
const badgeTone = (status: string) => status === 'rejected' ? 'red' : ['open', 'published', 'approved'].includes(status) ? 'teal' : ['client_review', 'dao_review'].includes(status) ? 'clay' : 'neutral';

export default function Dashboard() {
  const [name, setName] = useState(''); const [rows, setRows] = useState<Row[]>([]); const [loading, setLoading] = useState(true);
  useEffect(() => { void (async () => {
    const supabase = supabaseBrowser();
    const [{ data: user }, projects, versions, requests] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from('projects').select('id,status,project_type,surface_m2,indicative_budget_millimes,created_at').order('created_at', { ascending: false }),
      supabase.from('project_versions').select('project_id,title,status,version_no').order('version_no', { ascending: false }),
      supabase.from('project_requests').select('project_id').neq('status', 'withdrawn'),
    ]);
    setName(user.user?.user_metadata?.display_name ?? user.user?.email?.split('@')[0] ?? '');
    const latest = new Map<string, any>(); for (const version of versions.data ?? []) if (!latest.has(version.project_id)) latest.set(version.project_id, version);
    const lotCounts = new Map<string, number>(); for (const request of requests.data ?? []) lotCounts.set(request.project_id, (lotCounts.get(request.project_id) ?? 0) + 1);
    setRows((projects.data ?? []).map(project => { const version = latest.get(project.id); return { ...project, status: effectiveProjectStatus(project.status, version?.status), title: version?.title, lots: lotCounts.get(project.id) ?? 0 }; }));
    setLoading(false);
  })(); }, []);
  const stats = useMemo(() => ({ total: rows.length, drafts: rows.filter(row => row.status === 'draft').length, review: rows.filter(row => ['client_review', 'dao_review'].includes(row.status)).length, open: rows.filter(row => ['open', 'published', 'approved'].includes(row.status)).length }), [rows]);
  const next = useMemo(() => rows.find(row => row.status === 'rejected') ?? rows.find(row => ['client_review', 'dao_review'].includes(row.status)) ?? rows.find(row => row.status === 'draft'), [rows]);
  const nextLabel = next?.status === 'rejected' ? 'Corriger le DAO' : next && ['client_review', 'dao_review'].includes(next.status) ? 'Suivre la revue' : next?.lots ? 'Préparer le DAO' : 'Continuer le projet';
  if (loading) return <div className="space-y-4"><div className="h-8 w-48 animate-pulse rounded bg-black/5" /><div className="h-32 animate-pulse rounded-2xl bg-black/5" /></div>;
  return <section className="space-y-8">
    <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-teal">Tableau de bord</p><h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Bonjour {name}</h1><p className="mt-2 max-w-xl text-sm text-black/55">Pilotez vos projets et préparez des lots clairs pour recevoir de meilleures offres.</p></div><Link href="/app/projects/new"><Button><Plus size={17} className="mr-2" />Nouveau projet</Button></Link></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[['Projets', stats.total], ['Brouillons', stats.drafts], ['En revue', stats.review], ['Ouverts / publiés', stats.open]].map(([label, value]) => <Card key={label} className="p-4"><p className="text-xs font-semibold uppercase tracking-wide text-black/40">{label}</p><p className="mt-2 text-3xl font-bold">{value}</p><p className="mt-1 text-xs text-black/45">État calculé depuis la dernière version</p></Card>)}</div>
    {next ? <Card className="border-teal/20 bg-teal/[0.04]"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div className="min-w-0"><div className="flex items-center gap-2"><Sparkles size={16} className="shrink-0 text-teal" /><p className="text-xs font-bold uppercase tracking-wide text-teal">Prochaine action</p></div><h2 className="mt-2 truncate text-lg font-bold">{nextLabel}</h2><p className="mt-1 truncate text-sm text-black/55">{next.title || typeLabels[next.project_type] || 'Votre projet'} · {next.lots ?? 0} lot{(next.lots ?? 0) > 1 ? 's' : ''}</p></div><Link href={`/app/projects/${next.id}`}><Button className="bg-teal">{nextLabel} <ArrowRight size={16} className="ml-2" /></Button></Link></div></Card> : <Card className="border-dashed"><div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sand"><FolderPlus size={22} className="text-teal" /></div><div><h2 className="font-bold">Votre espace est prêt</h2><p className="mt-1 text-sm text-black/55">Créez votre premier projet et structurez vos travaux lot par lot.</p></div><Link className="sm:ml-auto" href="/app/projects/new"><Button className="bg-clay">Créer un projet</Button></Link></div></Card>}
    <div><SectionHeading eyebrow="Suivi" title="Projets récents" description="Retrouvez rapidement les dossiers sur lesquels vous travaillez." action={<Link href="/app/projects" className="text-sm font-semibold text-teal">Voir tous les projets <ArrowRight size={15} className="ml-1 inline" /></Link>} />{rows.length === 0 ? <p className="mt-5 text-sm text-black/50">Aucun projet pour le moment.</p> : <div className="mt-4 grid gap-3 lg:grid-cols-3">{rows.slice(0, 6).map(row => <Link href={`/app/projects/${row.id}`} key={row.id}><Card className="h-full p-4 transition hover:-translate-y-0.5 hover:border-teal/30"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-semibold text-teal">{typeLabels[row.project_type] ?? 'Projet'}</p><h3 className="mt-1 truncate font-bold">{row.title || 'Projet sans titre'}</h3></div><Badge tone={badgeTone(row.status)}>{statusLabel[row.status] ?? row.status}</Badge></div><div className="mt-5 flex items-center justify-between text-xs text-black/50"><span>{row.lots ?? 0} lot{(row.lots ?? 0) > 1 ? 's' : ''}</span><span>{formatTnd(row.indicative_budget_millimes)}</span></div></Card></Link>)}</div>}</div>
  </section>;
}
