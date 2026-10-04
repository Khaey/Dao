'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card } from '../../../../components/ui';
import { projectApi } from '../../../../lib/collaboration';
import { supabaseBrowser } from '../../../../lib/supabase-browser';

type Lot = { id: string; request_version_id: string; safe_title: string };
type Offer = {
  itemId: string;
  versionId: string;
  versionNo: number;
  requestId: string;
  requestVersionId: string;
  priceMillimes: number;
  durationDays: number;
  inclusions: string;
  exclusions: string | null;
  submittedAt: string;
  indivisibleGroup: boolean;
};
type Award = { request_id: string; bid_item_id: string; agreed_millimes: number; active: boolean };

function formatTnd(value: number) {
  return new Intl.NumberFormat('fr-TN', {
    style: 'currency',
    currency: 'TND',
    maximumFractionDigits: 3,
  }).format(value / 1000);
}

export default function PublicationOffersPanel({ projectId, lots }: { projectId: string; lots: Lot[] }) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [awards, setAwards] = useState<Award[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const supabase = supabaseBrowser();
    const bidsResult = await supabase.from('bids').select('id').eq('project_id', projectId);
    if (bidsResult.error) throw new Error('Les offres ne sont pas disponibles.');
    const bidIds = (bidsResult.data ?? []).map((bid: { id: string }) => bid.id);
    const awardResult = await supabase
      .from('award_items')
      .select('request_id,bid_item_id,agreed_millimes,active')
      .eq('project_id', projectId)
      .eq('active', true);
    if (awardResult.error) throw new Error('Les attributions ne sont pas disponibles.');
    setAwards((awardResult.data ?? []) as Award[]);
    if (!bidIds.length) {
      setOffers([]);
      setLoading(false);
      return;
    }

    const versionsResult = await supabase
      .from('bid_versions')
      .select('id,bid_id,version_no,submitted_at')
      .in('bid_id', bidIds)
      .eq('status', 'submitted')
      .eq('validity', 'current');
    if (versionsResult.error) throw new Error('Les offres ne sont pas disponibles.');
    const versions = versionsResult.data ?? [];
    const versionIds = versions.map((version: { id: string }) => version.id);
    if (!versionIds.length) {
      setOffers([]);
      setLoading(false);
      return;
    }

    const [itemsResult, groupsResult] = await Promise.all([
      supabase
        .from('bid_items')
        .select('id,bid_version_id,request_id,request_version_id,price_millimes,duration_days,inclusions,exclusions')
        .in('bid_version_id', versionIds),
      supabase.from('bid_groups').select('id,bid_version_id,indivisible').in('bid_version_id', versionIds).eq('indivisible', true),
    ]);
    if (itemsResult.error || groupsResult.error) throw new Error('Les offres ne sont pas disponibles.');
    const groupIds = (groupsResult.data ?? []).map((group: { id: string }) => group.id);
    const groupItemsResult = groupIds.length
      ? await supabase.from('bid_group_items').select('group_id,bid_item_id').in('group_id', groupIds)
      : { data: [], error: null };
    if (groupItemsResult.error) throw new Error('Les offres groupées ne sont pas disponibles.');

    const groupSizes = new Map<string, number>();
    for (const item of groupItemsResult.data ?? []) groupSizes.set(item.group_id, (groupSizes.get(item.group_id) ?? 0) + 1);
    const indivisibleItems = new Set(
      (groupItemsResult.data ?? [])
        .filter((item) => (groupSizes.get(item.group_id) ?? 0) > 1)
        .map((item) => item.bid_item_id),
    );
    const versionById = new Map(versions.map((version: any) => [version.id, version]));
    setOffers((itemsResult.data ?? []).map((item: any) => {
      const version = versionById.get(item.bid_version_id) as any;
      return {
        itemId: item.id,
        versionId: item.bid_version_id,
        versionNo: Number(version?.version_no ?? 0),
        requestId: item.request_id,
        requestVersionId: item.request_version_id,
        priceMillimes: Number(item.price_millimes),
        durationDays: Number(item.duration_days),
        inclusions: item.inclusions ?? '',
        exclusions: item.exclusions ?? null,
        submittedAt: version?.submitted_at ?? '',
        indivisibleGroup: indivisibleItems.has(item.id),
      };
    }));
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    let active = true;
    void load().catch((cause: any) => {
      if (active) {
        setError(cause?.message || 'Les offres ne sont pas disponibles.');
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [load]);

  const grouped = useMemo(() => {
    const byLot = new Map<string, Offer[]>();
    for (const offer of offers) byLot.set(offer.requestVersionId, [...(byLot.get(offer.requestVersionId) ?? []), offer]);
    for (const values of byLot.values()) values.sort((a, b) => a.priceMillimes - b.priceMillimes || a.durationDays - b.durationDays);
    return byLot;
  }, [offers]);
  const activeAward = useMemo(() => new Map(awards.map((award) => [award.request_id, award])), [awards]);

  async function award(offer: Offer) {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await projectApi('/api/awards', { bid_item_id: offer.itemId, idempotency_key: crypto.randomUUID() });
      setConfirming(null);
      setMessage('L’offre a été attribuée pour ce lot. Aucun contrat n’a été créé automatiquement.');
      await load();
    } catch (cause: any) {
      setError(cause?.message || 'Attribution refusée.');
    } finally {
      setSaving(false);
    }
  }

  return <Card>
    <h2 className="font-semibold">Comparer et attribuer les offres</h2>
    <p className="mt-1 text-sm text-black/55">Seule la version soumise actuelle de chaque offre est comparée. L’attribution porte sur un lot et ne crée ni contrat ni démarrage de travaux.</p>
    {loading && <p className="mt-4 text-sm text-black/60">Chargement des offres…</p>}
    {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
    {message && <p role="status" className="mt-4 text-sm text-teal">{message}</p>}
    {!loading && lots.map((lot) => {
      const lotOffers = grouped.get(lot.request_version_id) ?? [];
      const awarded = lotOffers.length ? activeAward.get(lotOffers[0].requestId) : undefined;
      return <section key={lot.id} className="mt-5 rounded-xl border border-black/5 p-4" aria-labelledby={`lot-${lot.id}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={`lot-${lot.id}`} className="font-semibold">{lot.safe_title}</h3>
          {awarded && <Badge tone="teal">Lot attribué</Badge>}
        </div>
        {lotOffers.length === 0 ? <p className="mt-2 text-sm text-black/60">Aucune offre soumise pour ce lot.</p> : <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {lotOffers.map((offer, index) => {
            const isWinner = awarded?.bid_item_id === offer.itemId;
            return <article key={offer.itemId} data-testid="offer-card" className={`rounded-xl p-4 ${isWinner ? 'border border-teal/30 bg-teal/5' : 'bg-sand/70'}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">Offre {index + 1}</p>
                <p className="text-sm font-semibold text-teal">{formatTnd(offer.priceMillimes)}</p>
              </div>
              <p className="mt-1 text-sm text-black/60">Délai proposé : {offer.durationDays} jour{offer.durationDays > 1 ? 's' : ''}</p>
              <p className="mt-1 text-xs text-black/40">Version {offer.versionNo} · soumise le {new Date(offer.submittedAt).toLocaleDateString('fr-TN')}</p>
              <p className="mt-3 whitespace-pre-wrap text-sm">{offer.inclusions}</p>
              {offer.exclusions && <p className="mt-2 whitespace-pre-wrap text-sm text-black/60">Exclusions : {offer.exclusions}</p>}
              {isWinner ? <p className="mt-4 text-sm font-semibold text-teal">Offre retenue · {formatTnd(Number(awarded.agreed_millimes))}</p> : !awarded && offer.indivisibleGroup ? <p className="mt-4 text-xs font-semibold text-clay">Offre groupée indivisible : attribution groupée requise.</p> : !awarded && confirming === offer.itemId ? <div className="mt-4 rounded-xl border border-clay/20 bg-white p-3">
                <p className="text-sm font-medium">Confirmer l’attribution de ce lot à cette offre ?</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button disabled={saving} onClick={() => void award(offer)}>{saving ? 'Attribution…' : 'Confirmer l’attribution'}</Button>
                  <Button disabled={saving} className="bg-white text-ink ring-1 ring-black/10 hover:bg-sand" onClick={() => setConfirming(null)}>Annuler</Button>
                </div>
              </div> : !awarded && <Button className="mt-4" onClick={() => setConfirming(offer.itemId)}>Attribuer cette offre</Button>}
            </article>;
          })}
        </div>}
      </section>;
    })}
  </Card>;
}
