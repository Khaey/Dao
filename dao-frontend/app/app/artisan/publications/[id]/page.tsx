'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { supabaseBrowser } from '../../../../../lib/supabase-browser';
import { Badge, Button, Card, Input } from '../../../../../components/ui';

type Publication = { id: string; project_id: string; visibility: string; status: string; safe_title: string; safe_description: string; project_type: string; surface_m2: number | null; desired_start_date: string | null; indicative_budget_millimes: number | null; submission_deadline: string | null; };
type Lot = { id: string; request_version_id: string; trade_id: string; safe_title: string; safe_scope: string; tradeName?: string };
type OfferLine = { price: string; duration: string; inclusions: string; exclusions: string };

const visibilityLabel: Record<string, string> = { public: 'DAO public', targeted: 'DAO ciblé', invite_only: 'Invitation directe' };
const projectTypeLabel: Record<string, string> = { construction: 'Construction', renovation: 'Rénovation', repair: 'Réparation', extension: 'Extension', other: 'Autre' };
function formatTnd(value: number | null) { return value == null ? 'Non renseigné' : new Intl.NumberFormat('fr-TN', { style: 'currency', currency: 'TND', maximumFractionDigits: 3 }).format(Number(value) / 1000); }

export default function ArtisanPublicationDetail() {
  const { id } = useParams<{ id: string }>();
  const [publication, setPublication] = useState<Publication | null>(null);
  const [lots, setLots] = useState<Lot[]>([]);
  const [lines, setLines] = useState<Record<string, OfferLine>>({});
  const [version, setVersion] = useState<any>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setLoading(true); setError('');
    const supabase = supabaseBrowser();
    const publicationResult = await supabase.from('publications').select('id,project_id,visibility,status,safe_title,safe_description,project_type,surface_m2,desired_start_date,indicative_budget_millimes,submission_deadline').eq('id', id).single();
    if (publicationResult.error || !publicationResult.data) { setError('DAO indisponible ou non accessible.'); setLoading(false); return; }
    const p = publicationResult.data as Publication;
    const [lotResult, tradeResult, bidResult] = await Promise.all([
      supabase.from('publication_requests').select('id,request_version_id,trade_id,safe_title,safe_scope').eq('publication_id', id),
      supabase.from('trades').select('id,name_fr').eq('active', true),
      supabase.from('bids').select('id,project_id').eq('project_id', p.project_id),
    ]);
    const tradeMap = new Map((tradeResult.data ?? []).map((trade: any) => [trade.id, trade.name_fr]));
    const nextLots = ((lotResult.data ?? []) as Lot[]).map((lot) => ({ ...lot, tradeName: tradeMap.get(lot.trade_id) }));
    const bid = bidResult.data?.[0];
    let nextVersion: any = null;
    if (bid) {
      const versions = await supabase.from('bid_versions').select('id,version_no,status,submitted_at,expires_at').eq('bid_id', bid.id).order('version_no', { ascending: false }).limit(1);
      nextVersion = versions.data?.[0] ?? null;
      if (nextVersion) {
        const itemResult = await supabase.from('bid_items').select('request_version_id,price_millimes,duration_days,inclusions,exclusions').eq('bid_version_id', nextVersion.id);
        const nextLines: Record<string, OfferLine> = {};
        for (const item of itemResult.data ?? []) nextLines[item.request_version_id] = { price: String(Number(item.price_millimes) / 1000), duration: String(item.duration_days), inclusions: item.inclusions ?? '', exclusions: item.exclusions ?? '' };
        setLines(nextLines);
      }
    }
    setPublication(p); setLots(nextLots); setVersion(nextVersion); setSelected(nextLots.map((lot) => lot.id)); setLoading(false);
  }
  useEffect(() => { void load(); }, [id]);

  const deadline = publication?.submission_deadline ? new Date(publication.submission_deadline) : null;
  const closed = publication?.status !== 'published' || Boolean(deadline && deadline.getTime() <= Date.now());
  const editable = !closed && (!version || version.status === 'draft');
  const selectedLots = useMemo(() => lots.filter((lot) => selected.includes(lot.id)), [lots, selected]);

  function updateLine(idKey: string, key: keyof OfferLine, value: string) { setLines((current) => ({ ...current, [idKey]: { price: current[idKey]?.price ?? '', duration: current[idKey]?.duration ?? '', inclusions: current[idKey]?.inclusions ?? '', exclusions: current[idKey]?.exclusions ?? '', [key]: value } })); }
  async function getToken() { const { data } = await supabaseBrowser().auth.getSession(); if (!data.session) throw new Error('Session expirée.'); return data.session.access_token; }
  async function save(submit: boolean) {
    setSaving(true); setError(''); setMessage('');
    try {
      if (!selectedLots.length) throw new Error('Sélectionnez au moins un lot.');
      if (closed) throw new Error('La date limite de ce DAO est dépassée.');
      const token = await getToken();
      let versionId = version?.id;
      if (!versionId) {
        const draftResponse = await fetch('/api/bids', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ publication_id: id }) });
        const draftBody = await draftResponse.json();
        if (!draftResponse.ok || !draftBody.data?.id) throw new Error(draftBody.error || 'Création du brouillon refusée.');
        versionId = draftBody.data.id; setVersion(draftBody.data);
      }
      for (const lot of selectedLots) {
        const line = lines[lot.request_version_id];
        if (!line || !line.price || !line.duration || !line.inclusions.trim()) throw new Error(`Complétez le prix, le délai et la proposition technique pour « ${lot.safe_title} ».`);
        const itemResponse = await fetch('/api/bids/items', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ publication_id: id, version_id: versionId, publication_request_id: lot.id, price_millimes: Math.round(Number(line.price) * 1000), duration_days: Number(line.duration), inclusions: line.inclusions, exclusions: line.exclusions || null }) });
        const itemBody = await itemResponse.json();
        if (!itemResponse.ok) throw new Error(itemBody.error || 'Enregistrement de la ligne refusé.');
      }
      if (submit) {
        const submitResponse = await fetch('/api/bids/submit', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ version_id: versionId }) });
        const submitBody = await submitResponse.json();
        if (!submitResponse.ok) throw new Error(submitBody.error || 'Soumission de l’offre refusée.');
        setVersion(submitBody.data); setMessage('Votre offre a été soumise. Elle est maintenant figée et visible par le client selon ses droits.');
      } else setMessage('Brouillon enregistré. Vous pouvez encore le modifier avant la soumission.');
      await load();
    } catch (cause: any) { setError(cause?.message || 'Une erreur est survenue.'); } finally { setSaving(false); }
  }
  async function startNewVersion() {
    setSaving(true); setError(''); setMessage('');
    try {
      if (closed) throw new Error('La date limite de ce DAO est dépassée.');
      const token = await getToken();
      const response = await fetch('/api/bids', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ publication_id: id }) });
      const body = await response.json();
      if (!response.ok || !body.data?.id) throw new Error(body.error || 'Nouvelle version refusée.');
      setVersion(body.data); setLines({}); setMessage('Nouvelle version de votre offre prête à compléter.');
    } catch (cause: any) { setError(cause?.message || 'Une erreur est survenue.'); } finally { setSaving(false); }
  }

  if (loading) return <p>Chargement du DAO…</p>;
  if (!publication) return <p role="alert">{error || 'DAO indisponible.'}</p>;
  return <section className="mx-auto max-w-5xl space-y-6">
    <div><div className="flex flex-wrap items-center gap-2"><Badge>{visibilityLabel[publication.visibility] ?? 'DAO'}</Badge><Badge>{closed ? 'Fermé' : 'Ouvert'}</Badge></div><h1 className="mt-3 text-3xl font-bold">{publication.safe_title}</h1><p className="mt-2 max-w-3xl text-black/60">{publication.safe_description}</p><div className="mt-4 flex flex-wrap gap-3 text-sm text-black/55"><span>{projectTypeLabel[publication.project_type]}</span>{publication.surface_m2 && <span>· {publication.surface_m2} m²</span>}<span>· Budget : {formatTnd(publication.indicative_budget_millimes)}</span>{deadline && <span>· Réponse avant le {deadline.toLocaleString('fr-TN')}</span>}</div></div>
    <Card><h2 className="font-semibold">Lots publiés</h2><div className="mt-4 space-y-3">{lots.map((lot) => <article key={lot.id} className="rounded-xl bg-sand/70 p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-semibold uppercase tracking-wide text-teal">{lot.tradeName ?? 'Métier'}</p><h3 className="mt-1 font-semibold">{lot.safe_title}</h3></div><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={selected.includes(lot.id)} disabled={!editable} onChange={(event) => setSelected((current) => event.target.checked ? [...current, lot.id] : current.filter((item) => item !== lot.id))} /> Répondre à ce lot</label></div><p className="mt-2 whitespace-pre-wrap text-sm text-black/60">{lot.safe_scope}</p></article>)}</div></Card>
    {version?.status === 'submitted' ? <Card><h2 className="font-semibold">Offre envoyée</h2><p className="mt-2 text-sm text-black/60">Version {version.version_no} soumise le {new Date(version.submitted_at).toLocaleString('fr-TN')}. Le contenu est désormais figé.</p>{!closed && <Button className="mt-4" disabled={saving} onClick={() => void startNewVersion()}>Préparer une nouvelle version</Button>}</Card> : <Card><div><h2 className="font-semibold">Votre proposition</h2><p className="mt-1 text-sm text-black/55">Les montants sont saisis en TND puis enregistrés en millimes côté serveur.</p></div><div className="mt-5 space-y-5">{selectedLots.map((lot) => { const line = lines[lot.request_version_id] ?? { price: '', duration: '', inclusions: '', exclusions: '' }; return <div key={lot.id} className="rounded-xl border border-black/5 p-4"><h3 className="font-semibold">{lot.safe_title}</h3><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="block text-xs font-medium">Prix proposé (TND)<Input type="number" min="0" step="0.001" disabled={!editable} value={line.price} onChange={(event) => updateLine(lot.request_version_id, 'price', event.target.value)} placeholder="Ex. 18500" /></label><label className="block text-xs font-medium">Délai (jours)<Input type="number" min="1" step="1" disabled={!editable} value={line.duration} onChange={(event) => updateLine(lot.request_version_id, 'duration', event.target.value)} placeholder="Ex. 21" /></label></div><label className="mt-3 block text-xs font-medium">Proposition technique / inclusions<textarea disabled={!editable} value={line.inclusions} onChange={(event) => updateLine(lot.request_version_id, 'inclusions', event.target.value)} className="mt-1.5 min-h-24 w-full rounded-xl border border-black/10 px-3 py-2.5 text-sm" placeholder="Décrivez ce qui est compris…" /></label><label className="mt-3 block text-xs font-medium">Exclusions / variantes<textarea disabled={!editable} value={line.exclusions} onChange={(event) => updateLine(lot.request_version_id, 'exclusions', event.target.value)} className="mt-1.5 min-h-20 w-full rounded-xl border border-black/10 px-3 py-2.5 text-sm" placeholder="Optionnel" /></label></div>; })}</div>{error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}{message && <p role="status" className="mt-4 text-sm text-teal">{message}</p>}<div className="mt-5 flex flex-wrap gap-3"><Button disabled={saving || !editable} onClick={() => void save(false)}>{saving ? 'Enregistrement…' : 'Enregistrer le brouillon'}</Button><Button disabled={saving || !editable} className="bg-clay" onClick={() => void save(true)}>Soumettre l’offre</Button></div></Card>}
  </section>;
}
