'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import ProjectTakeoffs from '../../../../../components/takeoffs/ProjectTakeoffs';

/** Métrés du chantier (#560) : dimensions réelles → calcul justifié (#548) → validation → budget (#551). */
export default function ProjectTakeoffsPage() {
  const { id } = useParams<{ id: string }>();
  return <section className="space-y-5" aria-labelledby="takeoffs-title">
    <Link href={`/app/projects/${id}`} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-teal hover:underline"><ChevronLeft size={16} aria-hidden="true" />Retour au chantier</Link>
    <header>
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal">Chantier · Quantités &amp; estimation</p>
      <h1 id="takeoffs-title" className="mt-1 text-[1.75rem] font-bold leading-tight tracking-tight text-ink sm:text-3xl">Métrés</h1>
      <p className="mt-2 max-w-3xl text-sm text-ink/70">Saisissez les dimensions réelles de chaque ouvrage et leur provenance. Le calcul suit le modèle publié du référentiel, chaque étape est justifiée et chaque correction crée une nouvelle révision.</p>
    </header>
    <ProjectTakeoffs projectId={id} />
  </section>;
}
