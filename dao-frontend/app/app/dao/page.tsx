'use client';

import { readAllBackoffice, readBackoffice } from '../../../lib/backoffice';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, History, Lock, MailWarning, Megaphone, RefreshCw, ShieldCheck, SlidersHorizontal, UserCheck, UserCog, UserPlus, UserRoundCheck, type LucideIcon } from 'lucide-react';
import { supabaseBrowser } from '../../../lib/supabase-browser';
import { isDaoStaff, type AppRole } from '../../../lib/roles';
import { redirectToLoginAfterExpiry } from '../../../lib/session-return';
import { effectiveProjectStatus, statusLabel } from '../../../lib/utils';
import { Badge, Button, Card, SectionHeading } from '../../../components/ui';
import { AssignmentBadge, assignmentOf, pendingReview, reviewStatusLabel, type Assignment } from '../../../components/backoffice/assignment';

type ProjectRow = { id: string; status: string; reviewer_id: string | null; reviewer_name: string | null; client_name: string | null; publishable_lots: number | string; version: { id: string; title: string; status: string; version_no: number } };
type Publication = { id: string; project_id: string; safe_title: string; status: string; visibility: string; published_at: string; submission_deadline: string | null };
type Contractor = { id: string; business_name: string; verification_status: string; public_identity_status: string; created_at: string };

const tone = (status: string) => status === 'rejected' ? 'red' : ['approved', 'published', 'verified'].includes(status) ? 'teal' : ['client_review', 'dao_review', 'pending'].includes(status) ? 'clay' : 'neutral';
const signal = 'group flex items-center gap-3 rounded-2xl border border-black/5 bg-white p-4 transition hover:border-teal/40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal/20';
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
  // Admin supervision: failed follow-up emails among the latest 100 (outbox view is admin-only).
  const [failedEmails, setFailedEmails] = useState<number | 'error' | null>(null);

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
      // No valid session = expired session, not « Accès réservé »: reconnect and come back here.
      if (!userResult.user) { redirectToLoginAfterExpiry(); return; }
      const roleResult = await supabase.from('user_roles').select('role').eq('user_id', userResult.user.id);
      const roles = (roleResult.data ?? []).map(row => row.role as AppRole);
      if (!isDaoStaff(roles)) { if (active) setAllowed(false); return; }
      if (!active) return;
      setAllowed(true); setAdmin(roles.includes('dao_admin')); setViewerId(userResult.user.id);
      if (roles.includes('dao_admin')) void readBackoffice('outbox')
        .then(result => { if (active) setFailedEmails((result.rows as Array<{ status: string }>).filter(row => row.status === 'failed').length); })
        .catch(() => { if (active) setFailedEmails('error'); });
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
  const governance: Array<[string, string, LucideIcon, string]> = [
    ['Configurer la plateforme', '/app/dao/settings', SlidersHorizontal, 'Paramètres D.A.O., restrictions et délégations'],
    ['Gérer les comptes et rôles', '/app/dao/users', UserCog, 'Rôles cumulables, invitations staff, suspensions'],
    ['Consulter l’audit', '/app/dao/history', History, 'Journal des actions et emails de suivi'],
  ];

  const queueSection = <section aria-labelledby="queue-title" className="space-y-3">
    <div className="flex flex-wrap items-end justify-between gap-2"><h2 id="queue-title" className="text-lg font-bold text-ink">Votre file de revue</h2><p className="text-sm text-black/50">{reviews.length} revue{reviews.length > 1 ? 's' : ''} en attente au total</p></div>
    <div className="grid gap-3 sm:grid-cols-3">
      <QueueTile href="/app/dao/review?vue=mine" icon={UserCheck} label="Mes revues en cours" value={queue.mine} hint={queue.mine ? 'À examiner et décider' : 'Aucune revue à votre nom'} accent="bg-teal/10 text-teal" />
      <QueueTile href="/app/dao/review?vue=todo" icon={UserPlus} label="À prendre en charge" value={queue.todo} hint={queue.todo ? 'Dossiers suivis par personne' : 'Tous les dossiers sont suivis'} accent="bg-clay/10 text-clay" />
      <QueueTile href="/app/dao/review?vue=others" icon={Lock} label="Chez un autre gestionnaire" value={queue.others} hint="Consultation en lecture seule" accent="bg-black/[0.06] text-black/55" />
    </div>
  </section>;
  const failedValue = failedEmails === null ? '…' : failedEmails === 'error' ? '?' : String(failedEmails);
  const failedHint = failedEmails === 'error' ? 'Lecture impossible, ouvrez l’historique' : failedEmails ? 'Parmi les 100 derniers envois' : 'Aucun échec parmi les 100 derniers envois';
  const signals = <section aria-labelledby="signals-title" className="space-y-3">
    <h2 id="signals-title" className="text-lg font-bold text-ink">{admin ? 'À surveiller' : 'Ensuite'}</h2>
    <div className={`grid gap-3 ${admin ? 'sm:grid-cols-2 xl:grid-cols-4' : 'sm:grid-cols-3'}`}>
      {admin && <Link href="/app/dao/history/emails" className={`${signal} ${failedEmails === 'error' || (typeof failedEmails === 'number' && failedEmails > 0) ? 'border-red-200 bg-red-50/60' : ''}`}>
        <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-ink">Emails en échec</span><span className="mt-0.5 block text-xs text-black/50">{failedHint}</span></span>
        <span className="text-2xl font-bold tabular-nums">{failedValue}</span><MailWarning aria-hidden="true" size={18} className="shrink-0 text-red-700" />
      </Link>}
      {secondary.map(([label, value, href, Icon, hint]) => <Link href={href} key={label} className={signal}>
        <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-ink">{label}</span><span className="mt-0.5 block text-xs text-black/50">{hint}</span></span>
        <span className="text-2xl font-bold tabular-nums">{value}</span><Icon aria-hidden="true" size={18} className="shrink-0 text-teal" />
      </Link>)}
    </div>
  </section>;

  if (allowed === false) return <Card><h1 className="text-xl font-bold">Accès réservé</h1><p className="mt-2 text-sm text-black/60">Le back-office Gestionnaire est réservé aux rôles D.A.O autorisés.</p></Card>;
  return <section className="space-y-8">
    <div><p className={`text-xs font-bold uppercase tracking-[0.18em] ${admin ? 'text-ink' : 'text-teal'}`}>{admin ? 'Espace Admin DAO · Pilotage plateforme' : 'Espace Gestionnaire · Ma file'}</p><h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Pilotage D.A.O</h1><p className="mt-2 max-w-2xl text-sm text-black/55">{admin
      ? 'Surveillez la santé de la plateforme, gouvernez paramètres, comptes et rôles, et intervenez sur la file de revue si nécessaire.'
      : 'Commencez par vos revues en cours, puis prenez en charge les nouveaux dossiers. Les dossiers suivis par un autre gestionnaire restent consultables en lecture seule.'}</p></div>
    {error && <div className="flex flex-wrap items-center gap-3 rounded-xl bg-red-50 px-4 py-3"><p role="alert" className="min-w-0 flex-1 text-sm text-red-700">{error}</p><Button type="button" className="gap-2 bg-white text-ink ring-1 ring-black/10 hover:bg-sand" onClick={() => void load()}><RefreshCw aria-hidden="true" size={16} />Réessayer</Button></div>}

    {projects === null ? <div aria-busy="true" className="space-y-4"><p role="status" className="sr-only">Chargement du back-office…</p><div className="grid gap-3 sm:grid-cols-3">{[0, 1, 2].map(key => <div key={key} className="h-32 animate-pulse rounded-2xl bg-black/5" />)}</div><div className="h-64 animate-pulse rounded-2xl bg-black/5" /></div> : <>
      {admin ? <>{signals}{queueSection}</> : <>{queueSection}{signals}</>}

      {admin && <section aria-labelledby="governance-title" className="space-y-3">
        <h2 id="governance-title" className="text-lg font-bold text-ink">Gouvernance</h2>
        <div className="grid gap-3 sm:grid-cols-3">{governance.map(([label, href, Icon, hint]) => <Link key={href} href={href} className="group flex items-start gap-3 rounded-2xl border border-black/5 bg-white p-4 transition hover:border-ink/30 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal/20">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ink text-white"><Icon aria-hidden="true" size={18} /></span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-ink">{label}</span><span className="mt-0.5 block text-xs text-black/50">{hint}</span></span>
          <ArrowRight aria-hidden="true" size={15} className="mt-1 shrink-0 text-black/40 transition group-hover:translate-x-0.5" />
        </Link>)}</div>
      </section>}

      <div className="grid gap-5 xl:grid-cols-2">
        <Card><SectionHeading title="Dossiers à examiner" description="Les plus récents en premier. Ouvrez un dossier pour l’examiner." action={<Link href="/app/dao/review" className="inline-flex min-h-11 items-center text-sm font-semibold text-teal">Ouvrir la file <ArrowRight aria-hidden="true" size={15} className="ml-1" /></Link>} />
          {reviews.length === 0 ? <p className="mt-5 text-sm text-black/55">Aucune revue en attente.</p> : <ul className="mt-5 space-y-2">{reviews.slice(0, 6).map(project => <li key={project.id}><Link href={`/app/dao/projects/${project.id}`} className={row}>
            <span className="min-w-0"><span className="block truncate font-semibold">{project.version.title}</span><span className="mt-1 block text-xs text-black/45">Version {project.version.version_no}{project.client_name ? ` · ${project.client_name}` : ''}</span></span>
            <span className="flex min-w-0 max-w-[48%] flex-col items-end gap-1.5"><Badge tone={tone(statusOf(project))}>{reviewStatusLabel[statusOf(project)] ?? statusLabel[statusOf(project)]}</Badge><AssignmentBadge state={stateOf(project)} name={project.reviewer_name} /></span>
          </Link></li>)}</ul>}
          {reviews.length > 6 && <p className="mt-3 text-sm text-black/50">+ {reviews.length - 6} autre{reviews.length - 6 > 1 ? 's' : ''} dans la file.</p>}
        </Card>
        <Card><SectionHeading title="À publier" description="Chantiers approuvés ayant des lots prêts à publier." />{ready.length === 0 ? <p className="mt-5 text-sm text-black/55">Aucun projet en attente de publication.</p> : <ul className="mt-5 space-y-2">{ready.slice(0, 6).map(project => <li key={project.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-sand/70 p-4"><span className="min-w-0"><span className="block truncate font-semibold">{project.version.title}</span><span className="mt-1 block text-xs text-black/45">Version approuvée {project.version.version_no}</span></span><Link href={`/app/dao/publications/new?project_id=${project.id}`} className="inline-flex min-h-11 items-center rounded-xl bg-teal px-3 py-2 text-sm font-semibold text-white hover:bg-tealdark">Préparer la publication</Link></li>)}</ul>}</Card>
      </div>
    </>}
  </section>;
}
