'use client';

import { readAllBackoffice, verificationLabels, identityLabels } from '../../../lib/backoffice';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ClipboardCheck, Megaphone, ShieldCheck, UserRoundCheck, type LucideIcon } from 'lucide-react';
import { supabaseBrowser } from '../../../lib/supabase-browser';
import { isDaoStaff, type AppRole } from '../../../lib/roles';
import { statusLabel } from '../../../lib/utils';
import { Badge, Card, SectionHeading } from '../../../components/ui';

type ProjectVersion = { id: string; project_id: string; title: string; status: string; version_no: number; created_at: string };
type Publication = { id: string; project_id: string; safe_title: string; status: string; visibility: string; published_at: string; submission_deadline: string | null };
type Contractor = { id: string; business_name: string; verification_status: string; public_identity_status: string; created_at: string };

const tone = (status: string) => status === 'rejected' ? 'red' : ['approved', 'published', 'verified'].includes(status) ? 'teal' : ['client_review', 'dao_review', 'pending'].includes(status) ? 'clay' : 'neutral';
const visibilityLabel: Record<string, string> = { public: 'Public', targeted: 'Ciblé', invite_only: 'DAO sur invitation' };

export default function DaoManagerDashboard() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [versions, setVersions] = useState<ProjectVersion[]>([]);
  const [publications, setPublications] = useState<Publication[]>([]);
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [publishable,setPublishable]=useState<Record<string,number>>({});
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void (async () => {
      const supabase = supabaseBrowser();
      const { data: userResult } = await supabase.auth.getUser();
      if (!userResult.user) { if (active) setAllowed(false); return; }
      const roleResult = await supabase.from('user_roles').select('role').eq('user_id', userResult.user.id);
      const roles = (roleResult.data ?? []).map(row => row.role as AppRole);
      if (!isDaoStaff(roles)) { if (active) setAllowed(false); return; }
      if (active) setAllowed(true);
      const [versionResult, publicationResult, contractorResult] = await Promise.all([
        readAllBackoffice('projects').then(rows=>({data:rows.filter(p=>p.status!=='archived'),error:null})).catch(()=>({data:[],error:true})),
        supabase.from('publications').select('id,project_id,safe_title,status,visibility,published_at,submission_deadline').order('published_at', { ascending: false }),
        supabase.from('contractor_profiles').select('id,business_name,verification_status,public_identity_status,created_at').order('created_at', { ascending: false }),
      ]);
      if (!active) return;
      if (versionResult.error || publicationResult.error || contractorResult.error) {
        setError('Impossible de charger toutes les données du back-office.');
        return;
      }
      const projects=versionResult.data;
      setPublishable(Object.fromEntries(projects.map((p:any)=>[p.id,Number(p.publishable_lots)])));
      setVersions(projects.map((p:any)=>p.version) as ProjectVersion[]);
      setPublications((publicationResult.data ?? []) as Publication[]);
      setContractors((contractorResult.data ?? []) as Contractor[]);
    })();
    return () => { active = false; };
  }, []);

  const latestVersions = useMemo(() => {
    const latest = new Map<string, ProjectVersion>();
    for (const version of versions) if (!latest.has(version.project_id)) latest.set(version.project_id, version);
    return [...latest.values()];
  }, [versions]);
  const reviews = latestVersions.filter(version => ['client_review', 'dao_review'].includes(version.status));
  const ready = latestVersions.filter(version => version.status === 'approved' && publishable[version.project_id]>0);
  const activePublications = publications.filter(publication => ['published', 'suspended'].includes(publication.status));
  const pendingContractors = contractors.filter(contractor => contractor.verification_status === 'pending');
  const indicators: Array<[string, number, LucideIcon]> = [
    ['Revues en attente', reviews.length, ClipboardCheck],
    ['Prêts à publier', ready.length, ShieldCheck],
    ['Publications actives', activePublications.length, Megaphone],
    ['Profils à vérifier', pendingContractors.length, UserRoundCheck],
  ];

  if (allowed === null) return <p role="status">Chargement du back-office…</p>;
  if (!allowed) return <Card><h1 className="text-xl font-bold">Accès réservé</h1><p className="mt-2 text-sm text-black/60">Le back-office Gestionnaire est réservé aux rôles D.A.O autorisés.</p></Card>;
  return <section className="space-y-8">
    <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-teal">Back-office Gestionnaire</p><h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Pilotage D.A.O</h1><p className="mt-2 max-w-2xl text-sm text-black/55">Suivez les dossiers à examiner, les publications et les profils professionnels nécessitant une attention.</p></div>
    {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {indicators.map(([label, value, Icon]) => <Link href={label==='Revues en attente'?'/app/dao/review':label==='Profils à vérifier'?'/app/dao/professionals?status=pending':label==='Prêts à publier'?'/app/dao/projects?status=approved&publishable=true':'/app/dao/publications'} key={label}><Card key={label} className="p-4"><div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wide text-black/45">{label}</p><Icon size={18} className="text-teal" /></div><p className="mt-3 text-3xl font-bold">{value}</p></Card></Link>)}
    </div>
    <div className="grid gap-5 xl:grid-cols-2">
      <Card><SectionHeading title="Dossiers à examiner" description="Versions exactes soumises par les clients." action={<Link href="/app/dao/review" className="text-sm font-semibold text-teal">Ouvrir la revue <ArrowRight size={15} className="ml-1 inline" /></Link>} />{reviews.length === 0 ? <p className="mt-5 text-sm text-black/55">Aucune revue en attente.</p> : <div className="mt-5 space-y-3">{reviews.slice(0, 6).map(version => <Link key={version.id} href={`/app/dao/projects/${version.project_id}`} className="flex items-center justify-between gap-3 rounded-xl bg-sand/70 p-4 hover:bg-sand"><div className="min-w-0"><p className="truncate font-semibold">{version.title}</p><p className="mt-1 text-xs text-black/45">Version {version.version_no}</p></div><Badge tone={tone(version.status)}>{statusLabel[version.status] ?? version.status}</Badge></Link>)}</div>}</Card>
      <Card><SectionHeading title="Prêts à publier" description="Chantiers approuvés ayant des lots prêts à publier." />{ready.length === 0 ? <p className="mt-5 text-sm text-black/55">Aucun projet en attente de publication.</p> : <div className="mt-5 space-y-3">{ready.slice(0, 6).map(version => <div key={version.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-sand/70 p-4"><div className="min-w-0"><p className="truncate font-semibold">{version.title}</p><p className="mt-1 text-xs text-black/45">Version approuvée {version.version_no}</p></div><Link href={`/app/dao/publications/new?project_id=${version.project_id}`} className="inline-flex min-h-10 items-center rounded-xl bg-ink px-3 py-2 text-sm font-semibold text-white">Préparer la publication</Link></div>)}</div>}</Card>
      <Card><SectionHeading title="Publications actives" description="DAO publiés ou temporairement suspendus." action={<Link href="/app/dao/publications" className="text-sm font-semibold text-teal">Voir le registre <ArrowRight size={15} className="ml-1 inline" /></Link>} />{activePublications.length === 0 ? <p className="mt-5 text-sm text-black/55">Aucune publication active.</p> : <div className="mt-5 space-y-3">{activePublications.slice(0, 6).map(publication => <Link key={publication.id} href={`/app/publications/${publication.id}`} className="flex items-center justify-between gap-3 rounded-xl bg-sand/70 p-4 hover:bg-sand"><div className="min-w-0"><p className="truncate font-semibold">{publication.safe_title}</p><p className="mt-1 text-xs text-black/45">{visibilityLabel[publication.visibility] ?? publication.visibility}</p></div><Badge tone={tone(publication.status)}>{statusLabel[publication.status] ?? publication.status}</Badge></Link>)}</div>}</Card>
      <Card><SectionHeading title="Profils professionnels à vérifier" description="Ouvrez le dossier professionnel pour vérifier son profil." />{pendingContractors.length === 0 ? <p className="mt-5 text-sm text-black/55">Aucun profil en attente.</p> : <div className="mt-5 space-y-3">{pendingContractors.slice(0, 6).map(contractor => <Link href={`/app/dao/professionals?q=${encodeURIComponent(contractor.business_name)}`} key={contractor.id} className="flex items-center justify-between gap-3 rounded-xl bg-sand/70 p-4 hover:bg-sand"><div className="min-w-0"><p className="truncate font-semibold">{contractor.business_name}</p><p className="mt-1 text-xs text-black/45">Identité publique : {identityLabels[contractor.public_identity_status]||contractor.public_identity_status}</p></div><Badge tone="clay">{verificationLabels[contractor.verification_status]||contractor.verification_status}</Badge></Link>)}</div>}</Card>
    </div>
  </section>;
}
