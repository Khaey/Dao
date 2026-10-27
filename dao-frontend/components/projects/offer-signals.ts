'use client';

import { useEffect, useState } from 'react';
import { supabaseBrowser } from '../../lib/supabase-browser';

// Commercial signals for « Mes chantiers » (#356), batched per page — never one query per row.
// Client: offers received on HIS chantiers (rows his JWT already reads). Artisan: only HIS own offers/awards,
// never competitors' volumes. A failed read yields `unknown`, never « aucune offre ».

export type ClientOffers = { state: 'none' | 'received' | 'to_compare' | 'awarded' | 'unknown'; offers: number; lots: number; awardedLots: number; publicationId: string | null };
export type MyOfferState = 'none' | 'pending' | 'won' | 'partial' | 'lost' | 'cancelled';

export const clientOfferLabels: Record<ClientOffers['state'], string> = {
  none: 'Aucune offre reçue', received: 'Offres reçues', to_compare: 'Offres à comparer', awarded: 'Lot(s) attribué(s)', unknown: 'Offres indisponibles',
};
export const myOfferLabels: Record<MyOfferState, string> = {
  none: 'Aucune candidature', pending: 'Offre envoyée — en attente', won: 'Retenue', partial: 'Partiellement retenue', lost: 'Non retenue', cancelled: 'Attribution annulée',
};

type Lot = { id: string; project_id: string };

export function useClientOffers(projectIds: string[], lots: Lot[], enabled: boolean) {
  const [signals, setSignals] = useState<Record<string, ClientOffers>>({});
  const [failed, setFailed] = useState(false);
  const key = projectIds.join(',');
  const lotKey = lots.map(lot => lot.id).join(',');
  useEffect(() => {
    if (!enabled || !projectIds.length) { setSignals({}); return; }
    let active = true;
    void (async () => {
      const supabase = supabaseBrowser();
      const [awards, bids, publications] = await Promise.all([
        supabase.from('award_items').select('project_id,request_id').in('project_id', projectIds).eq('active', true),
        supabase.from('bids').select('id,project_id').in('project_id', projectIds),
        supabase.from('publications').select('id,project_id,status,published_at').in('project_id', projectIds).order('published_at', { ascending: false }),
      ]);
      let items: { request_id: string; bid_version_id: string }[] = [];
      let readFailed = Boolean(awards.error || bids.error || publications.error);
      const bidProject = new Map(((bids.data ?? []) as { id: string; project_id: string }[]).map(row => [row.id, row.project_id]));
      const versionBid = new Map<string, string>();
      if (!readFailed && bidProject.size) {
        const versions = await supabase.from('bid_versions').select('id,bid_id').in('bid_id', [...bidProject.keys()]).eq('status', 'submitted').eq('validity', 'current');
        if (versions.error) readFailed = true;
        for (const row of (versions.data ?? []) as { id: string; bid_id: string }[]) versionBid.set(row.id, row.bid_id);
        if (versionBid.size) {
          const result = await supabase.from('bid_items').select('request_id,bid_version_id').in('bid_version_id', [...versionBid.keys()]);
          if (result.error) readFailed = true; else items = (result.data ?? []) as typeof items;
        }
      }
      if (!active) return;
      setFailed(readFailed);
      const awarded = new Set(((awards.data ?? []) as { request_id: string }[]).map(row => row.request_id));
      const next: Record<string, ClientOffers> = {};
      for (const projectId of projectIds) {
        const projectLots = lots.filter(lot => lot.project_id === projectId).map(lot => lot.id);
        const lotSet = new Set(projectLots);
        const relevant = items.filter(item => lotSet.has(item.request_id));
        const offers = new Set(relevant.map(item => item.bid_version_id)).size;
        const awardedLots = projectLots.filter(id => awarded.has(id)).length;
        const toCompare = relevant.some(item => !awarded.has(item.request_id));
        const publication = ((publications.data ?? []) as { id: string; project_id: string; status: string }[]).find(row => row.project_id === projectId && row.status === 'published') ?? ((publications.data ?? []) as { id: string; project_id: string }[]).find(row => row.project_id === projectId);
        next[projectId] = {
          state: readFailed ? 'unknown' : awardedLots > 0 && !toCompare ? 'awarded' : toCompare ? 'to_compare' : offers > 0 ? 'received' : 'none',
          offers, lots: projectLots.length, awardedLots, publicationId: publication?.id ?? null,
        };
      }
      setSignals(next);
    })();
    return () => { active = false; };
  }, [key, lotKey, enabled]);
  return { signals, failed };
}

type Summary = { id: string; project_id: string; status: string; validity: string; lot_count: number; selected_count: number; not_selected_count: number };

/** Artisan: state of HIS offers per chantier, from my_bid_summaries + his active/cancelled awards (#361 rules). */
export function useMyOffers(enabled: boolean, activeByVersion: Record<string, number>, cancelledByVersion: Record<string, number>) {
  const [read, setRead] = useState<{ summaries: Summary[]; ready: boolean; failed: boolean }>({ summaries: [], ready: false, failed: false });
  useEffect(() => {
    if (!enabled) { setRead({ summaries: [], ready: false, failed: false }); return; }
    let active = true;
    setRead({ summaries: [], ready: false, failed: false });
    void Promise.resolve(supabaseBrowser().rpc('my_bid_summaries'))
      .then(({ data, error }) => { if (active) setRead({ summaries: error ? [] : (data ?? []) as Summary[], ready: true, failed: Boolean(error) }); })
      .catch(() => { if (active) setRead({ summaries: [], ready: true, failed: true }); });
    return () => { active = false; };
  }, [enabled]);
  const byProject: Record<string, MyOfferState> = {};
  const rank: Record<MyOfferState, number> = { none: 0, lost: 1, cancelled: 2, pending: 3, partial: 4, won: 5 };
  for (const offer of read.summaries) {
    if (offer.status === 'draft') continue;
    const won = activeByVersion[offer.id] ?? 0;
    const pending = Math.max(0, offer.lot_count - offer.selected_count - offer.not_selected_count);
    const state: MyOfferState = won > 0 ? (won >= offer.lot_count ? 'won' : 'partial')
      : (cancelledByVersion[offer.id] ?? 0) > 0 || offer.selected_count > 0 ? 'cancelled'
      : offer.status === 'submitted' && offer.validity === 'current' && pending > 0 ? 'pending'
      : offer.not_selected_count > 0 ? 'lost' : 'none';
    if (rank[state] > rank[byProject[offer.project_id] ?? 'none']) byProject[offer.project_id] = state;
  }
  return { byProject, ready: read.ready, failed: read.failed };
}
