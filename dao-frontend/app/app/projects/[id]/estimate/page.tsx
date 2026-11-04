'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import ProjectEstimate from '../../../../../components/estimate/ProjectEstimate';

/** Budget prévisionnel indicatif du chantier (#551), rattaché à la fiche chantier. */
export default function ProjectEstimatePage() {
  const { id } = useParams<{ id: string }>();
  return <section className="space-y-5" aria-labelledby="estimate-title">
    <Link href={`/app/projects/${id}`} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-teal hover:underline"><ChevronLeft size={16} aria-hidden="true" />Retour au chantier</Link>
    <header>
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal">Chantier</p>
      <h1 id="estimate-title" className="mt-1 text-[1.75rem] font-bold leading-tight tracking-tight text-ink sm:text-3xl">Budget prévisionnel</h1>
      <p className="mt-2 max-w-3xl text-sm text-ink/70">Estimation déterministe et justifiée à partir des quantités fournies et des tarifs sourcés vérifiés. Chaque montant indique sa source, sa date, sa zone et la version du référentiel. Les quantités viennent des <Link href={`/app/projects/${id}/metres`} className="font-semibold text-teal underline">métrés validés</Link>.</p>
    </header>
    <ProjectEstimate projectId={id} />
  </section>;
}
