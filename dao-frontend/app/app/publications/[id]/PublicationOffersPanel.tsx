'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Info, Package, Trophy } from 'lucide-react';
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

const field = 'mt-1.5 w-full rounded-xl border border-black/10 bg-white px-3.5 py-3 text-sm text-ink outline-none transition focus:border-teal focus:ring-4 focus:ring-teal/10';
const ghost = 'bg-white text-ink ring-1 ring-inset ring-black/10 hover:bg-sand';
const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? 's' : ''}`;

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

  return <Card className="space-y-5 p-5 sm:p-7">
    <h2 className="text-2xl font-bold tracking-tight text-ink">Comparer et attribuer les offres</h2>
    <div className="flex items-start gap-2.5 rounded-2xl bg-sand/70 px-4 py-3 text-sm text-black/65"><Info aria-hidden="true" size={17} className="mt-0.5 shrink-0 text-teal" /><p>Seule la version soumise actuelle de chaque offre est comparée. L’attribution porte sur un lot et ne crée ni contrat ni démarrage de travaux.</p></div>
    {assisted&&<p className="text-sm font-medium text-teal">Actions pour le compte du client · Votre identité staff est conservée dans l’historique.</p>}
    {!canManage&&<p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">Lecture seule : seul le gestionnaire affecté ou l’Admin peut attribuer ou annuler.</p>}
    {assisted&&canManage&&<label className="block text-sm font-semibold text-ink">Contexte de la demande du client<textarea className={field} value={assistanceReason} onChange={e=>setAssistanceReason(e.target.value)} placeholder="Demande du client, échange ou référence utile" /></label>}
    {loading && <div aria-busy="true" className="space-y-3"><span className="sr-only">Chargement des offres…</span>{[0, 1].map(item => <div key={item} className="h-40 animate-pulse rounded-2xl bg-black/5" />)}</div>}
    {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="flex items-start gap-2 rounded-xl bg-teal/10 px-4 py-3 text-sm font-medium text-teal"><CheckCircle2 aria-hidden="true" size={17} className="mt-0.5 shrink-0" />{message}</p>}
    {!loading && lots.map((lot) => {
      const lotOffers = grouped.get(lot.request_version_id) ?? [];
      const awarded = activeAward.get(availability[lot.id]);
      const lowest = lotOffers.length ? Math.min(...lotOffers.map(offer => offer.priceMillimes)) : 0;
      const fastest = lotOffers.length ? Math.min(...lotOffers.map(offer => offer.durationDays)) : 0;
      const compare = lotOffers.length > 1;
      return <section key={lot.id} className={`rounded-2xl border p-4 sm:p-5 ${awarded ? 'border-teal/25 bg-teal/[0.03]' : 'border-black/[0.08]'}`} aria-labelledby={`lot-${lot.id}`}>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <h3 id={`lot-${lot.id}`} className="min-w-0 flex-1 break-words text-lg font-bold tracking-tight text-ink">{lot.safe_title}</h3>
          <div className="flex flex-wrap items-center gap-2">
            {awarded && <Badge tone="teal">Lot attribué</Badge>}
            {awarded && <Button disabled={!canManage || saving || (assisted&&!assistanceReason.trim())} className={`min-h-11 ${ghost}`} onClick={() => { setCancelling(awarded); setReason(''); setComment(''); }}>Annuler l’attribution</Button>}
          </div>
          <p className="w-full text-sm text-black/55">{lotOffers.length ? `${plural(lotOffers.length, 'offre')} · à partir de ${formatTnd(lowest)}` : 'En attente d’offres'}</p>
        </div>
        {lotOffers.length === 0 ? <p className="mt-4 rounded-xl border border-dashed border-black/10 px-4 py-6 text-center text-sm text-black/55">Aucune offre soumise pour ce lot.</p> : <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {lotOffers.map((offer, index) => {
            const isWinner = awarded?.bid_item_id === offer.itemId;
            const declined = !isWinner && offer.result === 'not_selected';
            const gap = lowest ? Math.round(((offer.priceMillimes - lowest) / lowest) * 100) : 0;
            const tags = compare && !awarded ? [offer.priceMillimes === lowest && 'Prix le plus bas', offer.durationDays === fastest && 'Délai le plus court'].filter(Boolean) as string[] : [];
            const packageLots = offer.groupId ? offers.filter(member => member.groupId === offer.groupId).map(member => lots.find(item => item.request_version_id === member.requestVersionId)?.safe_title ?? 'Lot').join(', ') : '';
            return <article key={offer.itemId} data-testid="offer-card" className={`flex flex-col rounded-2xl border p-4 transition sm:p-5 ${isWinner ? 'border-teal/40 bg-white shadow-[0_8px_24px_rgba(15,118,110,0.10)] ring-1 ring-teal/20' : declined ? 'border-black/5 bg-sand/40 opacity-75' : 'border-black/[0.08] bg-white'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-black/45">Offre {index + 1}</p>
                  <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums text-ink">{formatTnd(offer.priceMillimes)}</p>
                  {compare && gap > 0 && !awarded && <p className="text-xs font-medium text-black/50">+{gap} % par rapport à la moins chère</p>}
                </div>
                {isWinner && <Trophy aria-hidden="true" size={22} className="shrink-0 text-teal" />}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-sand px-2.5 py-1 text-xs font-semibold text-ink"><Clock aria-hidden="true" size={13} />Délai proposé : {offer.durationDays} jour{offer.durationDays > 1 ? 's' : ''}</span>
                {tags.map(tag => <span key={tag} className="rounded-full bg-teal/10 px-2.5 py-1 text-xs font-semibold text-teal">{tag}</span>)}
              </div>
              {offer.groupId && <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-clay/[0.07] px-3 py-2 text-xs font-semibold text-clay"><Package aria-hidden="true" size={14} className="mt-px shrink-0" />Package indivisible : {packageLots}</p>}
              <div className="mt-4 space-y-3 border-t border-black/5 pt-4">
                <div><p className="text-xs font-bold uppercase tracking-wide text-black/40">Inclus</p><p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink">{offer.inclusions}</p></div>
                {offer.exclusions && <div><p className="text-xs font-bold uppercase tracking-wide text-black/40">Non inclus</p><p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-black/60">Exclusions : {offer.exclusions}</p></div>}
              </div>
              <p className="mt-3 text-xs text-black/40">Version {offer.versionNo} · soumise le {new Date(offer.submittedAt).toLocaleDateString('fr-TN')}</p>
              <div className="mt-auto pt-4">
              {isWinner ? <p className="flex items-center gap-1.5 rounded-xl bg-teal/10 px-3 py-2.5 text-sm font-semibold text-teal"><CheckCircle2 aria-hidden="true" size={16} />Offre retenue · {formatTnd(Number(awarded.agreed_millimes))}</p> : declined ? <p className="text-sm font-semibold text-black/55">Non retenue</p> : !awarded && confirming === offer.itemId ? <div className="rounded-xl border border-clay/25 bg-clay/[0.05] p-3.5">
                <p className="flex items-start gap-2 text-sm font-medium text-ink"><AlertTriangle aria-hidden="true" size={16} className="mt-0.5 shrink-0 text-clay" />{offer.groupId ? 'Confirmer l’attribution de tous les lots de ce package indivisible ?' : 'Confirmer l’attribution de ce lot à cette offre ?'}</p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <Button className="min-h-11" disabled={!canManage || saving || (assisted&&!assistanceReason.trim())} onClick={() => void award(offer)}>{saving ? 'Attribution…' : 'Confirmer l’attribution'}</Button>
                  <Button disabled={!canManage || saving || (assisted&&!assistanceReason.trim())} className={`min-h-11 ${ghost}`} onClick={() => setConfirming(null)}>Annuler</Button>
                </div>
              </div> : !awarded && <Button disabled={!canManage || saving || (offer.groupId != null && offers.some(member => member.groupId === offer.groupId && (member.result === 'not_selected' || activeAward.has(member.requestId))))} className="min-h-11 w-full" onClick={() => setConfirming(offer.itemId)}>{offer.groupId ? 'Attribuer tout le package' : 'Attribuer cette offre'}</Button>}
              </div>
            </article>;
          })}
        </div>}
      </section>;
    })}
    {cancelling && <div role="group" aria-label="Annulation de l’attribution" className="space-y-4 rounded-2xl border border-clay/30 bg-clay/[0.04] p-4 sm:p-5">
      <div><h3 className="text-lg font-bold text-ink">Annuler l’attribution</h3>
      <p className="mt-1 text-sm text-black/60">Le lot redevient ouvert aux offres. Pour un package indivisible, tous ses lots seront rouverts ensemble.</p></div>
      <label className="block text-sm font-semibold text-ink">Motif d’annulation<select className={field} value={reason} onChange={event => setReason(event.target.value)}><option value="">Choisir un motif</option>{Object.entries(cancellationReasons).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="block text-sm font-semibold text-ink">Commentaire<textarea rows={3} className={field} value={comment} onChange={event => setComment(event.target.value)} required={reason === 'other'} /></label>
      <div className="flex flex-col gap-2 sm:flex-row"><Button className="min-h-11" disabled={!canManage || saving || (assisted&&!assistanceReason.trim()) || !reason || (reason === 'other' && !comment.trim())} onClick={() => void cancelAward()}>Confirmer l’annulation</Button><Button disabled={!canManage || saving || (assisted&&!assistanceReason.trim())} className={`min-h-11 ${ghost}`} onClick={() => setCancelling(null)}>Fermer</Button></div>
    </div>}
    {cancellations.length > 0 && <section className="border-t border-black/5 pt-5"><h3 className="font-bold text-ink">Historique des annulations</h3><ul className="mt-3 space-y-2">{cancellations.map(event => <li key={event.id} className="break-words rounded-xl bg-sand/60 px-3.5 py-2.5 text-sm text-black/70"><span className="font-semibold text-ink">{cancellationReasons[event.reason] ?? event.reason}</span> · {new Date(event.created_at).toLocaleString('fr-TN')}{assisted && ` · Auteur : ${event.actor_id}`}{event.comment && ` · ${event.comment}`}</li>)}</ul></section>}
  </Card>;
}
