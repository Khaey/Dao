'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import NativeExecutionLiveTable from '../../../../components/execution-native/NativeExecutionLiveTable';
import SiteExecutionJournal from '../../../../components/SiteExecutionJournal';
import LotDocumentsCard from '../../../../components/documents/LotDocumentsCard';
import AgreementLinks from '../../../../components/precontract/AgreementLinks';
import { Card, SectionHeading } from '../../../../components/ui';
import { useLiveJournals } from '../../../../components/artisan/AwardedWork';
import { supabaseBrowser } from '../../../../lib/supabase-browser';
import { isDaoStaff, type AppRole } from '../../../../lib/roles';

type Section = 'planning' | 'journal' | 'documents' | 'conditions';
type ProjectDocument = { id: string; owner_id: string; original_name: string; status: string; share_scope: string };
const sectionLabels: Record<Section, string> = { planning: 'Lots et planning', journal: 'Carnet de chantier', documents: 'Documents', conditions: 'Conditions' };

/**
 * « Suivi du chantier » (#387 phase 2): the single entry for following works. Every existing module stays, grouped in
 * contextual sections: lots, dates, Gantt, dependencies, milestones, quality and situations (planning); progress and
 * interventions (journal); plans and documents; conditions. A section appears only when the viewer's real rights
 * make it answer (journal API, agreement API, document RLS); nothing here widens access.
 */
export default function ProjectFollowUpPage() {
  const { projectId } = useParams<{ projectId: string }>();
  // Staff arrive from « Suivi terrain » (?from=dao) and go back there, not to a client list.
  const [fromDao, setFromDao] = useState(false);
  const [section, setSection] = useState<Section>('planning');
  const [viewer, setViewer] = useState<{ userId: string; owner: boolean; staff: boolean } | null>(null);
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const journals = useLiveJournals(projectId ? [projectId] : []);
  const journalLive = journals.includes(projectId);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setFromDao(params.get('from') === 'dao');
    const wanted = params.get('section');
    if (wanted && wanted in sectionLabels) setSection(wanted as Section);
  }, []);
  useEffect(() => {
    let active = true;
    void (async () => {
      const supabase = supabaseBrowser();
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;
      const [project, roles, docs] = await Promise.all([
        supabase.from('projects').select('client_id').eq('id', projectId).maybeSingle(),
        supabase.from('user_roles').select('role').eq('user_id', data.user.id),
        // Evidence remains governed by document RLS: only documents this user may already read are offered.
        supabase.from('documents').select('id,owner_id,share_scope,original_name,status').eq('project_id', projectId),
      ]);
      if (!active) return;
      setViewer({ userId: data.user.id, owner: project.data?.client_id === data.user.id, staff: isDaoStaff(((roles.data ?? []) as { role: AppRole }[]).map(row => row.role)) });
      setDocuments((docs.data ?? []) as ProjectDocument[]);
    })();
    return () => { active = false; };
  }, [projectId]);

  const available: Section[] = ['planning', ...(journalLive ? ['journal' as const] : []), ...(viewer && !viewer.staff ? ['documents' as const, 'conditions' as const] : [])];
  const current = available.includes(section) ? section : 'planning';
  const choose = (next: Section) => {
    setSection(next);
    try { const url = new URL(window.location.href); if (next === 'planning') url.searchParams.delete('section'); else url.searchParams.set('section', next); window.history.replaceState(window.history.state, '', url.pathname + url.search); } catch { /* history indisponible */ }
  };

  return <section className="mx-auto w-full max-w-7xl space-y-4">
    <Link href={fromDao ? '/app/dao/tracking' : '/app/projects'} className="inline-flex min-h-10 items-center text-sm font-semibold text-teal">
      {fromDao ? '← Suivi terrain' : '← Mes chantiers'}
    </Link>
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">Suivi du chantier</h1>
      <p className="mt-1 max-w-3xl text-sm text-black/60">Lots attribués, dates, avancement, documents et conditions au même endroit. Sous-lots, dépendances, jalons, échéancier et situations restent facultatifs.</p>
    </div>
    {available.length > 1 && <nav aria-label="Sections du suivi" className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex min-w-max gap-1 rounded-xl border border-black/10 bg-white p-1">{available.map(item => <button key={item} type="button" aria-current={current === item ? 'true' : undefined} onClick={() => choose(item)}
        className={'min-h-10 rounded-lg px-3.5 text-sm font-semibold ' + (current === item ? 'bg-ink text-white' : 'text-ink/70 hover:bg-sand')}>{sectionLabels[item]}</button>)}</div>
    </nav>}
    {current === 'planning' && <NativeExecutionLiveTable projectId={projectId} onOpenJournal={journalLive ? () => choose('journal') : undefined} />}
    {current === 'journal' && viewer && <>
      <p className="rounded-xl bg-sand px-4 py-3 text-sm text-black/65">Avancement, interventions, jalons et observations déclarés pour vos lots. Une intervention avec quantité ne crée pas de situation de travaux : la situation se prépare à part, dans « Lots et planning ».</p>
      <SiteExecutionJournal projectId={projectId} userId={viewer.userId} documents={documents} />
    </>}
    {current === 'documents' && viewer && (viewer.owner
      ? <Card className="p-5 sm:p-6"><SectionHeading title="Plans et documents du chantier" description="Versions, partage par lot et revue technique se gèrent dans l’onglet Documents du chantier." /><Link href={`/app/projects/${projectId}?tab=documents`} className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-teal px-4 text-sm font-semibold text-white hover:bg-tealdark">Ouvrir les documents du chantier</Link></Card>
      : <LotDocumentsCard projectId={projectId} userId={viewer.userId} />)}
    {current === 'conditions' && <Card className="space-y-4 p-5 sm:p-6">
      <SectionHeading title="Conditions et calendrier" description="Accord facultatif entre le Client et l’Artisan, lot par lot. Il ne signe aucun contrat et ne déclenche aucun paiement." />
      <AgreementLinks projectId={projectId} />
      <p className="text-xs text-black/55">Aucune entrée n’apparaît si vous n’êtes pas partie à une attribution active de ce chantier.</p>
    </Card>}
  </section>;
}
