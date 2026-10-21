'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, CalendarClock, CheckCircle2, CircleDashed, CircleDot, FileText, Inbox, RotateCcw } from 'lucide-react';
import { supabaseBrowser } from '../../lib/supabase-browser';
import { readAgreement } from '../../lib/precontract';
import { professionalRead } from '../../lib/professionals';

// Client commercial progress of a published chantier (#346, #360): which lots already have a chosen Artisan, where
// to compare offers, and the next step. Computed from rows the Client may already read (publications, active
// award_items of live awards, submitted offers, his contracts) plus the Client-authorised public directory for the
// winner's public name — never from publication/project statuses, which mean something else, and never from the
// team assignment (project_requests.contractor_member_id), which is an internal, optional designation.
export type Publication = { id: string; safe_title: string; status: string; published_at: string | null };
export type LotAward = { awardId: string; contractorId: string; name: string | null; agreedMillimes: number; publicationId: string | null };
export type AgreementState = 'none' | 'negotiating' | 'agreed' | 'rejected' | 'unavailable';
export type ContractState = 'none' | 'preparing' | 'awaiting_signatures' | 'signed' | 'cancelled' | 'unknown';
export type CommercialProgress = {
  state: 'ready';
  publications: Publication[];
  lots: number; awarded: number;
  /** Active lots without an active award that already received at least one submitted offer (null = unknown). */
  lotsWithOffers: number | null;
  /** Lot ids with at least one current submitted offer (null = unknown). */
  offerLots: string[] | null;
  awardIds: string[];
  byLot: Record<string, LotAward>;
  agreements: Record<string, AgreementState>;
  contract: ContractState;
};
export type CommercialLoad = CommercialProgress | { state: 'loading' } | { state: 'error'; kind: 'forbidden' | 'network'; retry: () => void } | null;

const publicationLabels: Record<string, string> = { published: 'Publiée', suspended: 'Suspendue', closed: 'Clôturée', superseded: 'Remplacée', withdrawn: 'Retirée' };
const contractStates: Record<string, ContractState> = { draft: 'preparing', review: 'preparing', ready: 'preparing', awaiting_signatures: 'awaiting_signatures', signed: 'signed', cancelled: 'cancelled' };

type ReadError = { code?: string; message?: string; status?: number } | null | undefined;
const forbidden = (error: ReadError) => Boolean(error && (error.code === '42501' || error.code === 'PGRST301' || error.status === 401 || error.status === 403));

export function useCommercialProgress(projectId: string, activeLotIds: string[], enabled: boolean): CommercialLoad {
  const [progress, setProgress] = useState<CommercialLoad>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const key = activeLotIds.join(',');
  useEffect(() => {
    if (!enabled || !projectId) { setProgress(null); return; }
    let active = true;
    const fail = (error: ReadError) => { if (active) setProgress({ state: 'error', kind: forbidden(error) ? 'forbidden' : 'network', retry }); };
    setProgress(current => current && current.state === 'ready' ? current : { state: 'loading' });
    void (async () => {
      const supabase = supabaseBrowser();
      const [publications, items, bids, contracts] = await Promise.all([
        supabase.from('publications').select('id,safe_title,status,published_at').eq('project_id', projectId).order('published_at', { ascending: false }),
        supabase.from('award_items').select('award_id,request_id,contractor_id,agreed_millimes').eq('project_id', projectId).eq('active', true),
        supabase.from('bids').select('id').eq('project_id', projectId),
        supabase.from('contracts').select('award_id,status').eq('project_id', projectId),
      ]);
      if (!active) return;
      // A failed read is shown as such (#360): never an empty « en attente d’offres » built on missing data.
      if (publications.error || items.error) return fail((publications.error || items.error) as ReadError);
      const lotIds = new Set(activeLotIds);
      let rows = ((items.data ?? []) as { award_id: string; request_id: string; contractor_id: string; agreed_millimes: number }[]).filter(row => lotIds.has(row.request_id));
      if (rows.length) {
        const awards = await supabase.from('awards').select('id,status').in('id', [...new Set(rows.map(row => row.award_id))]);
        if (!active) return;
        if (awards.error) return fail(awards.error as ReadError);
        const live = new Set(((awards.data ?? []) as { id: string; status: string }[]).filter(row => row.status !== 'cancelled').map(row => row.id));
        rows = rows.filter(row => live.has(row.award_id));
      }
      const awardedLots = new Set<string>(rows.map(row => row.request_id));
      const awardIds = [...new Set(rows.map(row => row.award_id))];
      let lotsWithOffers: number | null = null, offerLots: string[] | null = null;
      if (!bids.error) {
        const bidIds = (bids.data ?? []).map(row => row.id);
        if (!bidIds.length) { lotsWithOffers = 0; offerLots = []; }
        else {
          const versions = await supabase.from('bid_versions').select('id').in('bid_id', bidIds).eq('status', 'submitted').eq('validity', 'current');
          const versionIds = (versions.data ?? []).map(row => row.id);
          const offered = versionIds.length ? await supabase.from('bid_items').select('request_id').in('bid_version_id', versionIds) : { data: [], error: null };
          if (!versions.error && !offered.error) {
            offerLots = [...new Set(((offered.data ?? []) as { request_id: string }[]).map(row => row.request_id).filter(id => lotIds.has(id)))];
            lotsWithOffers = offerLots.filter(id => !awardedLots.has(id)).length;
          }
        }
      }
      // Winner's public name: only through the directory the Client may already read; otherwise an honest fallback.
      const names = new Map<string, string>();
      if (rows.length) {
        const directory = await professionalRead({ view: 'directory', review: 'false' }).catch(() => null) as { id: string; name: string }[] | null;
        for (const row of Array.isArray(directory) ? directory : []) if (row?.id && row.name) names.set(row.id, row.name);
      }
      const all = (publications.data ?? []) as Publication[];
      const current = all.find(row => row.status === 'published') ?? all[0];
      const byLot: Record<string, LotAward> = {};
      for (const row of rows) byLot[row.request_id] = { awardId: row.award_id, contractorId: row.contractor_id, name: names.get(row.contractor_id) ?? null, agreedMillimes: Number(row.agreed_millimes), publicationId: current?.id ?? null };
      const snapshots = await Promise.all(awardIds.map(id => readAgreement(id).then(snapshot => [id, (snapshot?.agreement?.status ?? 'none') as AgreementState] as const).catch(() => [id, 'unavailable' as AgreementState] as const)));
      const contractRows = contracts.error ? null : ((contracts.data ?? []) as { award_id: string; status: string }[]).filter(row => awardIds.includes(row.award_id));
      const states = (contractRows ?? []).map(row => contractStates[row.status] ?? 'unknown');
      // « Signé » only when every live award's contract is proven signed.
      const contract: ContractState = contractRows === null ? 'unknown' : !states.length ? 'none'
        : states.length === awardIds.length && states.every(state => state === 'signed') ? 'signed' : states.includes('awaiting_signatures') ? 'awaiting_signatures'
        : states.every(state => state === 'cancelled') ? 'cancelled' : 'preparing';
      if (active) setProgress({ state: 'ready', publications: all, lots: lotIds.size, awarded: awardedLots.size, lotsWithOffers, offerLots, awardIds, byLot, agreements: Object.fromEntries(snapshots), contract });
    })().catch(() => fail(null));
    return () => { active = false; };
  }, [projectId, key, enabled, attempt, retry]);
  return progress;
}

export const isReady = (progress: CommercialLoad): progress is CommercialProgress => Boolean(progress && progress.state === 'ready');

/** Main commercial label for the header pill, or null when nothing is published yet (or unknown). */
export function commercialLabel(progress: CommercialLoad) {
  if (!isReady(progress) || !progress.publications.length || !progress.lots) return null;
  if (progress.awarded === 0) return progress.lotsWithOffers ? { text: 'Offres à comparer', tone: 'clay' as const } : null;
  if (progress.awarded === progress.lots) return { text: progress.lots === 1 ? 'Artisan choisi' : 'Tous les lots attribués', tone: 'teal' as const };
  return { text: `${progress.awarded} lots sur ${progress.lots} attribués`, tone: 'clay' as const };
}

type Step = { label: string; detail: string; state: 'done' | 'current' | 'todo' };
const works: Record<string, [string, Step['state']]> = {
  not_started: ['Pas commencés', 'todo'], started: ['Juste commencés', 'current'], in_progress: ['En cours', 'current'], completed: ['Terminés', 'done'],
};

/** Post-publication journey (#360), derived only from proven data: nothing is marked done by default. */
export function postPublicationSteps(progress: CommercialProgress, stage: string | null | undefined): Step[] {
  const { lots, awarded, offerLots, awardIds, agreements, contract } = progress;
  const offered = offerLots === null ? null : new Set([...offerLots, ...Object.keys(progress.byLot)]).size;
  const states = awardIds.map(id => agreements[id]);
  const agreed = states.length > 0 && states.every(state => state === 'agreed');
  const negotiating = states.some(state => state === 'negotiating');
  const [worksText, worksState]: [string, Step['state']] = awarded ? works[stage ?? ''] ?? ['À préciser', 'todo'] : ['Après le choix d’un Artisan', 'todo'];
  return [
    { label: 'Offres reçues', detail: offered === null ? 'Indisponible' : offered ? `${offered} lot${offered > 1 ? 's' : ''} sur ${lots}` : 'Aucune pour le moment', state: offered ? 'done' : 'current' },
    { label: 'Offre choisie', detail: `${awarded}/${lots} lot${lots > 1 ? 's' : ''} attribué${awarded > 1 ? 's' : ''}`, state: awarded === lots && lots > 0 ? 'done' : awarded ? 'current' : 'todo' },
    { label: 'Conditions et calendrier', detail: !awarded ? 'Après attribution' : agreed ? 'Convenus' : negotiating ? 'En discussion' : states.includes('unavailable') ? 'Indisponible' : 'À définir', state: agreed ? 'done' : awarded ? 'current' : 'todo' },
    { label: 'Contrat', detail: contract === 'signed' ? 'Signé' : contract === 'awaiting_signatures' ? 'En attente de signature' : contract === 'preparing' ? 'En préparation, non signé' : 'Non signé', state: contract === 'signed' ? 'done' : contract === 'awaiting_signatures' || contract === 'preparing' ? 'current' : 'todo' },
    { label: 'Travaux', detail: worksText, state: worksState },
    { label: 'Clôture', detail: 'Non clôturé', state: 'todo' },
  ];
}

/** « Offres et attribution » segment: summary, post-publication steps distinct from the dossier process, actions. */
export function CommercialPanel({ progress, stage, stageLabel }: { progress: CommercialLoad; stage?: string | null; stageLabel: string }) {
  if (!progress) return null;
  if (progress.state === 'loading') return <section aria-label="Offres et attribution" aria-busy="true" className="mt-5 rounded-2xl border border-black/[0.06] p-4 sm:p-5"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/65">Après publication</p><div className="mt-3 h-4 w-2/3 animate-pulse rounded bg-ink/[0.07]" /><span className="sr-only">Chargement des offres et de l’attribution…</span></section>;
  if (progress.state === 'error') return <section aria-label="Offres et attribution" className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 sm:p-5">
    <p role="alert" className="flex items-start gap-2 text-sm text-red-800"><AlertCircle aria-hidden="true" size={16} className="mt-0.5 shrink-0" /><span>{progress.kind === 'forbidden' ? 'Accès refusé : vos droits actuels ne permettent pas d’afficher les offres et l’attribution de ce chantier.' : 'Les offres et l’attribution n’ont pas pu être chargées (connexion interrompue ou service indisponible). Rien n’a été modifié.'}</span></p>
    <button type="button" onClick={progress.retry} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl border border-red-200 bg-white px-4 text-sm font-semibold text-red-800 hover:bg-red-100"><RotateCcw aria-hidden="true" size={15} />Réessayer</button>
  </section>;
  if (!progress.publications.length) return null;
  const { lots, awarded, lotsWithOffers, publications } = progress;
  const live = progress.awardIds.filter(id => progress.agreements[id] && progress.agreements[id] !== 'unavailable');
  const open = lots - awarded;
  const current = publications.find(row => row.status === 'published') ?? publications[0];
  const summary = awarded ? `${awarded} lot${awarded > 1 ? 's' : ''} sur ${lots} attribué${awarded > 1 ? 's' : ''} · ${stageLabel}` : lotsWithOffers ? `${lotsWithOffers} lot${lotsWithOffers > 1 ? 's' : ''} avec des offres reçues · aucun Artisan choisi` : 'En attente d’offres : aucune offre soumise pour le moment.';
  const steps = postPublicationSteps(progress, stage);
  return <section aria-label="Offres et attribution" className="mt-5 rounded-2xl border border-teal/15 bg-teal/[0.03] p-4 sm:p-5">
    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/65">Après publication</p>
    <p className="mt-1.5 text-sm font-semibold text-ink">{summary}</p>
    <ol className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6" aria-label="Étapes après publication">{steps.map(step => <li key={step.label} aria-current={step.state === 'current' ? 'step' : undefined} className={`min-w-0 rounded-xl border px-3 py-2 ${step.state === 'done' ? 'border-teal/25 bg-white' : step.state === 'current' ? 'border-clay/30 bg-white' : 'border-black/[0.06] bg-white/60'}`}>
      <span className={`flex items-center gap-1.5 text-xs font-semibold ${step.state === 'done' ? 'text-teal' : step.state === 'current' ? 'text-ink' : 'text-ink/55'}`}>{step.state === 'done' ? <CheckCircle2 aria-hidden="true" size={14} className="shrink-0" /> : step.state === 'current' ? <CircleDot aria-hidden="true" size={14} className="shrink-0 text-clay" /> : <CircleDashed aria-hidden="true" size={14} className="shrink-0" />}<span className="min-w-0 break-words">{step.label}</span></span>
      <span className="mt-0.5 block break-words text-xs text-ink/60">{step.detail}</span>
    </li>)}</ol>
    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      {publications.length === 1 ? <Link href={`/app/publications/${current.id}#offres`} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition ${open > 0 && lotsWithOffers ? 'bg-ink text-white hover:bg-teal' : 'border border-black/10 bg-white text-ink hover:border-teal'}`}>
        {open > 0 && lotsWithOffers ? <>Comparer et choisir une offre<ArrowRight aria-hidden="true" size={16} /></> : awarded ? <><FileText aria-hidden="true" size={16} />Voir les offres et l’attribution</> : <><Inbox aria-hidden="true" size={16} />Voir la publication</>}
      </Link> : <ul className="w-full space-y-2" aria-label="Publications de ce chantier">{publications.map(row => <li key={row.id}><Link href={`/app/publications/${row.id}#offres`} className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-xl border border-black/10 bg-white px-4 py-2 text-sm hover:border-teal"><span className="min-w-0 break-words font-semibold text-ink">{row.safe_title}</span><span className="text-xs text-ink/60">{publicationLabels[row.status] ?? row.status}{row.published_at ? ` · ${new Date(row.published_at).toLocaleDateString('fr-TN')}` : ''} · Voir les offres</span></Link></li>)}</ul>}
      {live.map((awardId, index) => <Link key={awardId} href={`/app/awards/${awardId}/conditions`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-teal/25 bg-white px-4 text-sm font-semibold text-teal hover:border-teal"><CalendarClock aria-hidden="true" size={16} />Définir les conditions avec l’Artisan{live.length > 1 ? ` (${index + 1})` : ''}</Link>)}
    </div>
    {awarded > 0 && <p className="mt-3 text-xs text-ink/55">Choisir une offre n’est pas signer un contrat. Les conditions et le calendrier se conviennent ensuite avec l’Artisan, sans effet juridique.</p>}
  </section>;
}
