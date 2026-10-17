'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ClipboardCheck, FilePenLine, FolderKanban, FolderPlus, Hourglass, Mail, MessageSquare, Plus, Search, ShieldCheck, Sparkles, Star } from 'lucide-react';
import { supabaseBrowser } from '../../lib/supabase-browser';
import { Badge, Card } from '../../components/ui';
import { stageLabels } from '../../lib/collaboration';
import { effectiveProjectStatus } from '../../lib/utils';
import { DossierMeter, dossierStepText, dossierSummary, primaryAction, secondaryAction, StatusPill } from './projects/_components/ProjectUi';

type Row = { id: string; status: string; project_type: string; surface_m2?: number | null; indicative_budget_millimes?: number | null; created_at: string; title?: string; lots?: number; client_id: string | null; initiator_id:string; project_origin:string; project_stage: string };
const typeLabels: Record<string, string> = { construction: 'Construction', renovation: 'Rénovation', repair: 'Réparation', extension: 'Extension', other: 'Autre' };
const formatTnd = (value?: number | null) => value == null ? 'Budget à préciser' : new Intl.NumberFormat('fr-TN', { style: 'currency', currency: 'TND', maximumFractionDigits: 3 }).format(Number(value) / 1000);

export default function Dashboard() {
  const [contractor, setContractor] = useState(false);
  const [name, setName] = useState(''); const [rows, setRows] = useState<Row[]>([]); const [loading, setLoading] = useState(true);
  useEffect(() => { void (async () => {
    const supabase = supabaseBrowser();
    const [{ data: user }, projects, versions, requests] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from('projects').select('id,status,project_type,surface_m2,indicative_budget_millimes,created_at,client_id,initiator_id,project_origin,project_stage').order('created_at', { ascending: false }),
      supabase.from('project_versions').select('project_id,title,status,version_no').order('version_no', { ascending: false }),
      supabase.from('project_requests').select('project_id').neq('status', 'withdrawn'),
    ]);
    let contractorMode=false;let profileName:string|null=null;if (user.user) { const [{ data: roles }, { data: profile }] = await Promise.all([supabase.from('user_roles').select('role').eq('user_id', user.user.id),supabase.from('profiles').select('display_name,last_workspace').eq('user_id',user.user.id).maybeSingle()]); const hasContractor=Boolean(roles?.some(row=>row.role==='contractor')); const hasClient=Boolean(roles?.some(row=>row.role==='client')); contractorMode=hasContractor&&(!hasClient||profile?.last_workspace==='contractor');profileName=profile?.display_name??null;setContractor(contractorMode); }
    setName(profileName ?? user.user?.user_metadata?.display_name ?? user.user?.email?.split('@')[0] ?? '');
    const latest = new Map<string, any>(); for (const version of versions.data ?? []) if (!latest.has(version.project_id)) latest.set(version.project_id, version);
    const lotCounts = new Map<string, number>(); for (const request of requests.data ?? []) lotCounts.set(request.project_id, (lotCounts.get(request.project_id) ?? 0) + 1);
    setRows((projects.data ?? []).filter(project=>{if(!user.user)return false;return contractorMode?(project.client_id!==user.user.id||(project.project_origin==='contractor_existing_client'&&project.initiator_id===user.user.id)):project.client_id===user.user.id}).map(project => { const version = latest.get(project.id); return { ...project, status: effectiveProjectStatus(project.status, version?.status), title: version?.title, lots: lotCounts.get(project.id) ?? 0 }; }));
    setLoading(false);
  })(); }, []);
  const stats = useMemo(() => ({ total: rows.length, drafts: rows.filter(row => row.status === 'draft').length, clientReview: rows.filter(row => row.status === 'client_review').length, daoReview: rows.filter(row => row.status === 'dao_review').length, open: rows.filter(row => ['open', 'published', 'approved'].includes(row.status)).length }), [rows]);
  const next = useMemo(() => rows.find(row => row.status === 'rejected') ?? rows.find(row => ['client_review', 'dao_review'].includes(row.status)) ?? rows.find(row => row.status === 'draft'), [rows]);
  const nextLabel = next?.status === 'rejected' ? 'Corriger le DAO' : next?.status === 'client_review' ? 'Suivre la validation client' : next?.status === 'dao_review' ? 'Suivre la revue DAO' : next?.lots ? 'Préparer le DAO' : 'Continuer le projet';
  if (loading) return <div className="space-y-6" aria-busy="true"><p role="status" className="sr-only">Chargement du tableau de bord…</p><div className="h-10 w-64 animate-pulse rounded-xl bg-black/5" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{[0, 1, 2, 3, 4].map((key) => <div key={key} className="h-28 animate-pulse rounded-2xl bg-black/5" />)}</div><div className="h-36 animate-pulse rounded-2xl bg-black/5" /></div>;
  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

  if (contractor) return <section className="space-y-8">
    <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
      <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-teal">Tableau de bord artisan</p><h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Bonjour {name}</h1><p className="mt-2 max-w-xl text-sm text-black/55">Retrouvez vos chantiers clients, invitations et offres.</p></div>
    </div>
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

  const tiles = [
    ['total', 'Chantiers', stats.total, FolderKanban, 'bg-ink/[0.06] text-ink'],
    ['draft', 'Brouillons', stats.drafts, FilePenLine, 'bg-sand text-ink'],
    ['client-review', 'Validation client', stats.clientReview, Hourglass, 'bg-clay/10 text-clay'],
    ['dao-review', 'Revue DAO', stats.daoReview, ShieldCheck, 'bg-amber-50 text-amber-700'],
    ['open', 'Ouverts / publiés', stats.open, Sparkles, 'bg-teal/10 text-teal'],
  ] as const;

  return <section className="space-y-8">
    <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal">Tableau de bord · <span className="normal-case tracking-normal">{today}</span></p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Bonjour {name}</h1>
        <p className="mt-2 max-w-xl text-sm text-black/55">Pilotez vos projets et préparez des lots clairs pour recevoir de meilleures offres.</p>
      </div>
      <Link href="/app/projects/new" className={`${primaryAction} w-full sm:w-auto`}><Plus aria-hidden="true" size={17} />Nouveau chantier</Link>
    </div>

    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      {tiles.map(([key, label, value, Icon, tone], index) => <Card key={key} data-testid={`dashboard-stat-${key}`} className={`flex flex-col gap-3 p-4 ${index === 0 ? 'col-span-2 sm:col-span-1' : ''}`}>
        <div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-black/55">{label}</p><span aria-hidden="true" className={`flex h-8 w-8 items-center justify-center rounded-lg ${tone}`}><Icon size={16} /></span></div>
        <p className="text-3xl font-bold tabular-nums tracking-tight text-ink">{value}</p>
      </Card>)}
    </div>
    <p className="-mt-5 text-xs text-black/45">États calculés depuis la dernière version de chaque dossier.</p>

    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-6">
        {next ? <Card className="overflow-hidden border-teal/20 p-0">
          <div className="flex flex-col gap-5 bg-[linear-gradient(120deg,rgba(15,118,110,0.10),rgba(247,245,239,0.6))] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.14em] text-teal"><Sparkles aria-hidden="true" size={14} />Prochaine action</p>
              <h2 className="mt-2 text-xl font-bold text-ink">{nextLabel}</h2>
              <p className="mt-1 truncate text-sm text-black/60">{next.title || typeLabels[next.project_type] || 'Votre projet'} · {next.lots ?? 0} lot{(next.lots ?? 0) > 1 ? 's' : ''}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-black/55"><DossierMeter status={next.status} /><span>{dossierStepText(next.status) || dossierSummary(next.status)}</span></div>
            </div>
            <Link href={`/app/projects/${next.id}`} className={`${primaryAction} shrink-0 bg-teal hover:bg-ink`}>{nextLabel}<ArrowRight aria-hidden="true" size={16} /></Link>
          </div>
        </Card> : <Card className="flex flex-col items-start gap-4 border-dashed sm:flex-row sm:items-center">
          <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sand"><FolderPlus size={22} className="text-teal" /></span>
          <div><h2 className="font-bold text-ink">Votre espace est prêt</h2><p className="mt-1 text-sm text-black/55">Créez votre premier projet et structurez vos travaux lot par lot.</p></div>
          <Link className={`${primaryAction} bg-clay sm:ml-auto`} href="/app/projects/new">Nouveau chantier</Link>
        </Card>}

        <div className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-teal">Suivi</p><h2 className="mt-1 text-xl font-bold text-ink">Chantiers récents</h2><p className="mt-1 text-sm text-black/55">Retrouvez rapidement les dossiers sur lesquels vous travaillez.</p></div>
            <Link href="/app/projects" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-teal">Voir tous les chantiers<ArrowRight aria-hidden="true" size={15} /></Link>
          </div>
          {rows.length === 0 ? <Card><p className="text-sm text-black/55">Aucun projet pour le moment.</p></Card>
            : <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{rows.slice(0, 6).map(row => <Link href={`/app/projects/${row.id}`} key={row.id} className="group block rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal">
              <Card className="flex h-full flex-col gap-4 p-4 transition group-hover:-translate-y-0.5 group-hover:border-teal/30 group-hover:shadow-md motion-reduce:transition-none motion-reduce:group-hover:translate-y-0">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold text-teal">{typeLabels[row.project_type] ?? 'Projet'}</p><StatusPill status={row.status} /></div>
                  <h3 className="line-clamp-2 font-bold leading-snug text-ink group-hover:text-teal">{row.title || 'Projet sans titre'}</h3>
                </div>
                <div className="flex items-center gap-2 text-xs text-black/50"><DossierMeter status={row.status} /><span className="truncate">{dossierSummary(row.status)}</span></div>
                <div className="mt-auto flex items-center justify-between border-t border-black/5 pt-3 text-xs text-black/55"><span>{row.lots ?? 0} lot{(row.lots ?? 0) > 1 ? 's' : ''} · {stageLabels[row.project_stage] ?? ''}</span><span className="font-semibold tabular-nums text-ink">{formatTnd(row.indicative_budget_millimes)}</span></div>
              </Card>
            </Link>)}</div>}
        </div>
      </div>

      <aside aria-label="Raccourcis" className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-black/45">Raccourcis</h2>
        {([['Trouver un professionnel', '/app/professionals', 'Annuaire des professionnels vérifiés, notes et avis.', Search],
          ['Mes avis', '/app/reviews', 'Notez les professionnels de vos chantiers démarrés.', Star],
          ['Mes messages', '/app/messages', 'Échanges privés avec vos équipes de chantier.', MessageSquare],
          ['Mes invitations', '/app/invitations', 'Invitations envoyées et reçues.', Mail]] as const).map(([title, href, description, Icon]) => <Link key={href} href={href}
          className="group flex min-h-11 items-start gap-3 rounded-2xl border border-black/5 bg-white p-4 transition hover:border-teal/30 hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal/10 text-teal"><Icon size={17} /></span>
          <span className="min-w-0"><span className="block text-sm font-semibold text-ink group-hover:text-teal">{title}</span><span className="mt-0.5 block text-xs text-black/55">{description}</span></span>
        </Link>)}
      </aside>
    </div>
  </section>;
}
