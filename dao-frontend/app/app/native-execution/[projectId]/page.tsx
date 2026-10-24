'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import NativeExecutionLiveTable from '../../../../components/execution-native/NativeExecutionLiveTable';

/** Route d'intégration isolée #410 ; ne modifie ni Mes chantiers ni le carnet existant. */
export default function NativeExecutionPage() {
  const { projectId } = useParams<{ projectId: string }>();
  return <section className="mx-auto w-full max-w-7xl space-y-4">
    <Link href="/app/projects" className="inline-flex min-h-10 items-center text-sm font-semibold text-teal">
      ← Mes chantiers
    </Link>
    <NativeExecutionLiveTable projectId={projectId} />
  </section>;
}
