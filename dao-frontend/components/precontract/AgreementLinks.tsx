'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CalendarClock, ChevronRight } from 'lucide-react';
import { supabaseBrowser } from '../../lib/supabase-browser';

/**
 * Entry to « Conditions et calendrier » for the active awards of a project the viewer may read (Client owner or
 * awarded Artisan — existing award RLS). `awardId` links one known award directly. Renders nothing otherwise.
 */
export default function AgreementLinks({ projectId, awardId, compact = false }: { projectId?: string; awardId?: string; compact?: boolean }) {
  const [awards, setAwards] = useState<string[]>(awardId ? [awardId] : []);
  useEffect(() => {
    if (awardId || !projectId) return;
    let active = true;
    void supabaseBrowser().from('award_items').select('award_id').eq('project_id', projectId).eq('active', true)
      .then(({ data }) => { if (active) setAwards([...new Set((data ?? []).map((row: { award_id: string }) => row.award_id))]); });
    return () => { active = false; };
  }, [projectId, awardId]);
  if (!awards.length) return null;
  if (compact) return <>{awards.map(id => <Link key={id} href={`/app/awards/${id}/conditions`} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-teal/25 bg-white px-3.5 text-sm font-semibold text-teal hover:border-teal"><CalendarClock aria-hidden="true" size={16} />Conditions et calendrier</Link>)}</>;
  return <div className="space-y-2">{awards.map((id, index) => <Link key={id} href={`/app/awards/${id}/conditions`} className="group flex min-h-14 items-center gap-3 rounded-2xl border border-teal/20 bg-teal/[0.04] px-4 py-3 transition hover:border-teal/50">
    <CalendarClock aria-hidden="true" size={20} className="shrink-0 text-teal" />
    <span className="min-w-0 flex-1"><span className="block text-sm font-bold text-ink">Conditions et calendrier{awards.length > 1 ? ` — attribution ${index + 1}` : ''}</span><span className="block text-xs text-black/55">Convenez des dates et modalités avec l’autre partie avant le contrat. Facultatif.</span></span>
    <ChevronRight aria-hidden="true" size={18} className="shrink-0 text-teal transition group-hover:translate-x-0.5" />
  </Link>)}</div>;
}
