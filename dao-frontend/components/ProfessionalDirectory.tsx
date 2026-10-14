'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowUpRight, Search, Users } from 'lucide-react';
import { Badge, Card, Input } from './ui';
import { professionalRead, professionalStatus } from '../lib/professionals';

type DirectoryRow = {
  id: string;
  name: string;
  city?: string | null;
  verification_status?: string | null;
  review_status?: string | null;
};

export default function ProfessionalDirectory({ review = false }: { review?: boolean }) {
  const [context, setContext] = useState('');
  const [rows, setRows] = useState<DirectoryRow[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (review) return;
    const params = new URLSearchParams(window.location.search);
    const projectId = params.get('project_id');
    const requestId = params.get('request_id');
    if (projectId && requestId && /^[0-9a-f-]{36}$/i.test(projectId) && /^[0-9a-f-]{36}$/i.test(requestId)) {
      setContext(`?project_id=${encodeURIComponent(projectId)}&request_id=${encodeURIComponent(requestId)}`);
    }
  }, [review]);

  useEffect(() => {
    let active = true;
    setRows(null);
    setError('');
    void professionalRead({ view: 'directory', review: String(review) })
      .then((result: DirectoryRow[]) => { if (active) setRows(result); })
      .catch((exception: Error) => { if (active) setError(exception.message); });
    return () => { active = false; };
  }, [review]);

  const visible = (rows ?? []).filter((professional) =>
    `${professional.name} ${professional.city ?? ''}`.toLowerCase().includes(query.toLowerCase().trim()),
  );

  return <section className="mx-auto w-full max-w-6xl space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal">
          {review ? 'Gestion des dossiers' : 'Annuaire D.A.O'}
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-ink">
          {review ? 'Dossiers professionnels à contrôler' : 'Professionnels vérifiés'}
        </h1>
        <p className="max-w-2xl text-sm text-black/55">
          {review
            ? 'Contrôlez les informations déclarées, la visibilité et les médias avant publication.'
            : 'Découvrez les professionnels disponibles et consultez leurs réalisations.'}
        </p>
      </div>
      {rows && <Badge tone="neutral">{visible.length} professionnel{visible.length > 1 ? 's' : ''}</Badge>}
    </div>

    {context && <Card className="border-teal/10 bg-teal/5">
      <p className="text-sm text-teal">Sélectionnez une fiche pour ce lot. L’invitation se prépare depuis l’équipe du chantier après votre choix.</p>
    </Card>}

    <Card className="space-y-3 p-5 sm:p-6">
      <label htmlFor="professional-search" className="block text-sm font-semibold text-ink">Rechercher par nom ou ville</label>
      <div className="relative">
        <Search aria-hidden="true" size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-black/40" />
        <Input id="professional-search" value={query} onChange={(event) => setQuery(event.target.value)} className="pl-11" placeholder="Nom d’entreprise, artisan ou ville…" />
      </div>
    </Card>

    {error && <Card className="border-red-200 bg-red-50"><p role="alert" className="text-sm text-red-700">{error}</p></Card>}
    {!rows && !error && <p role="status" className="rounded-2xl bg-white p-6 text-sm text-black/55">Chargement des professionnels…</p>}
    {rows && visible.length === 0 && <Card className="flex flex-col items-center gap-3 px-5 py-10 text-center sm:py-14">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-teal/10 text-teal"><Users aria-hidden="true" size={24} /></div>
      <h2 className="text-lg font-bold text-ink">{query.trim()
        ? 'Aucun résultat pour votre recherche'
        : review ? 'Aucun dossier à contrôler pour le moment' : 'Aucun professionnel disponible pour le moment'}</h2>
      <p className="max-w-md text-sm text-black/55">{query.trim()
        ? 'Essayez un autre nom ou une autre ville.'
        : review ? 'Les nouveaux dossiers apparaîtront ici dès leur soumission.' : 'Revenez prochainement pour découvrir les professionnels référencés sur D.A.O.'}</p>
      {!review && <Link href="/app/projects" className="mt-2 inline-flex min-h-10 items-center rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:border-teal hover:text-teal">Retour à mes chantiers</Link>}
    </Card>}

    {visible.length > 0 && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {visible.map((professional) => <Link key={professional.id}
        href={review ? `/app/dao/professionals/${professional.id}/dossier` : `/app/professionals/${professional.id}${context}`}
        className="group block rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal">
        <Card className="flex h-full flex-col gap-3 transition group-hover:border-teal/30 group-hover:shadow-md">
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-bold text-ink">{professional.name}</h2>
            <ArrowUpRight aria-hidden="true" size={18} className="shrink-0 text-teal" />
          </div>
          <p className="text-sm text-black/55">{professional.city || 'Ville non renseignée'}</p>
          <div className="mt-auto flex flex-wrap gap-2 pt-2">
            <Badge tone={professional.verification_status === 'verified' ? 'teal' : professional.verification_status === 'suspended' ? 'red' : 'clay'}>
              {professional.verification_status === 'verified' ? 'Vérifié par DAO' : professional.verification_status === 'suspended' ? 'Suspendu' : 'Vérification en attente / à corriger'}
            </Badge>
            {review && <Badge>{professionalStatus[professional.review_status ?? ''] || 'Dossier à compléter'}</Badge>}
          </div>
        </Card>
      </Link>)}
    </div>}
  </section>;
}
