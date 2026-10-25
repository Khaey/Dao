'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import NativeExecutionLiveTable from '../../../../components/execution-native/NativeExecutionLiveTable';

/** Suivi natif (Tableau ou Gantt) ; accessible depuis Mes chantiers, la fiche chantier et le back-office (#419). */
export default function NativeExecutionPage() {
  const { projectId } = useParams<{ projectId: string }>();
  // Staff arrive from « Suivi terrain » (?from=dao) and go back there, not to a client list.
  const [fromDao, setFromDao] = useState(false);
  useEffect(() => { setFromDao(new URLSearchParams(window.location.search).get('from') === 'dao'); }, []);
  return <section className="mx-auto w-full max-w-7xl space-y-4">
    <Link href={fromDao ? '/app/dao/tracking' : '/app/projects'} className="inline-flex min-h-10 items-center text-sm font-semibold text-teal">
      {fromDao ? '← Suivi terrain' : '← Mes chantiers'}
    </Link>
    <NativeExecutionLiveTable projectId={projectId} />
  </section>;
}
