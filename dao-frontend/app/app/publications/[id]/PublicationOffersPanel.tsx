'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card } from '../../../../components/ui';
import { supabaseBrowser } from '../../../../lib/supabase-browser';

type Lot = { id: string; request_version_id: string; safe_title: string };
type Offer = {
  bidId: string;
  versionId: string;
  versionNo: number;
  requestVersionId: string;
  priceMillimes: number;
  durationDays: number;
  inclusions: string;
  exclusions: string | null;
  submittedAt: string | null;
};

function formatTnd(value: number) {
  return new Intl.NumberFormat('fr-TN', {
    style: 'currency',
    currency: 'TND',
    maximumFractionDigits: 3,
  }).format(value / 1000);
}

export default function PublicationOffersPanel({ projectId, lots }: { publicationId: string; projectId: string; lots: Lot[] }) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      setError('');
      const supabase = supabaseBrowser();
      const bidsResult = await supabase.from('bids').select('id').eq('project_id', projectId);
      if (bidsResult.error) {
        if (active) setError('Les offres ne sont pas disponibles.');
        setLoading(false);
        return;
      }
      const bidIds = (bidsResult.data ?? []).map((bid: { id: string }) => bid.id);
      if (!bidIds.length) {
        if (active) setOffers([]);
        setLoading(false);
        return;
      }
      const versionsResult = await supabase
        .from('bid_versions')
        .select('id,bid_id,version_no,submitted_at')
        .in('bid_id', bidIds)
        .eq('status', 'submitted')
        .order('version_no', { ascending: false });
      if (versionsResult.error) {
        if (active) setError('Les offres ne sont pas disponibles.');
        setLoading(false);
        return;
      }
      const latest = new Map<string, { id: string; bid_id: string; version_no: number; submitted_at: string | null }>();
      for (const version of versionsResult.data ?? []) if (!latest.has(version.bid_id)) latest.set(version.bid_id, version);
      const versionIds = [...latest.values()].map((version) => version.id);
      if (!versionIds.length) {
        if (active) setOffers([]);
        setLoading(false);
        return;
      }
      const itemsResult = await supabase
        .from('bid_items')
        .select('bid_version_id,request_version_id,price_millimes,duration_days,inclusions,exclusions')
        .in('bid_version_id', versionIds);
      if (itemsResult.error) {
        if (active) setError('Les offres ne sont pas disponibles.');
        setLoading(false);
        return;
      }
      const versionById = new Map([...latest.values()].map((version) => [version.id, version]));
      const nextOffers = (itemsResult.data ?? []).map((item: any) => {
        const version = versionById.get(item.bid_version_id);
        return {
          bidId: version?.bid_id ?? '',
          versionId: item.bid_version_id,
          versionNo: Number(version?.version_no ?? 0),
          requestVersionId: item.request_version_id,
          priceMillimes: Number(item.price_millimes),
          durationDays: Number(item.duration_days),
          inclusions: item.inclusions ?? '',
          exclusions: item.exclusions ?? null,
          submittedAt: version?.submitted_at ?? null,
        };
      });
      if (active) setOffers(nextOffers);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [projectId]);

  const grouped = useMemo(() => {
    const byLot = new Map<string, Offer[]>();
    for (const offer of offers) byLot.set(offer.requestVersionId, [...(byLot.get(offer.requestVersionId) ?? []), offer]);
    for (const values of byLot.values()) values.sort((a, b) => a.priceMillimes - b.priceMillimes || a.durationDays - b.durationDays);
    return byLot;
  }, [offers]);

  return <Card>
    <h2 className="font-semibold">Comparer les offres</h2>
    <p className="mt-1 text-sm text-black/55">Seules les offres soumises sont visibles. Les brouillons et les informations privées restent protégés.</p>
    {loading && <p className="mt-4 text-sm text-black/60">Chargement des offres…</p>}
    {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
    {!loading && !error && lots.map((lot) => {
      const lotOffers = grouped.get(lot.request_version_id) ?? [];
      return <section key={lot.id} className="mt-5 rounded-xl border border-black/5 p-4">
        <h3 className="font-semibold">{lot.safe_title}</h3>
        {lotOffers.length === 0 ? <p className="mt-2 text-sm text-black/60">Aucune offre soumise pour ce lot.</p> : <div className="mt-3 space-y-3">
          {lotOffers.map((offer, index) => <article key={offer.versionId} className="rounded-xl bg-sand/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">Offre {index + 1}</p>
              <p className="text-sm font-semibold text-teal">{formatTnd(offer.priceMillimes)}</p>
            </div>
            <p className="mt-1 text-sm text-black/60">Délai proposé : {offer.durationDays} jour{offer.durationDays > 1 ? 's' : ''}</p>
            <p className="mt-3 whitespace-pre-wrap text-sm">{offer.inclusions}</p>
            {offer.exclusions && <p className="mt-2 whitespace-pre-wrap text-sm text-black/60">Exclusions : {offer.exclusions}</p>}
          </article>)}
        </div>}
      </section>;
    })}
  </Card>;
}
