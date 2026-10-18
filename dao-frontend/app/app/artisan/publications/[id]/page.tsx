'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { supabaseBrowser } from '../../../../../lib/supabase-browser';
import { CalendarClock, CalendarDays, CheckCircle2, Clock, Hammer, Lock, Package, Ruler, Send, Wallet } from 'lucide-react';
import { Badge, Button, Card, Input } from '../../../../../components/ui';

type Publication = { id: string; project_id: string; visibility: string; status: string; published_at: string; safe_title: string; safe_description: string; project_type: string; surface_m2: number | null; desired_start_date: string | null; indicative_budget_millimes: number | null; submission_deadline: string | null; };
type Lot = { id: string; request_version_id: string; trade_id: string; safe_title: string; safe_scope: string; technical_scope?:any[]; tradeName?: string; acceptsOffers?: boolean; result?: string };
type OfferLine = { price: string; duration: string; inclusions: string; exclusions: string };

const visibilityLabel: Record<string, string> = { public: 'DAO public', targeted: 'DAO ciblé', invite_only: 'DAO sur invitation' };
const projectTypeLabel: Record<string, string> = { construction: 'Construction', renovation: 'Rénovation', repair: 'Réparation', extension: 'Extension', other: 'Autre' };
const DAY = 86400000;
function deadlineHint(deadline: Date | null) {
  if (!deadline) return null;
  const left = deadline.getTime() - Date.now();
  if (left <= 0) return { text: 'Date limite dépassée', urgent: true };
  const days = Math.floor(left / DAY);
  if (days < 1) return { text: 'Dernier jour pour répondre', urgent: true };
  return { text: `Plus que ${days} jour${days > 1 ? 's' : ''} pour répondre`, urgent: days <= 3 };
}
const fieldLabel = 'block text-sm font-semibold text-ink';
const area = 'mt-1.5 w-full rounded-xl border border-black/10 bg-white px-3.5 py-3 text-sm outline-none transition placeholder:text-black/35 focus:border-teal focus:ring-4 focus:ring-teal/10 disabled:bg-sand/50';
function formatTnd(value: number | null) { return value == null ? 'Non renseigné' : new Intl.NumberFormat('fr-TN', { style: 'currency', currency: 'TND', maximumFractionDigits: 3 }).format(Number(value) / 1000); }

export default function ArtisanPublicationDetail() {
  const { id } = useParams<{ id: string }>();
  const [publication, setPublication] = useState<Publication | null>(null);
  const [lots, setLots] = useState<Lot[]>([]);
  const [lines, setLines] = useState<Record<string, OfferLine>>({});
  const [indivisible, setIndivisible] = useState(false);
  const [version, setVersion] = useState<any>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [verificationStatus, setVerificationStatus] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(''); setLines({}); setIndivisible(false);
    const supabase = supabaseBrowser();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) { setError('Session expirée.'); setLoading(false); return; }
    const contractorResult = await supabase.from('contractor_profiles').select('verification_status').eq('user_id', userData.user.id).maybeSingle();
    if (contractorResult.error || !contractorResult.data) { setError('Profil professionnel introuvable.'); setLoading(false); return; }
    setVerificationStatus(contractorResult.data.verification_status);
    const publicationResult = await supabase.from('publications').select('id,project_id,visibility,status,published_at,safe_title,safe_description,project_type,surface_m2,desired_start_date,indicative_budget_millimes,submission_deadline').eq('id', id).single();
    if (publicationResult.error || !publicationResult.data) { setError('DAO indisponible ou non accessible.'); setLoading(false); return; }
    const p = publicationResult.data as Publication;
    const [lotResult, tradeResult, bidResult, availabilityResult] = await Promise.all([
      supabase.from('publication_requests').select('id,request_version_id,trade_id,safe_title,safe_scope,technical_scope').eq('publication_id', id),
      supabase.from('trades').select('id,name_fr').eq('active', true),
      supabase.from('bids').select('id,project_id,publication_id').eq('project_id', p.project_id).or(`publication_id.eq.${id},publication_id.is.null`),
      supabase.rpc('publication_lot_availability', { p_publication_id: id }),
    ]);
    if (lotResult.error || bidResult.error || availabilityResult.error) { setError('Lots indisponibles.'); setLoading(false); return; }
    const availability = new Map((availabilityResult.data ?? []).map((row: any) => [row.publication_request_id, row.accepts_offers]));
    const tradeMap = new Map((tradeResult.data ?? []).map((trade: any) => [trade.id, trade.name_fr]));
    const nextLots = ((lotResult.data ?? []) as Lot[]).map((lot) => ({ ...lot, tradeName: tradeMap.get(lot.trade_id), acceptsOffers: availability.get(lot.id) === true }));
    const bid = bidResult.data?.find(b=>b.publication_id===id)||bidResult.data?.find(b=>b.publication_id==null);
    let nextVersion: any = null;
    const selectedRequestVersions = new Set<string>();
    if (bid) {
      const versions = await supabase.from('bid_versions').select('id,version_no,status,submitted_at,expires_at,publication_id').eq('bid_id', bid.id).order('version_no', { ascending: false }).limit(1);
      const candidate=versions.data?.[0];
      nextVersion=candidate&&(candidate.publication_id===id||(candidate.publication_id==null&&candidate.submitted_at&&candidate.submitted_at>=p.published_at))?candidate:null;
      if (nextVersion) {
        const itemResult = await supabase.from('bid_items').select('id,request_version_id,price_millimes,duration_days,inclusions,exclusions').eq('bid_version_id', nextVersion.id);
        const nextLines: Record<string, OfferLine> = {};
        for (const item of itemResult.data ?? []) {
          selectedRequestVersions.add(item.request_version_id);
          nextLines[item.request_version_id] = { price: String(Number(item.price_millimes) / 1000), duration: String(item.duration_days), inclusions: item.inclusions ?? '', exclusions: item.exclusions ?? '' };
        }
        setLines(nextLines);
        const itemIds = (itemResult.data ?? []).map(item => item.id);
        const results = itemIds.length ? await supabase.from('bid_item_results').select('id,bid_item_id,status').in('bid_item_id', itemIds).order('id', { ascending: false }) : { data: [], error: null };
        const latest = new Map<string, string>();
        for (const row of results.data ?? []) if (!latest.has(row.bid_item_id)) latest.set(row.bid_item_id, row.status);
        for (const lot of nextLots) { const item = itemResult.data?.find(item => item.request_version_id === lot.request_version_id); if (item) lot.result = latest.get(item.id); }
        const groups = await supabase.from('bid_groups').select('indivisible').eq('bid_version_id', nextVersion.id);
        setIndivisible((groups.data ?? []).some(group => group.indivisible));
      }
    }
    setPublication(p); setLots(nextLots); setVersion(nextVersion);
    setSelected(nextVersion
      ? nextLots.filter(lot => selectedRequestVersions.has(lot.request_version_id)).map(lot => lot.id)
      : nextLots.filter(lot => lot.acceptsOffers).map(lot => lot.id));
    setLoading(false);
  }
  useEffect(() => { void load(); }, [id]);

  const deadline = publication?.submission_deadline ? new Date(publication.submission_deadline) : null;
  const closed = publication?.status !== 'published' || Boolean(deadline && deadline.getTime() <= Date.now()) || !lots.some(lot => lot.acceptsOffers);
  const canBid = verificationStatus === 'verified';
  const editable = canBid && !closed && (!version || version.status === 'draft');
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
      const itemIds: string[] = [];
      for (const lot of selectedLots) {
        const line = lines[lot.request_version_id];
        if (!line || !line.price || !line.duration || !line.inclusions.trim()) throw new Error(`Complétez le prix, le délai et la proposition technique pour « ${lot.safe_title} ».`);
        const itemResponse = await fetch('/api/bids/items', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ publication_id: id, version_id: versionId, publication_request_id: lot.id, price_millimes: Math.round(Number(line.price) * 1000), duration_days: Number(line.duration), inclusions: line.inclusions, exclusions: line.exclusions || null }) });
        const itemBody = await itemResponse.json();
        if (!itemResponse.ok) throw new Error(itemBody.error || 'Enregistrement de la ligne refusé.');
        itemIds.push(itemBody.data.id);
      }
      const packageResponse = await fetch('/api/bids/package', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ version_id: versionId, indivisible, item_ids: itemIds }) });
      const packageBody = await packageResponse.json();
      if (!packageResponse.ok) throw new Error(packageBody.error || 'Configuration du package refusée.');
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
      setVersion(body.data); setLines({}); setIndivisible(false); setMessage('Nouvelle version de votre offre prête à compléter.');
    } catch (cause: any) { setError(cause?.message || 'Une erreur est survenue.'); } finally { setSaving(false); }
  }
  async function withdrawOffer(){
    if(!version?.id||!window.confirm('Retirer cette offre soumise ? Son contenu restera dans votre historique et une nouvelle version pourra être préparée tant que le DAO est ouvert.'))return;
    setSaving(true);setError('');setMessage('');
    try{const token=await getToken();const response=await fetch('/api/bids/withdraw',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({version_id:version.id})});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||'Le retrait de cette offre a été refusé.');setMessage('Offre retirée. Son contenu reste conservé dans votre historique.');await load()}catch(cause:any){setError(cause?.message||'Une erreur est survenue.')}finally{setSaving(false)}
  }

  if (loading) return <section aria-busy="true" className="mx-auto max-w-5xl space-y-4"><span className="sr-only">Chargement du DAO…</span><div className="h-36 animate-pulse rounded-2xl bg-black/5" /><div className="h-56 animate-pulse rounded-2xl bg-black/5" /></section>;
  if (!publication) return <section className="mx-auto max-w-5xl"><p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error || 'DAO indisponible.'}</p></section>;
  const hint = closed ? null : deadlineHint(deadline);
  const total = selectedLots.reduce((sum, lot) => sum + (Number(lines[lot.request_version_id]?.price) || 0), 0);
  const longest = selectedLots.reduce((max, lot) => Math.max(max, Number(lines[lot.request_version_id]?.duration) || 0), 0);
  const facts: [typeof Hammer, string, string][] = [
    [Hammer, 'Type de projet', projectTypeLabel[publication.project_type] ?? 'Autre'],
    ...(publication.surface_m2 ? [[Ruler, 'Surface', `${publication.surface_m2} m²`] as [typeof Hammer, string, string]] : []),
    [Wallet, 'Budget indicatif', formatTnd(publication.indicative_budget_millimes)],
    ...(publication.desired_start_date ? [[CalendarDays, 'Démarrage souhaité', new Date(publication.desired_start_date).toLocaleDateString('fr-TN', { day: 'numeric', month: 'long', year: 'numeric' })] as [typeof Hammer, string, string]] : []),
    ...(deadline ? [[CalendarClock, 'Réponse avant le', deadline.toLocaleString('fr-TN', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })] as [typeof Hammer, string, string]] : []),
  ];
  return <section className="mx-auto max-w-5xl space-y-6">
    <header className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><Badge>{visibilityLabel[publication.visibility] ?? 'DAO'}</Badge><Badge tone={closed ? 'red' : 'teal'}>{closed ? 'Fermé' : 'Ouvert'}</Badge>{hint && <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${hint.urgent ? 'text-red-700' : 'text-black/55'}`}><Clock aria-hidden="true" size={13} />{hint.text}</span>}</div>
      <h1 className="break-words text-3xl font-bold tracking-tight text-ink sm:text-4xl">{publication.safe_title}</h1>
      {publication.safe_description && <p className="max-w-3xl whitespace-pre-wrap leading-relaxed text-black/60">{publication.safe_description}</p>}
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">{facts.map(([Icon, label, value]) => <div key={label} className="min-w-0 rounded-2xl border border-black/[0.06] bg-white p-3.5"><dt className="flex items-center gap-1.5 text-xs font-semibold text-black/45"><Icon aria-hidden="true" size={13} />{label}</dt><dd className="mt-1 break-words text-sm font-bold text-ink">{value}</dd></div>)}</dl>
    </header>
    <Card className="p-5 sm:p-7"><h2 className="text-xl font-bold tracking-tight text-ink">Lots publiés</h2><p className="mt-1 text-sm text-black/55">Cochez les lots auxquels vous souhaitez répondre.</p>
      <div className="mt-4 space-y-3">{lots.map((lot) => { const checked = selected.includes(lot.id); return <article key={lot.id} className={`rounded-2xl border p-4 transition sm:p-5 ${checked ? 'border-teal/30 bg-teal/[0.03]' : 'border-black/[0.06] bg-sand/40'}`}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-wide text-teal">{lot.tradeName ?? 'Métier'}</p><h3 className="mt-1 break-words text-lg font-bold text-ink">{lot.safe_title}</h3></div>
          <label className={`inline-flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl border px-3.5 text-sm font-semibold transition has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 ${checked ? 'border-teal/40 bg-white text-teal' : 'border-black/10 bg-white text-ink'}`}><input type="checkbox" className="h-5 w-5 accent-teal" checked={checked} disabled={!editable || !lot.acceptsOffers} onChange={(event) => setSelected((current) => event.target.checked ? [...current, lot.id] : current.filter((item) => item !== lot.id))} /> Répondre à ce lot</label></div>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-black/65">{lot.safe_scope}</p>
        {lot.technical_scope?.map((s:any)=><div key={s.id} className="mt-3 border-l-2 border-teal/25 pl-3"><h4 className="font-semibold text-ink">{s.title}</h4><p className="text-sm text-black/65">{s.scope}</p>{s.budget_millimes!=null&&<p className="text-sm font-medium tabular-nums">{Number(s.budget_millimes)/1000} TND</p>}</div>)}
        {(!lot.acceptsOffers || lot.result) && <div className="mt-3 flex flex-wrap items-center gap-2">{!lot.acceptsOffers && <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-black/60"><Lock aria-hidden="true" size={14} />Lot fermé aux nouvelles offres</p>}{lot.result === 'not_selected' && <Badge>Non retenue</Badge>}{lot.result === 'selected' && <Badge tone="teal">Offre retenue</Badge>}</div>}
      </article>; })}</div></Card>
    {error&&<p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}{message&&<p role="status" className="rounded-xl bg-teal/10 px-4 py-3 text-sm font-medium text-teal">{message}</p>}
    {version?.status === 'submitted' ? <Card className="border-teal/20 p-5 sm:p-7"><div className="flex items-start gap-3"><CheckCircle2 aria-hidden="true" size={24} className="shrink-0 text-teal" /><div><h2 className="text-xl font-bold text-ink">Offre envoyée</h2><p className="mt-1 text-sm text-black/60">Version {version.version_no} soumise le {new Date(version.submitted_at).toLocaleString('fr-TN')}. Le contenu est désormais figé.</p></div></div><div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">{canBid && !closed && <Button className="min-h-11" disabled={saving} onClick={() => void startNewVersion()}>Préparer une nouvelle version</Button>}{lots.some(lot=>lot.result==='selected')?<p className="text-sm font-semibold text-teal">Cette offre attribuée ne peut plus être retirée.</p>:<Button className="min-h-11 bg-white text-red-700 ring-1 ring-inset ring-red-200 hover:bg-red-50" disabled={saving} onClick={()=>void withdrawOffer()}>Retirer l’offre</Button>}</div></Card>
    : version?.status==='withdrawn'?<Card className="p-5 sm:p-7"><h2 className="text-xl font-bold text-ink">Offre retirée</h2><p className="mt-1 text-sm text-black/60">La version {version.version_no} reste conservée dans votre historique.</p>{canBid&&!closed&&<Button className="mt-4 min-h-11" disabled={saving} onClick={()=>void startNewVersion()}>Préparer une nouvelle version</Button>}</Card>
    : !canBid ? <Card className="border-clay/20 bg-clay/[0.04] p-5 sm:p-7"><h2 className="text-xl font-bold text-ink">Offres indisponibles pour ce profil</h2><p className="mt-2 text-sm text-black/60">Votre profil professionnel doit être vérifié par D.A.O avant de créer ou modifier une offre. Vous pouvez continuer à consulter les informations publiques de ce DAO.</p><a href="/app/profile#professional-profile" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-ink px-4 text-sm font-semibold text-white transition hover:bg-teal">Voir mon profil professionnel</a></Card>
    : <Card className="p-5 sm:p-7"><div><h2 className="text-xl font-bold tracking-tight text-ink">Votre proposition</h2><p className="mt-1 text-sm text-black/55">Montants en TND. Tant que l’offre n’est pas soumise, vous pouvez enregistrer un brouillon et y revenir.</p></div>
      {selectedLots.length === 0 && <p className="mt-5 rounded-2xl border border-dashed border-black/10 px-4 py-6 text-center text-sm text-black/55">Cochez au moins un lot ci-dessus pour préparer votre offre.</p>}
      <div className="mt-5 space-y-4">{selectedLots.map((lot) => { const line = lines[lot.request_version_id] ?? { price: '', duration: '', inclusions: '', exclusions: '' }; return <div key={lot.id} className="rounded-xl border border-black/[0.08] p-4 sm:p-5"><h3 className="text-lg font-bold text-ink">{lot.safe_title}</h3><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className={fieldLabel}>Prix proposé (TND)<Input className="mt-1.5 min-h-11 tabular-nums" type="number" inputMode="decimal" min="0" step="0.001" disabled={!editable} value={line.price} onChange={(event) => updateLine(lot.request_version_id, 'price', event.target.value)} placeholder="Ex. 18500" /></label><label className={fieldLabel}>Délai (jours)<Input className="mt-1.5 min-h-11 tabular-nums" type="number" inputMode="numeric" min="1" step="1" disabled={!editable} value={line.duration} onChange={(event) => updateLine(lot.request_version_id, 'duration', event.target.value)} placeholder="Ex. 21" /></label></div><label className={`mt-3 ${fieldLabel}`}>Proposition technique / inclusions<textarea disabled={!editable} value={line.inclusions} onChange={(event) => updateLine(lot.request_version_id, 'inclusions', event.target.value)} className={`${area} min-h-28`} placeholder="Fournitures, main-d’œuvre, essais, nettoyage…" /></label><label className={`mt-3 ${fieldLabel}`}>Exclusions / variantes<textarea disabled={!editable} value={line.exclusions} onChange={(event) => updateLine(lot.request_version_id, 'exclusions', event.target.value)} className={`${area} min-h-20`} placeholder="Optionnel" /></label></div>; })}</div>
      {selectedLots.length >= 2 && <label className="mt-4 flex min-h-11 items-start gap-3 rounded-xl bg-clay/[0.06] px-3.5 py-3 text-sm text-ink"><input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-teal" checked={indivisible} disabled={!editable} onChange={event => setIndivisible(event.target.checked)} /><span className="inline-flex items-start gap-1.5"><Package aria-hidden="true" size={15} className="mt-0.5 shrink-0 text-clay" />Package indivisible : tous les lots de cette offre ensemble</span></label>}
      {selectedLots.length > 0 && <div className="mt-6 flex flex-col gap-4 border-t border-black/5 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-xs font-semibold uppercase tracking-wide text-black/45">Total de votre offre</p><p className="text-2xl font-bold tabular-nums text-ink">{formatTnd(Math.round(total * 1000))}</p>{longest > 0 && <p className="text-xs text-black/50">Délai le plus long : {longest} jour{longest > 1 ? 's' : ''}</p>}</div>
        <div className="flex flex-col gap-2 sm:flex-row"><Button disabled={saving || !editable} className="min-h-11 bg-white text-ink ring-1 ring-inset ring-black/10 hover:bg-sand" onClick={() => void save(false)}>{saving ? 'Enregistrement…' : 'Enregistrer le brouillon'}</Button><Button disabled={saving || !editable} className="min-h-11 gap-2 bg-clay hover:bg-teal" onClick={() => void save(true)}><Send aria-hidden="true" size={16} />Soumettre l’offre</Button></div>
      </div>}
    </Card>}
  </section>;
}
