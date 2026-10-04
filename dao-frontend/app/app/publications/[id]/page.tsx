'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { supabaseBrowser } from '../../../../lib/supabase-browser';
import { Badge, Card } from '../../../../components/ui';
import PublicationOffersPanel from './PublicationOffersPanel';

type PublicationLot = { id: string; request_version_id: string; safe_title: string; safe_scope: string; trade_id: string };

export default function PublicationDetail() {
  const { id } = useParams<{ id: string }>();
  const [publication, setPublication] = useState<any>();
  const [lots, setLots] = useState<PublicationLot[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      const supabase = supabaseBrowser();
      const [publicationResult, lotResult] = await Promise.all([
        supabase.from('publications').select('*').eq('id', id).single(),
        supabase.from('publication_requests').select('id,request_version_id,safe_title,safe_scope,trade_id').eq('publication_id', id),
      ]);
      if (publicationResult.error) {
        setError('DAO indisponible ou non accessible.');
        return;
      }
      setPublication(publicationResult.data);
      setLots((lotResult.data ?? []) as PublicationLot[]);
    })();
  }, [id]);

  if (error) return <p role="alert">{error}</p>;
  if (!publication) return <p>Chargement…</p>;
  return <section className="mx-auto max-w-4xl space-y-6">
    <div>
      <p className="text-sm font-semibold text-teal">DAO publié</p>
      <h1 className="mt-1 text-3xl font-bold">{publication.safe_title}</h1>
      <p className="mt-2 text-black/60">{publication.safe_description}</p>
      <div className="mt-3 flex gap-2"><Badge>{publication.visibility}</Badge><Badge>{publication.status}</Badge></div>
    </div>
    <Card>
      <h2 className="font-semibold">Lots proposés</h2>
      <div className="mt-4 space-y-3">
        {lots.map((lot) => <article key={lot.id} className="rounded-xl bg-sand/70 p-4">
          <h3 className="font-semibold">{lot.safe_title}</h3>
          <p className="mt-2 text-black/60">{lot.safe_scope}</p>
        </article>)}
      </div>
    </Card>
    <PublicationOffersPanel projectId={publication.project_id} lots={lots} />
  </section>;
}
