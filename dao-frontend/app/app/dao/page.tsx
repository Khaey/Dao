'use client';

import { readAllBackoffice, verificationLabels, identityLabels } from '../../../lib/backoffice';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Lock, Megaphone, RefreshCw, ShieldCheck, UserCheck, UserPlus, UserRoundCheck, type LucideIcon } from 'lucide-react';
import { supabaseBrowser } from '../../../lib/supabase-browser';
import { isDaoStaff, type AppRole } from '../../../lib/roles';
import { effectiveProjectStatus, statusLabel } from '../../../lib/utils';
import { Badge, Button, Card, SectionHeading } from '../../../components/ui';
import { AssignmentBadge, assignmentOf, pendingReview, reviewStatusLabel, type Assignment } from '../../../components/backoffice/assignment';

type ProjectRow = { id: string; status: string; reviewer_id: string | null; reviewer_name: string | null; client_name: string | null; publishable_lots: number | string; version: { id: string; title: string; status: string; version_no: number } };
type Publication = { id: string; project_id: string; safe_title: string; status: string; visibility: string; published_at: string; submission_deadline: string | null };
type Contractor = { id: string; business_name: string; verification_status: string; public_identity_status: string; created_at: string };

const tone = (status: string) => status === 'rejected' ? 'red' : ['approved', 'published', 'verified'].includes(status) ? 'teal' : ['client_review', 'dao_review', 'pending'].includes(status) ? 'clay' : 'neutral';
const visibilityLabel: Record<string, string> = { public: 'Public', targeted: 'Ciblé', invite_only: 'DAO sur invitation' };
const row = 'flex min-h-14 items-center justify-between gap-3 rounded-xl bg-sand/70 p-4 transition hover:bg-sand focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal/20';

function QueueTile({ href, icon: Icon, label, value, hint, accent }: { href: string; icon: LucideIcon; label: string; value: number; hint: string; accent: string }) {
  return <Link href={href} className="group block rounded-2xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal/20">
    <Card className="flex h-full flex-col gap-3 p-4 transition group-hover:border-teal/40 sm:p-5">
      <span className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-ink">{label}</span><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${accent}`}><Icon aria-hidden="true" size={18} /></span></span>
      <span className="text-3xl font-bold tabular-nums tracking-tight text-ink">{value}</span>
      <span className="flex items-end justify-between gap-2 text-xs text-black/55"><span>{hint}</span><ArrowRight aria-hidden="true" size={15} className="shrink-0 text-teal transition group-hover:translate-x-0.5" /></span>
    </Card>
  </Link>;
}

export default function DaoManagerDashboard() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [admin, setAdmin] = useState(false);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [publications, setPublications] = useState<Publication[]>([]);
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    const supabase = supabaseBrowser();
    const [projectResult, publicationResult, contractorResult] = await Promise.all([
      readAllBackoffice('projects').then(rows => ({ data: rows.filter((p: ProjectRow) => p.status !== 'archived') as ProjectRow[], error: null })).catch(() => ({ data: [] as ProjectRow[], error: true })),
      supabase.from('publications').select('id,project_id,safe_title,status,visibility,published_at,submission_deadline').order('published_at', { ascending: false }),
      supabase.from('contractor_profiles').select('id,business_name,verification_status,public_identity_status,created_at').order('created_at', { ascending: false }),
    ]);
    if (projectResult.error || publicationResult.error || contractorResult.error) { setError('Impossible de charger toutes les données du back-office.'); setProjects(current => current ?? []); return; }
    setProjects(projectResult.data);
    setPublications((publicationResult.data ?? []) as Publication[]);
    setContractors((contractorResult.data ?? []) as Contractor[]);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const supabase = supabaseBrowser();
      const { data: userResult } = await supabase.auth.getUser();
      if (!userResult.user) { if (active) setAllowed(false); return; }
      const roleResult = await supabase.from('user_roles').select('role').eq('user_id', userResult.user.id);
      const roles = (roleResult.data ?? []).map(row => row.role as AppRole);
      if (!isDaoStaff(roles)) { if (active) setAllowed(false); return; }
      if (!active) return;
      setAllowed(true); setAdmin(roles.includes('dao_admin')); setViewerId(userResult.user.id);
      await load();
    })();
    return () => { active = false; };
  }, [load]);

  const rows = projects ?? [];
  const statusOf = (project: ProjectRow) => effectiveProjectStatus(project.status, project.version?.status);
  const reviews = rows.filter(project => pendingReview(statusOf(project)));
  const stateOf = (project: ProjectRow): Assignment => assignmentOf(project.reviewer_id, viewerId);
  const queue = { todo: reviews.filter(p => stateOf(p) === 'unassigned').length, mine: reviews.filter(p => stateOf(p) === 'mine').length, others: reviews.filter(p => stateOf(p) === 'other').length };
  const ready = rows.filter(project => statusOf(project) === 'approved' && Number(project.publishable_lots) > 0);
  const activePublications = publications.filter(publication => ['published', 'suspended'].includes(publication.status));
  const pendingContractors = contractors.filter(contractor => contractor.verification_status === 'pending');
  const secondary: Array<[string, number, string, LucideIcon, string]> = [
    ['Prêts à publier', ready.length, '/app/dao/projects?status=approved&publishable=true', ShieldCheck, 'Chantiers approuvés avec des lots à publier'],
    ['Publications actives', activePublications.length, '/app/dao/publications', Megaphone, 'DAO publiés ou suspendus'],
    ['Profils à vérifier', pendingContractors.length, '/app/dao/professionals?status=pending', UserRoundCheck, 'Professionnels en attente de vérification'],
  ];

  if (allowed === false) return <Card><h1 className="text-xl font-bold">Accès réservé</h1><p className="mt-2 text-sm text-black/60">Le back-office Gestionnaire est réservé aux rôles D.A.O autorisés.</p></Card>;
  return <section className="space-y-8">
    <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-teal">{admin ? 'Espace Admin DAO' : 'Espace Gestionnaire'}</p><h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Pilotage D.A.O</h1><p className="mt-2 max-w-2xl text-sm text-black/55">Commencez par vos revues en cours, puis prenez en charge les nouveaux dossiers. Les dossiers suivis par un autre gestionnaire restent consultables en lecture seule.</p></div>
    {error && <div className="flex flex-wrap items-center gap-3 rounded-xl bg-red-50 px-4 py-3"><p role="alert" className="min-w-0 flex-1 text-sm text-red-700">{error}</p><Button type="button" className="gap-2 bg-white text-ink ring-1 ring-black/10 hover:bg-sand" onClick={() => void load()}><RefreshCw aria-hidden="true" size={16} />Réessayer</Button></div>}

    {projects === null ? <div aria-busy="true" className="space-y-4"><p role="status" className="sr-only">Chargement du back-office…</p><div className="grid gap-3 sm:grid-cols-3">{[0, 1, 2].map(key => <div key={key} className="h-32 animate-pulse rounded-2xl bg-black/5" />)}</div><div className="h-64 animate-pulse rounded-2xl bg-black/5" /></div> : <>
      <section aria-labelledby="queue-title" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2"><h2 id="queue-title" className="text-lg font-bold text-ink">Votre file de revue</h2><p className="text-sm text-black/50">{reviews.length} revue{reviews.length > 1 ? 's' : ''} en attente au total</p></div>
        <div className="grid gap-3 sm:grid-cols-3">
          <QueueTile href="/app/dao/review?vue=mine" icon={UserCheck} label="Mes revues en cours" value={queue.mine} hint={queue.mine ? 'À examiner et décider' : 'Aucune revue à votre nom'} accent="bg-teal/10 text-teal" />
          <QueueTile href="/app/dao/review?vue=todo" icon={UserPlus} label="À prendre en charge" value={queue.todo} hint={queue.todo ? 'Dossiers suivis par personne' : 'Tous les dossiers sont suivis'} accent="bg-clay/10 text-clay" />
          <QueueTile href="/app/dao/review?vue=others" icon={Lock} label="Chez un autre gestionnaire" value={queue.others} hint="Consultation en lecture seule" accent="bg-black/[0.06] text-black/55" />
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        {secondary.map(([label, value, href, Icon, hint]) => <Link href={href} key={label} className="group flex items-center gap-3 rounded-2xl border border-black/5 bg-white p-4 transition hover:border-teal/40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal/20">
          <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-ink">{label}</span><span className="mt-0.5 block text-xs text-black/50">{hint}</span></span>
          <span className="text-2xl font-bold tabular-nums">{value}</span><Icon aria-hidden="true" size={18} className="shrink-0 text-teal" />
        </Link>)}
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card><SectionHeading title="Dossiers à examiner" description="Les plus récents en premier. Ouvrez un dossier pour l’examiner." action={<Link href="/app/dao/review" className="inline-flex min-h-11 items-center text-sm font-semibold text-teal">Ouvrir la file <ArrowRight aria-hidden="true" size={15} className="ml-1" /></Link>} />
          {reviews.length === 0 ? <p className="mt-5 text-sm text-black/55">Aucune revue en attente.</p> : <ul className="mt-5 space-y-2">{reviews.slice(0, 6).map(project => <li key={project.id}><Link href={`/app/dao/projects/${project.id}`} className={row}>
            <span className="min-w-0"><span className="block truncate font-semibold">{project.version.title}</span><span className="mt-1 block text-xs text-black/45">Version {project.version.version_no}{project.client_name ? ` · ${project.client_name}` : ''}</span></span>
            <span className="flex shrink-0 flex-col items-end gap-1.5"><Badge tone={tone(statusOf(project))}>{reviewStatusLabel[statusOf(project)] ?? statusLabel[statusOf(project)]}</Badge><AssignmentBadge state={stateOf(project)} name={project.reviewer_name} /></span>
          </Link></li>)}</ul>}
          {reviews.length > 6 && <p className="mt-3 text-sm text-black/50">+ {reviews.length - 6} autre{reviews.length - 6 > 1 ? 's' : ''} dans la file.</p>}
        </Card>
        <Card><SectionHeading title="Prêts à publier" description="Chantiers approuvés ayant des lots prêts à publier." />{ready.length === 0 ? <p className="mt-5 text-sm text-black/55">Aucun projet en attente de publication.</p> : <ul className="mt-5 space-y-2">{ready.slice(0, 6).map(project => <li key={project.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-sand/70 p-4"><span className="min-w-0"><span className="block truncate font-semibold">{project.version.title}</span><span className="mt-1 block text-xs text-black/45">Version approuvée {project.version.version_no}</span></span><Link href={`/app/dao/publications/new?project_id=${project.id}`} className="inline-flex min-h-11 items-center rounded-xl bg-ink px-3 py-2 text-sm font-semibold text-white hover:bg-teal">Préparer la publication</Link></li>)}</ul>}</Card>
        <Card><SectionHeading title="Publications actives" description="DAO publiés ou temporairement suspendus." action={<Link href="/app/dao/publications" className="inline-flex min-h-11 items-center text-sm font-semibold text-teal">Voir le registre <ArrowRight aria-hidden="true" size={15} className="ml-1" /></Link>} />{activePublications.length === 0 ? <p className="mt-5 text-sm text-black/55">Aucune publication active.</p> : <ul className="mt-5 space-y-2">{activePublications.slice(0, 6).map(publication => <li key={publication.id}><Link href={`/app/publications/${publication.id}`} className={row}><span className="min-w-0"><span className="block truncate font-semibold">{publication.safe_title}</span><span className="mt-1 block text-xs text-black/45">{visibilityLabel[publication.visibility] ?? publication.visibility}</span></span><Badge tone={tone(publication.status)}>{statusLabel[publication.status] ?? publication.status}</Badge></Link></li>)}</ul>}</Card>
        <Card><SectionHeading title="Profils professionnels à vérifier" description="Ouvrez le dossier professionnel pour vérifier son profil." />{pendingContractors.length === 0 ? <p className="mt-5 text-sm text-black/55">Aucun profil en attente.</p> : <ul className="mt-5 space-y-2">{pendingContractors.slice(0, 6).map(contractor => <li key={contractor.id}><Link href={`/app/dao/professionals?q=${encodeURIComponent(contractor.business_name)}`} className={row}><span className="min-w-0"><span className="block truncate font-semibold">{contractor.business_name}</span><span className="mt-1 block text-xs text-black/45">Identité publique : {identityLabels[contractor.public_identity_status] || contractor.public_identity_status}</span></span><Badge tone="clay">{verificationLabels[contractor.verification_status] || contractor.verification_status}</Badge></Link></li>)}</ul>}</Card>
      </div>
    </>}
  </section>;
}
