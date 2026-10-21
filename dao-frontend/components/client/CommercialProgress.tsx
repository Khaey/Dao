'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, CalendarClock, CheckCircle2, CircleDashed, FileText, Inbox } from 'lucide-react';
import { supabaseBrowser } from '../../lib/supabase-browser';
import { readAgreement } from '../../lib/precontract';

// Client commercial progress of a published chantier (#346): which lots already have a chosen Artisan, where to
// compare offers, and the next step. Computed from rows the Client may already read (publications, active
// award_items, submitted offers) — never from publication/project statuses, which mean something else.
export type Publication = { id: string; safe_title: string; status: string; published_at: string | null };
export type CommercialProgress = {
  publications: Publication[];
  lots: number; awarded: number;
  /** Active lots without an active award that already received at least one submitted offer (null = unknown). */
  lotsWithOffers: number | null;
  awardIds: string[];
};

const publicationLabels: Record<string, string> = { published: 'Publiée', suspended: 'Suspendue', closed: 'Clôturée', superseded: 'Remplacée', withdrawn: 'Retirée' };

export function useCommercialProgress(projectId: string, activeLotIds: string[], enabled: boolean) {
  const [progress, setProgress] = useState<CommercialProgress | null>(null);
  const key = activeLotIds.join(',');
  useEffect(() => {
    if (!enabled || !projectId) { setProgress(null); return; }
    let active = true;
    void (async () => {
      const supabase = supabaseBrowser();
      const [publications, awards, bids] = await Promise.all([
        supabase.from('publications').select('id,safe_title,status,published_at').eq('project_id', projectId).order('published_at', { ascending: false }),
        supabase.from('award_items').select('award_id,request_id').eq('project_id', projectId).eq('active', true),
        supabase.from('bids').select('id').eq('project_id', projectId),
      ]);
      if (!active || publications.error || awards.error) return;
      const lotIds = new Set(activeLotIds);
      const awardRows = ((awards.data ?? []) as { award_id: string; request_id: string }[]).filter(row => lotIds.has(row.request_id));
      const awardedLots = new Set<string>(awardRows.map(row => row.request_id));
      let lotsWithOffers: number | null = null;
      if (!bids.error) {
        const bidIds = (bids.data ?? []).map(row => row.id);
        if (!bidIds.length) lotsWithOffers = 0;
        else {
          const versions = await supabase.from('bid_versions').select('id').in('bid_id', bidIds).eq('status', 'submitted').eq('validity', 'current');
          const versionIds = (versions.data ?? []).map(row => row.id);
          const items = versionIds.length ? await supabase.from('bid_items').select('request_id').in('bid_version_id', versionIds) : { data: [], error: null };
          if (!versions.error && !items.error) lotsWithOffers = new Set((items.data ?? []).map(row => row.request_id).filter(id => lotIds.has(id) && !awardedLots.has(id))).size;
        }
      }
      if (active) setProgress({ publications: (publications.data ?? []) as Publication[], lots: lotIds.size, awarded: awardedLots.size, lotsWithOffers, awardIds: [...new Set(awardRows.map((row: { award_id: string }) => row.award_id))] });
    })();
    return () => { active = false; };
  }, [projectId, key, enabled]);
  return progress;
}

/** Main commercial label for the header pill, or null when nothing is published yet. */
export function commercialLabel(progress: CommercialProgress | null) {
  if (!progress || !progress.publications.length || !progress.lots) return null;
  if (progress.awarded === 0) return progress.lotsWithOffers ? { text: 'Offres à comparer', tone: 'clay' as const } : null;
  if (progress.awarded === progress.lots) return { text: progress.lots === 1 ? 'Artisan choisi' : 'Tous les lots attribués', tone: 'teal' as const };
  return { text: `${progress.awarded} lots sur ${progress.lots} attribués`, tone: 'clay' as const };
}

/** « Offres et attribution » segment: summary, steps distinct from the dossier process, and direct actions. */
export function CommercialPanel({ progress, stageLabel }: { progress: CommercialProgress; stageLabel: string }) {
  const live = useAgreementsLive(progress.awardIds);
  if (!progress.publications.length) return null;
  const { lots, awarded, lotsWithOffers, publications } = progress;
  const open = lots - awarded;
  const current = publications.find(row => row.status === 'published') ?? publications[0];
  const summary = awarded ? `${awarded} lot${awarded > 1 ? 's' : ''} sur ${lots} attribué${awarded > 1 ? 's' : ''} · ${stageLabel}` : lotsWithOffers ? `${lotsWithOffers} lot${lotsWithOffers > 1 ? 's' : ''} avec des offres reçues · aucun Artisan choisi` : 'En attente d’offres : aucune offre soumise pour le moment.';
  const steps: [string, boolean][] = [['Offre choisie', awarded > 0], ['Conditions et calendrier', false], ['Contrat (non signé)', false]];
  return <section aria-labelledby="commercial-title" className="mt-5 rounded-2xl border border-teal/15 bg-teal/[0.03] p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1"><p id="commercial-title" className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/65">Offres et attribution</p><p className="mt-1.5 text-sm font-semibold text-ink">{summary}</p></div>
    </div>
    <ol className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold" aria-label="Étapes après publication">{steps.map(([label, done], index) => <li key={label} className={`inline-flex items-center gap-1.5 ${done ? 'text-teal' : 'text-ink/50'}`}>{done ? <CheckCircle2 aria-hidden="true" size={14} /> : <CircleDashed aria-hidden="true" size={14} />}{label}{index < steps.length - 1 && <span aria-hidden="true" className="ml-1 text-ink/30">→</span>}</li>)}</ol>
    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      {publications.length === 1 ? <Link href={`/app/publications/${current.id}#offres`} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition ${open > 0 && lotsWithOffers ? 'bg-ink text-white hover:bg-teal' : 'border border-black/10 bg-white text-ink hover:border-teal'}`}>
        {open > 0 && lotsWithOffers ? <>Comparer et choisir une offre<ArrowRight aria-hidden="true" size={16} /></> : awarded ? <><FileText aria-hidden="true" size={16} />Voir les offres et l’attribution</> : <><Inbox aria-hidden="true" size={16} />Voir la publication</>}
      </Link> : <ul className="w-full space-y-2" aria-label="Publications de ce chantier">{publications.map(row => <li key={row.id}><Link href={`/app/publications/${row.id}#offres`} className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-xl border border-black/10 bg-white px-4 py-2 text-sm hover:border-teal"><span className="min-w-0 break-words font-semibold text-ink">{row.safe_title}</span><span className="text-xs text-ink/60">{publicationLabels[row.status] ?? row.status}{row.published_at ? ` · ${new Date(row.published_at).toLocaleDateString('fr-TN')}` : ''} · Voir les offres</span></Link></li>)}</ul>}
      {live.map((awardId, index) => <Link key={awardId} href={`/app/awards/${awardId}/conditions`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-teal/25 bg-white px-4 text-sm font-semibold text-teal hover:border-teal"><CalendarClock aria-hidden="true" size={16} />Définir les conditions avec l’Artisan{live.length > 1 ? ` (${index + 1})` : ''}</Link>)}
    </div>
    {awarded > 0 && <p className="mt-3 text-xs text-ink/55">Choisir une offre n’est pas signer un contrat. Les conditions et le calendrier se conviennent ensuite avec l’Artisan, sans effet juridique.</p>}
  </section>;
}

/** Awards whose agreement service answers for this viewer; nothing is linked while it is unavailable. */
function useAgreementsLive(awardIds: string[]) {
  const [live, setLive] = useState<string[]>([]);
  const key = awardIds.join(',');
  useEffect(() => {
    let active = true;
    void Promise.all(awardIds.map(id => readAgreement(id).then(() => id).catch(() => null))).then(rows => { if (active) setLive(rows.filter((id): id is string => Boolean(id))); });
    return () => { active = false; };
  }, [key]);
  return live;
}
