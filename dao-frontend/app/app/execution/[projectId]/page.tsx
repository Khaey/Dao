'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import SiteExecutionJournal from '../../../../components/SiteExecutionJournal';
import LotDocumentsCard from '../../../../components/documents/LotDocumentsCard';
import { supabaseBrowser } from '../../../../lib/supabase-browser';

type ProjectDocument = { id: string; owner_id: string; original_name: string; status: string; share_scope: string };

/**
 * Award-scoped execution journal (#346 B2). The awarded Artisan may write the journal of their active lot
 * without being a project team member (#353); this page shows ONLY that journal, never the whole project.
 * Rights stay server-side: the journal API refuses anyone outside the exact award.
 */
export default function ExecutionPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [userId, setUserId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  useEffect(() => {
    let active = true;
    const supabase = supabaseBrowser();
    void supabase.auth.getUser().then(({ data }) => { if (active) setUserId(data.user?.id ?? ''); });
    // Evidence remains governed by document RLS: only documents this user may already read are offered.
    void supabase.from('documents').select('id,owner_id,share_scope,original_name,status').eq('project_id', projectId)
      .then(({ data }) => { if (active) setDocuments((data ?? []) as ProjectDocument[]); });
    return () => { active = false; };
  }, [projectId]);
  return <section className="mx-auto w-full max-w-5xl space-y-5">
    <Link href="/app/artisan/offers" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-teal"><ArrowLeft aria-hidden="true" size={16} />Mes offres</Link>
    <p className="text-sm text-black/55">Suivi de votre lot attribué. Seules les informations d’exécution de ce lot sont affichées ici.</p>
    {projectId && userId !== null && <LotDocumentsCard projectId={projectId} userId={userId} />}
    {projectId && userId !== null && <SiteExecutionJournal projectId={projectId} userId={userId} documents={documents} />}
  </section>;
}
