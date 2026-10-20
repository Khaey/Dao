'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import AgreementPanel from '../../../../../components/precontract/AgreementPanel';

export default function AwardConditionsPage() {
  const { awardId } = useParams<{ awardId: string }>();
  return <section className="mx-auto w-full max-w-4xl space-y-5">
    <Link href="/app/projects" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-teal"><ArrowLeft aria-hidden="true" size={16} />Mes chantiers</Link>
    {awardId && <AgreementPanel awardId={awardId} />}
  </section>;
}
