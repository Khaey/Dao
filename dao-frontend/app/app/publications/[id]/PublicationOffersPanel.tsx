'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card } from '../../../../components/ui';
import { commandBackoffice } from '../../../../lib/backoffice';
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
  groupId: string | null;
  result: string;
};
type Award = { id: string; request_id: string; bid_item_id: string; agreed_millimes: number; active: boolean };

const cancellationReasons: Record<string, string> = { disagreement: 'Désaccord entre les parties', withdrawal: 'Désistement', financing: 'Problème de financement / paiement', unavailable: 'Indisponibilité', award_error: 'Erreur d’attribution', mutual_agreement: 'Accord amiable', deadline: 'Non-respect d’un délai', other: 'Autre' };

function formatTnd(value: number) {
  return new Intl.NumberFormat('fr-TN', {
    style: 'currency',
    currency: 'TND',
    maximumFractionDigits: 3,
  }).format(value / 1000);
}

export default function PublicationOffersPanel({ projectId, publicationId, lots, canManage=true, assisted=false }: { projectId: string; publicationId: string; lots: Lot[]; canManage?:boolean; assisted?:boolean }) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [awards, setAwards] = useState<Award[]>([]);
  const [availability, setAvailability] = useState<Record<string, string>>({});
  const [cancellations, setCancellations] = useState<any[]>([]);
  const [cancelling, setCancelling] = useState<Award | null>(null);
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [assistanceReason,setAssistanceReason]=useState('');
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
      .select('id,request_id,bid_item_id,agreed_millimes,active,bid_items!award_items_bid_item_id_fkey(bid_version_id)')
      .eq('project_id', projectId);
    if (awardResult.error) throw new Error('Les attributions ne sont pas disponibles.');
    setAwards((awardResult.data ?? []).filter((row) => row.active) as Award[]);
    const availabilityResult = await supabase.rpc('publication_lot_availability', { p_publication_id: publicationId });
    if (availabilityResult.error) throw new Error('Disponibilité des lots indisponible.');
    setAvailability(Object.fromEntries((availabilityResult.data ?? []).map((row: any) => [row.publication_request_id, row.request_id])));
    const awardIds = (awardResult.data ?? []).map(row => row.id);
    const cancellationResult = awardIds.length ? await supabase.from('award_cancellations').select('id,award_item_id,created_at,actor_id,reason,comment').in('award_item_id', awardIds).order('created_at', { ascending: false }) : { data: [], error: null };
    if (cancellationResult.error) throw new Error('Historique des attributions indisponible.');
    setCancellations(cancellationResult.data ?? []);
    if (!bidIds.length) {
      setOffers([]);
      setLoading(false);
      return;
    }

    const versionsResult = await supabase
      .from('bid_versions')
      .select('id,bid_id,version_no,submitted_at,status,validity,publication_id')
      .or(`publication_id.eq.${publicationId},publication_id.is.null`)
      .in('bid_id', bidIds)
      .not('submitted_at', 'is', null);
    if (versionsResult.error) throw new Error('Les offres ne sont pas disponibles.');
    const awardedVersions = new Set((awardResult.data ?? []).filter(row => row.active).map((row: any) => row.bid_items?.bid_version_id));
    const versions = (versionsResult.data ?? []).filter(row => (row.status === 'submitted' && row.validity === 'current') || awardedVersions.has(row.id));
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
const indivisibleItems = new Map((groupItemsResult.data ?? []).filter(item => (groupSizes.get(item.group_id) ?? 0) > 1).map(item => [item.bid_item_id, item.group_id]));
    const itemIds = (itemsResult.data ?? []).map(item => item.id);
    const results = itemIds.length ? await supabase.from('bid_item_results').select('id,bid_item_id,status').in('bid_item_id', itemIds).order('id', { ascending: false }) : { data: [], error: null };
    if (results.error) throw new Error('Résultats des offres indisponibles.');
    const latestResult = new Map<string, string>();
    for (const row of results.data ?? []) if (!latestResult.has(row.bid_item_id)) latestResult.set(row.bid_item_id, row.status);
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
        groupId: indivisibleItems.get(item.id) ?? null,
        result: latestResult.get(item.id) ?? 'available',
      };
    }));
    setLoading(false);
  }, [projectId, publicationId]);

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
      const selection=offer.groupId?{group_id:offer.groupId}:{bid_item_id:offer.itemId};
      if(assisted)await commandBackoffice('assisted_award',{...selection,reason:assistanceReason});
      else await projectApi('/api/awards',{...selection,idempotency_key:crypto.randomUUID()});
      setConfirming(null);
      setMessage(offer.groupId ? 'Le package a été attribué pour tous ses lots. Aucun contrat n’a été créé automatiquement.' : 'L’offre a été attribuée pour ce lot. Aucun contrat n’a été créé automatiquement.');
      await load();
    } catch (cause: any) {
      setError(cause?.message || 'Attribution refusée.');
    } finally {
      setSaving(false);
    }
  }

  async function cancelAward() {
    if (!cancelling) return;
    setSaving(true); setError(''); setMessage('');
    try {
      if(assisted)await commandBackoffice('assisted_cancel',{award_item_id:cancelling.id,cancellation_reason:reason,comment,reason:assistanceReason});
      else await projectApi('/api/awards/cancel', { award_item_id: cancelling.id, reason, comment, idempotency_key: crypto.randomUUID() });
      setCancelling(null); setReason(''); setComment('');
      setMessage('Attribution annulée. Les lots concernés sont de nouveau ouverts ; l’historique est conservé.');
      await load();
    } catch (cause: any) { setError(cause?.message || 'Annulation refusée.'); }
    finally { setSaving(false); }
  }

  return <Card>
    <h2 className="font-semibold">Comparer et attribuer les offres</h2>
    {assisted&&<p className="mt-2 text-sm text-teal">Actions pour le compte du client · Votre identité staff est conservée dans l’historique.</p>}
    {!canManage&&<p className="mt-2 text-sm">Lecture seule : seul le gestionnaire affecté ou l’Admin peut attribuer ou annuler.</p>}
    <p className="mt-1 text-sm text-black/55">Seule la version soumise actuelle de chaque offre est comparée. L’attribution porte sur un lot et ne crée ni contrat ni démarrage de travaux.</p>
    {assisted&&canManage&&<label className="mt-4 block text-sm">Contexte de la demande du client<textarea className="mt-2 w-full rounded-xl border p-3" value={assistanceReason} onChange={e=>setAssistanceReason(e.target.value)} placeholder="Demande du client, échange ou référence utile" /></label>}
    {loading && <p className="mt-4 text-sm text-black/60">Chargement des offres…</p>}
    {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
    {message && <p role="status" className="mt-4 text-sm text-teal">{message}</p>}
    {!loading && lots.map((lot) => {
      const lotOffers = grouped.get(lot.request_version_id) ?? [];
      const awarded = activeAward.get(availability[lot.id]);
      return <section key={lot.id} className="mt-5 rounded-xl border border-black/5 p-4" aria-labelledby={`lot-${lot.id}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={`lot-${lot.id}`} className="font-semibold">{lot.safe_title}</h3>
          {awarded && <Badge tone="teal">Lot attribué</Badge>}
          {awarded && <Button disabled={!canManage || saving || (assisted&&!assistanceReason.trim())} className="bg-white text-ink ring-1 ring-black/10" onClick={() => { setCancelling(awarded); setReason(''); setComment(''); }}>Annuler l’attribution</Button>}
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
              {offer.groupId && <p className="mt-2 text-xs font-semibold text-clay">Package indivisible : {offers.filter(member => member.groupId === offer.groupId).map(member => lots.find(lot => lot.request_version_id === member.requestVersionId)?.safe_title ?? 'Lot').join(', ')}</p>}
              <p className="mt-3 whitespace-pre-wrap text-sm">{offer.inclusions}</p>
              {offer.exclusions && <p className="mt-2 whitespace-pre-wrap text-sm text-black/60">Exclusions : {offer.exclusions}</p>}
              {isWinner ? <p className="mt-4 text-sm font-semibold text-teal">Offre retenue · {formatTnd(Number(awarded.agreed_millimes))}</p> : offer.result === 'not_selected' ? <p className="mt-4 text-sm font-semibold text-black/55">Non retenue</p> : !awarded && confirming === offer.itemId ? <div className="mt-4 rounded-xl border border-clay/20 bg-white p-3">
                <p className="text-sm font-medium">{offer.groupId ? 'Confirmer l’attribution de tous les lots de ce package indivisible ?' : 'Confirmer l’attribution de ce lot à cette offre ?'}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button disabled={!canManage || saving || (assisted&&!assistanceReason.trim())} onClick={() => void award(offer)}>{saving ? 'Attribution…' : 'Confirmer l’attribution'}</Button>
                  <Button disabled={!canManage || saving || (assisted&&!assistanceReason.trim())} className="bg-white text-ink ring-1 ring-black/10 hover:bg-sand" onClick={() => setConfirming(null)}>Annuler</Button>
                </div>
              </div> : !awarded && <Button disabled={!canManage || saving || (offer.groupId != null && offers.some(member => member.groupId === offer.groupId && (member.result === 'not_selected' || activeAward.has(member.requestId))))} className="mt-4" onClick={() => setConfirming(offer.itemId)}>{offer.groupId ? 'Attribuer tout le package' : 'Attribuer cette offre'}</Button>}
            </article>;
          })}
        </div>}
      </section>;
    })}
    {cancelling && <div role="group" aria-label="Annulation de l’attribution" className="mt-5 rounded-xl border border-clay/30 p-4">
      <h3 className="font-semibold">Annuler l’attribution</h3>
      <p className="mt-2 text-sm">Pour un package indivisible, tous ses lots seront rouverts ensemble.</p>
      <label className="mt-3 block text-sm">Motif d’annulation<select className="mt-1 w-full rounded-xl border p-3" value={reason} onChange={event => setReason(event.target.value)}><option value="">Choisir un motif</option>{Object.entries(cancellationReasons).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="mt-3 block text-sm">Commentaire<textarea className="mt-1 w-full rounded-xl border p-3" value={comment} onChange={event => setComment(event.target.value)} required={reason === 'other'} /></label>
      <div className="mt-3 flex flex-wrap gap-2"><Button disabled={!canManage || saving || (assisted&&!assistanceReason.trim()) || !reason || (reason === 'other' && !comment.trim())} onClick={() => void cancelAward()}>Confirmer l’annulation</Button><Button disabled={!canManage || saving || (assisted&&!assistanceReason.trim())} className="bg-white text-ink ring-1 ring-black/10" onClick={() => setCancelling(null)}>Fermer</Button></div>
    </div>}
    {cancellations.length > 0 && <section className="mt-5 border-t pt-4"><h3 className="font-semibold">Historique des annulations</h3>{cancellations.map(event => <p key={event.id} className="mt-2 break-words text-sm">{cancellationReasons[event.reason]} · {new Date(event.created_at).toLocaleString('fr-TN')} · Auteur : {event.actor_id}{event.comment && ` · ${event.comment}`}</p>)}</section>}
  </Card>;
}
