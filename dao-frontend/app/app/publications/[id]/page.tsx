'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { supabaseBrowser } from '../../../../lib/supabase-browser';
import { Badge, Card } from '../../../../components/ui';
import PublicationOffersPanel from './PublicationOffersPanel';

type Publication = { id: string; project_id: string; safe_title: string; safe_description: string; visibility: string; status: string };
type PublicationLot = { id: string; request_version_id: string; safe_title: string; safe_scope: string; trade_id: string };

export default function PublicationDetail() {
  const { id } = useParams<{ id: string }>();
  const [publication, setPublication] = useState<Publication | null>(null);
  const [lots, setLots] = useState<PublicationLot[]>([]);
  const [isClientOwner, setIsClientOwner] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      const supabase = supabaseBrowser();
      const [publicationResult, lotResult, userResult] = await Promise.all([
        supabase.from('publications').select('id,project_id,safe_title,safe_description,visibility,status').eq('id', id).single(),
        supabase.from('publication_requests').select('id,request_version_id,safe_title,safe_scope,trade_id').eq('publication_id', id),
        supabase.auth.getUser(),
      ]);
      if (publicationResult.error || !publicationResult.data) {
        setError('DAO indisponible ou non accessible.');
        return;
      }
      const nextPublication = publicationResult.data as Publication;
      setPublication(nextPublication);
      setLots((lotResult.data ?? []) as PublicationLot[]);
      if (userResult.data.user) {
        const projectResult = await supabase.from('projects').select('client_id').eq('id', nextPublication.project_id).maybeSingle();
        setIsClientOwner(projectResult.data?.client_id === userResult.data.user.id);
      }
    })();
  }, [id]);

  if (error) return <p role="alert">{error}</p>;
  if (!publication) return <p>Chargement…</p>;
  return <section className="mx-auto max-w-5xl space-y-6">
    <div>
      <p className="text-sm font-semibold text-teal">DAO publié</p>
      <h1 className="mt-1 text-3xl font-bold">{publication.safe_title}</h1>
      <p className="mt-2 text-black/60">{publication.safe_description}</p>
      <div className="mt-3 flex gap-2"><Badge>{publication.visibility}</Badge><Badge>{publication.status}</Badge></div>
    </div>
    <Card>
      <h2 className="font-semibold">Lots proposés</h2>
      <div className="mt-4 space-y-3">{lots.map((lot) => <article key={lot.id} className="rounded-xl bg-sand/70 p-4">
        <h3 className="font-semibold">{lot.safe_title}</h3>
        <p className="mt-2 text-sm text-black/60">{lot.safe_scope}</p>
      </article>)}</div>
    </Card>
    {isClientOwner && <PublicationOffersPanel publicationId={publication.id} projectId={publication.project_id} lots={lots} />}
  </section>;
}
