'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { supabaseBrowser } from '../../../../../lib/supabase-browser';
import { CalendarClock, CalendarDays, CheckCircle2, Clock, Download, FileText, Hammer, HelpCircle, Lock, Package, Paperclip, Plus, Ruler, Send, Trash2, Wallet } from 'lucide-react';
import { Badge, Button, Card, Input } from '../../../../../components/ui';
import { SubLotLinksEditor, SubLotsEditor } from '../../../../../components/artisan/BidSubLots';
import { linksPayload, linksProblem, subLotsPayload, subLotsProblem, type LinkDraft, type Referent, type SubLotDraft } from '../../../../../lib/bid-sub-lots';

type Publication = { id: string; project_id: string; visibility: string; status: string; published_at: string; safe_title: string; safe_description: string; project_type: string; surface_m2: number | null; desired_start_date: string | null; indicative_budget_millimes: number | null; submission_deadline: string | null; };
type Lot = { id: string; request_version_id: string; trade_id: string; safe_title: string; safe_scope: string; technical_scope?:any[]; tradeName?: string; acceptsOffers?: boolean; result?: string };
type OfferLine = { price: string; duration: string; inclusions: string; exclusions: string };
type QuoteDocument = { id: string; original_name: string; size_bytes: number; status: string };
type QuoteLine = { id: string; section: 'materials'|'labor'|'other'; designation: string; unit: string; quantity: string; unitPrice: string };

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
function decimalToMilli(value: string) { const match=value.trim().replace(',','.').match(/^(\d+)(?:\.(\d{0,3}))?$/); if(!match)return null; return Number(BigInt(match[1])*BigInt(1000)+BigInt((match[2]??'').padEnd(3,'0'))); }
function lineTotal(line: QuoteLine) { const quantity=decimalToMilli(line.quantity),price=decimalToMilli(line.unitPrice); return quantity==null||price==null?0:Number((BigInt(quantity)*BigInt(price)+BigInt(500))/BigInt(1000)); }
const emptyQuoteLine=():QuoteLine=>({id:crypto.randomUUID(),section:'other',designation:'',unit:'u',quantity:'1',unitPrice:''});

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
  const [documents, setDocuments] = useState<QuoteDocument[]>([]);
  const [uploading, setUploading] = useState(false);
  const [quoteLines, setQuoteLines] = useState<Record<string, QuoteLine[]>>({});
  const [validUntil, setValidUntil] = useState('');
  const [quoteTerms, setQuoteTerms] = useState('');
  const [materialReferences, setMaterialReferences] = useState('');
  const [subLots, setSubLots] = useState<Record<string, SubLotDraft[]>>({});
  const [subLotLinks, setSubLotLinks] = useState<LinkDraft[]>([]);
  const [referents, setReferents] = useState<Referent[]>([]);

  async function load() {
    setLoading(true); setError(''); setLines({}); setIndivisible(false); setDocuments([]); setQuoteLines({}); setSubLots({}); setSubLotLinks([]);
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
      const versions = await supabase.from('bid_versions').select('id,version_no,status,submitted_at,expires_at,publication_id,quote_valid_until,quote_terms,material_references').eq('bid_id', bid.id).order('version_no', { ascending: false }).limit(1);
      const candidate=versions.data?.[0];
      nextVersion=candidate&&(candidate.publication_id===id||(candidate.publication_id==null&&candidate.submitted_at&&candidate.submitted_at>=p.published_at))?candidate:null;
      if (nextVersion) {
        setValidUntil(nextVersion.quote_valid_until??''); setQuoteTerms(nextVersion.quote_terms??''); setMaterialReferences(nextVersion.material_references??'');
        const itemResult = await supabase.from('bid_items').select('id,request_version_id,price_millimes,duration_days,inclusions,exclusions').eq('bid_version_id', nextVersion.id);
        const nextLines: Record<string, OfferLine> = {};
        for (const item of itemResult.data ?? []) {
          selectedRequestVersions.add(item.request_version_id);
          nextLines[item.request_version_id] = { price: String(Number(item.price_millimes) / 1000), duration: String(item.duration_days), inclusions: item.inclusions ?? '', exclusions: item.exclusions ?? '' };
        }
        const quoteResult = await supabase.from('bid_quote_lines').select('id,bid_item_id,section,designation,unit,quantity_milli,unit_price_millimes,position').eq('bid_version_id', nextVersion.id).order('position');
        if (!quoteResult.error) {
          const itemById=new Map((itemResult.data??[]).map(item=>[item.id,item.request_version_id])); const nextQuotes:Record<string,QuoteLine[]>={};
          for(const row of quoteResult.data??[]){const requestVersionId=itemById.get(row.bid_item_id);if(!requestVersionId)continue;(nextQuotes[requestVersionId]??=[]).push({id:row.id,section:row.section,designation:row.designation,unit:row.unit,quantity:String(Number(row.quantity_milli)/1000),unitPrice:String(Number(row.unit_price_millimes)/1000)});}
          setQuoteLines(nextQuotes);
        }
        const [subLotResult, linkResult] = await Promise.all([
          supabase.from('bid_sub_lots').select('bid_item_id,node_key,position,title,scope,start_date,end_date,budget_millimes,official_sub_lot_id').eq('bid_version_id', nextVersion.id).order('position'),
          supabase.from('bid_sub_lot_links').select('pred_kind,pred_ref,succ_kind,succ_ref').eq('bid_version_id', nextVersion.id).order('created_at'),
        ]);
        if (!subLotResult.error) {
          const requestVersionByItem = new Map((itemResult.data ?? []).map(item => [item.id, item.request_version_id])); const nextSubLots: Record<string, SubLotDraft[]> = {};
          for (const row of subLotResult.data ?? []) { const requestVersionId = requestVersionByItem.get(row.bid_item_id); if (!requestVersionId) continue; (nextSubLots[requestVersionId] ??= []).push({ key: row.node_key, title: row.title, scope: row.scope ?? '', start: row.start_date ?? '', end: row.end_date ?? '', budget: row.budget_millimes == null ? '' : String(Number(row.budget_millimes) / 1000), officialId: row.official_sub_lot_id ?? '' }); }
          setSubLots(nextSubLots);
        }
        if (!linkResult.error) setSubLotLinks((linkResult.data ?? []).map((row: any) => ({ predKind: row.pred_kind, predRef: row.pred_ref, succKind: row.succ_kind, succRef: row.succ_ref })));
        setLines(nextLines);
        const itemIds = (itemResult.data ?? []).map(item => item.id);
        const results = itemIds.length ? await supabase.from('bid_item_results').select('id,bid_item_id,status').in('bid_item_id', itemIds).order('id', { ascending: false }) : { data: [], error: null };
        const latest = new Map<string, string>();
        for (const row of results.data ?? []) if (!latest.has(row.bid_item_id)) latest.set(row.bid_item_id, row.status);
        for (const lot of nextLots) { const item = itemResult.data?.find(item => item.request_version_id === lot.request_version_id); if (item) lot.result = latest.get(item.id); }
        const groups = await supabase.from('bid_groups').select('indivisible').eq('bid_version_id', nextVersion.id);
        setIndivisible((groups.data ?? []).some(group => group.indivisible));
        const documentResult = await supabase.from('bid_documents').select('id,original_name,size_bytes,status').eq('bid_version_id', nextVersion.id).order('created_at', { ascending: false });
        if (!documentResult.error) setDocuments((documentResult.data ?? []) as QuoteDocument[]);
      }
    }
    const referentResult = await supabase.rpc('bid_link_referents', { p_publication_id: id });
    setReferents(referentResult.error ? [] : ((referentResult.data ?? []) as Referent[]));
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
  function updateQuoteLine(requestVersionId:string,lineId:string,patch:Partial<QuoteLine>){setQuoteLines(current=>({...current,[requestVersionId]:(current[requestVersionId]??[]).map(line=>line.id===lineId?{...line,...patch}:line)}));}
  async function getToken() { const { data } = await supabaseBrowser().auth.getSession(); if (!data.session) throw new Error('Session expirée.'); return data.session.access_token; }
  async function ensureDraft() {
    if (version?.id) return version.id as string;
    const token = await getToken();
    const response = await fetch('/api/bids', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ publication_id: id }) });
    const body = await response.json();
    if (!response.ok || !body.data?.id) throw new Error(body.error || 'Création du brouillon refusée.');
    setVersion(body.data);
    return body.data.id as string;
  }
  async function uploadQuote(file: File) {
    setUploading(true); setError(''); setMessage('');
    try {
      if (file.type !== 'application/pdf' || !file.name.toLowerCase().endsWith('.pdf')) throw new Error('Choisissez un fichier PDF.');
      if (file.size < 1 || file.size > 20 * 1024 * 1024) throw new Error('Le PDF doit peser moins de 20 Mo.');
      const token = await getToken();
      const versionId = await ensureDraft();
      const prepare = await fetch('/api/documents/upload', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ bidVersionId: versionId, originalName: file.name, mimeType: file.type, sizeBytes: file.size }) });
      const prepared = await prepare.json();
      if (!prepare.ok) throw new Error(prepared.error || 'Préparation de l’envoi refusée.');
      const uploaded = await supabaseBrowser().storage.from('dao-private').uploadToSignedUrl(prepared.data.path, prepared.data.token, file, { contentType: 'application/pdf' });
      if (uploaded.error) throw uploaded.error;
      const complete = await fetch('/api/documents/quote/complete', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ document_id: prepared.data.document.id }) });
      const completed = await complete.json();
      if (!complete.ok) throw new Error(completed.error || 'Le contrôle du PDF a échoué.');
      setMessage('Devis PDF joint et contrôlé. Il sera figé avec cette version lors de la soumission.');
      setDocuments(current=>[completed.data as QuoteDocument,...current.filter(document=>document.id!==completed.data.id)]);
    } catch (cause: any) { setError(cause?.message || 'Envoi du PDF impossible.'); } finally { setUploading(false); }
  }
  async function downloadQuote(documentId: string) {
    try { const token=await getToken(); const response=await fetch('/api/documents/download',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({document_id:documentId})}); const body=await response.json(); if(!response.ok)throw new Error(body.error||'Téléchargement refusé.'); window.open(body.data,'_blank','noopener,noreferrer'); } catch(cause:any){setError(cause?.message||'Téléchargement impossible.');}
  }
  async function deleteQuote(documentId: string) {
    setUploading(true); setError('');
    try { const token=await getToken(); const response=await fetch('/api/documents/quote/delete',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({document_id:documentId})}); const body=await response.json(); if(!response.ok)throw new Error(body.error||'Suppression refusée.'); setMessage('Devis PDF retiré du brouillon.'); setDocuments(current=>current.filter(document=>document.id!==documentId)); } catch(cause:any){setError(cause?.message||'Suppression impossible.');} finally {setUploading(false);}
  }
  async function save(submit: boolean) {
    setSaving(true); setError(''); setMessage('');
    try {
      if (!selectedLots.length) throw new Error('Sélectionnez au moins un lot.');
      if (closed) throw new Error('La date limite de ce DAO est dépassée.');
      const token = await getToken();
      const versionId = await ensureDraft();
      const itemIds: string[] = [];
      for (const lot of selectedLots) {
        const line = lines[lot.request_version_id];
        const details=quoteLines[lot.request_version_id]??[]; const detailedTotal=details.reduce((sum,item)=>sum+lineTotal(item),0); const manualPrice=decimalToMilli(line?.price??'');
        if (!line || (!details.length&&manualPrice==null) || !line.duration || !line.inclusions.trim()) throw new Error(`Complétez le prix, le délai et la proposition technique pour « ${lot.safe_title} ».`);
        if(details.some(item=>!item.designation.trim()||!item.unit.trim()||decimalToMilli(item.quantity)==null||decimalToMilli(item.unitPrice)==null))throw new Error(`Complétez toutes les lignes du devis détaillé pour « ${lot.safe_title} ».`);
        const ownSubLots = subLots[lot.request_version_id] ?? [];
        const subLotIssue = subLotsProblem(ownSubLots, details.length ? detailedTotal : manualPrice);
        if (subLotIssue) throw new Error(`« ${lot.safe_title} » — ${subLotIssue}`);
        const itemResponse = await fetch('/api/bids/items', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ publication_id: id, version_id: versionId, publication_request_id: lot.id, price_millimes: details.length?detailedTotal:manualPrice, duration_days: Number(line.duration), inclusions: line.inclusions, exclusions: line.exclusions || null }) });
        const itemBody = await itemResponse.json();
        if (!itemResponse.ok) throw new Error(itemBody.error || 'Enregistrement de la ligne refusé.');
        itemIds.push(itemBody.data.id);
        const quoteResponse=await fetch('/api/bids/quote/lines',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({bid_item_id:itemBody.data.id,lines:details.map(item=>({section:item.section,designation:item.designation,unit:item.unit,quantity_milli:decimalToMilli(item.quantity),unit_price_millimes:decimalToMilli(item.unitPrice)}))})});
        const quoteBody=await quoteResponse.json();if(!quoteResponse.ok)throw new Error(quoteBody.error||'Enregistrement du devis détaillé refusé.');
        const subLotResponse = await fetch('/api/bids/sub-lots', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ bid_item_id: itemBody.data.id, sub_lots: subLotsPayload(ownSubLots) }) });
        const subLotBody = await subLotResponse.json(); if (!subLotResponse.ok) throw new Error(subLotBody.error || 'Enregistrement des sous-lots refusé.');
      }
      const selectedKeys = new Set(selectedLots.flatMap(lot => (subLots[lot.request_version_id] ?? []).map(item => item.key)));
      const linkIssue = linksProblem(subLotLinks, selectedKeys);
      if (linkIssue) throw new Error(linkIssue);
      const linksResponse = await fetch('/api/bids/sub-lot-links', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ version_id: versionId, links: linksPayload(subLotLinks) }) });
      const linksBody = await linksResponse.json(); if (!linksResponse.ok) throw new Error(linksBody.error || 'Enregistrement des enchaînements refusé.');
      const metadataResponse=await fetch('/api/bids/quote/metadata',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({version_id:versionId,valid_until:validUntil||null,terms:quoteTerms||null,material_references:materialReferences||null})}); const metadataBody=await metadataResponse.json();if(!metadataResponse.ok)throw new Error(metadataBody.error||'Enregistrement des informations du devis refusé.');
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
      setVersion(body.data); setLines({}); setIndivisible(false); setSubLots({}); setSubLotLinks([]); setMessage('Nouvelle version de votre offre prête à compléter.');
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
  const totalMillimes = selectedLots.reduce((sum, lot) => { const details=quoteLines[lot.request_version_id]??[]; return sum+(details.length?details.reduce((value,item)=>value+lineTotal(item),0):(decimalToMilli(lines[lot.request_version_id]?.price??'')??0)); }, 0);
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
        {lot.acceptsOffers&&<Link href={`/app/messages?onglet=rfi&lot=${encodeURIComponent(lot.id)}&nouvelle=1`} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl border border-teal/25 bg-white px-3.5 text-sm font-semibold text-teal hover:border-teal"><HelpCircle size={16}/>Poser une question technique</Link>}
        {lot.technical_scope?.map((s:any)=><div key={s.id} className="mt-3 border-l-2 border-teal/25 pl-3"><h4 className="font-semibold text-ink">{s.title}</h4><p className="text-sm text-black/65">{s.scope}</p>{s.budget_millimes!=null&&<p className="text-sm font-medium tabular-nums">{Number(s.budget_millimes)/1000} TND</p>}</div>)}
        {(!lot.acceptsOffers || lot.result) && <div className="mt-3 flex flex-wrap items-center gap-2">{!lot.acceptsOffers && <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-black/60"><Lock aria-hidden="true" size={14} />Lot fermé aux nouvelles offres</p>}{lot.result === 'not_selected' && <Badge>Non retenue</Badge>}{lot.result === 'selected' && <Badge tone="teal">Offre retenue</Badge>}</div>}
      </article>; })}</div></Card>
    {error&&<p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}{message&&<p role="status" className="rounded-xl bg-teal/10 px-4 py-3 text-sm font-medium text-teal">{message}</p>}
    {version?.status === 'submitted' ? <Card className="border-teal/20 p-5 sm:p-7"><div className="flex items-start gap-3"><CheckCircle2 aria-hidden="true" size={24} className="shrink-0 text-teal" /><div><h2 className="text-xl font-bold text-ink">Offre envoyée</h2><p className="mt-1 text-sm text-black/60">Version {version.version_no} soumise le {new Date(version.submitted_at).toLocaleString('fr-TN')}. Le contenu est désormais figé.</p></div></div><div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">{canBid && !closed && <Button className="min-h-11" disabled={saving} onClick={() => void startNewVersion()}>Préparer une nouvelle version</Button>}{lots.some(lot=>lot.result==='selected')?<p className="text-sm font-semibold text-teal">Cette offre attribuée ne peut plus être retirée.</p>:<Button className="min-h-11 bg-white text-red-700 ring-1 ring-inset ring-red-200 hover:bg-red-50" disabled={saving} onClick={()=>void withdrawOffer()}>Retirer l’offre</Button>}</div></Card>
    : version?.status==='withdrawn'?<Card className="p-5 sm:p-7"><h2 className="text-xl font-bold text-ink">Offre retirée</h2><p className="mt-1 text-sm text-black/60">La version {version.version_no} reste conservée dans votre historique.</p>{canBid&&!closed&&<Button className="mt-4 min-h-11" disabled={saving} onClick={()=>void startNewVersion()}>Préparer une nouvelle version</Button>}</Card>
    : !canBid ? <Card className="border-clay/20 bg-clay/[0.04] p-5 sm:p-7"><h2 className="text-xl font-bold text-ink">Offres indisponibles pour ce profil</h2><p className="mt-2 text-sm text-black/60">Votre profil professionnel doit être vérifié par D.A.O avant de créer ou modifier une offre. Vous pouvez continuer à consulter les informations publiques de ce DAO.</p><a href="/app/profile#professional-profile" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-ink px-4 text-sm font-semibold text-white transition hover:bg-teal">Voir mon profil professionnel</a></Card>
    : <Card className="p-5 sm:p-7"><div><h2 className="text-xl font-bold tracking-tight text-ink">Votre proposition</h2><p className="mt-1 text-sm text-black/55">Montants en TND. Tant que l’offre n’est pas soumise, vous pouvez enregistrer un brouillon et y revenir.</p></div>
      <section className="mt-5 rounded-2xl border border-black/[0.08] bg-sand/30 p-4 sm:p-5" aria-labelledby="quote-pdf-title"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 id="quote-pdf-title" className="flex items-center gap-2 font-bold text-ink"><Paperclip aria-hidden="true" size={17} />Devis PDF</h3><p className="mt-1 text-sm text-black/55">Facultatif · PDF privé de 20 Mo maximum · lié uniquement à cette version.</p></div><label className={`inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-ink ring-1 ring-inset ring-black/10 ${editable&&!uploading?'cursor-pointer hover:bg-sand':'cursor-not-allowed opacity-60'}`}><FileText aria-hidden="true" size={16}/>{uploading?'Contrôle du PDF…':documents.length?'Remplacer / ajouter':'Joindre un PDF'}<input className="sr-only" type="file" accept="application/pdf,.pdf" disabled={!editable||uploading} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void uploadQuote(file);}} /></label></div>
      {documents.length===0?<p className="mt-3 text-sm text-black/50">Aucun devis PDF joint — l’offre en ligne reste valide.</p>:<ul className="mt-3 space-y-2">{documents.map(document=><li key={document.id} className="flex flex-col gap-2 rounded-xl bg-white p-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="truncate text-sm font-semibold text-ink">{document.original_name}</p><p className="text-xs text-black/50">{(document.size_bytes/1024/1024).toFixed(2)} Mo · {document.status==='approved'?'PDF contrôlé':'Contrôle en cours'}</p></div><div className="flex gap-2"><Button className="min-h-10 bg-white text-ink ring-1 ring-inset ring-black/10 hover:bg-sand" onClick={()=>void downloadQuote(document.id)}><Download aria-hidden="true" size={15}/>Voir</Button>{editable&&<Button disabled={uploading} className="min-h-10 bg-white text-red-700 ring-1 ring-inset ring-red-200 hover:bg-red-50" onClick={()=>void deleteQuote(document.id)}><Trash2 aria-hidden="true" size={15}/>Retirer</Button>}</div></li>)}</ul>}</section>
      {selectedLots.length === 0 && <p className="mt-5 rounded-2xl border border-dashed border-black/10 px-4 py-6 text-center text-sm text-black/55">Cochez au moins un lot ci-dessus pour préparer votre offre.</p>}
      <div className="mt-5 space-y-4">{selectedLots.map((lot) => { const line = lines[lot.request_version_id] ?? { price: '', duration: '', inclusions: '', exclusions: '' }; const details=quoteLines[lot.request_version_id]??[]; const detailTotal=details.reduce((sum,item)=>sum+lineTotal(item),0); return <div key={lot.id} className="rounded-xl border border-black/[0.08] p-4 sm:p-5"><h3 className="text-lg font-bold text-ink">{lot.safe_title}</h3><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className={fieldLabel}>Prix proposé (TND)<Input className="mt-1.5 min-h-11 tabular-nums" type="text" inputMode="decimal" disabled={!editable||details.length>0} value={details.length?String(detailTotal/1000):line.price} onChange={(event) => updateLine(lot.request_version_id, 'price', event.target.value)} placeholder="Ex. 18500.000" />{details.length>0&&<span className="mt-1 block text-xs text-black/50">Calculé automatiquement depuis les postes.</span>}</label><label className={fieldLabel}>Délai (jours)<Input className="mt-1.5 min-h-11 tabular-nums" type="number" inputMode="numeric" min="1" step="1" disabled={!editable} value={line.duration} onChange={(event) => updateLine(lot.request_version_id, 'duration', event.target.value)} placeholder="Ex. 21" /></label></div>
      <div className="mt-4 rounded-xl bg-sand/50 p-3 sm:p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h4 className="font-bold text-ink">Postes du devis détaillé</h4><p className="text-xs text-black/50">Facultatif. Le total des postes devient le prix du lot.</p></div>{editable&&<Button className="min-h-10 bg-white text-ink ring-1 ring-inset ring-black/10 hover:bg-sand" onClick={()=>setQuoteLines(current=>({...current,[lot.request_version_id]:[...(current[lot.request_version_id]??[]),emptyQuoteLine()]}))}><Plus aria-hidden="true" size={15}/>Ajouter un poste</Button>}</div>
      {details.length>0&&<div className="mt-3 space-y-3">{details.map((detail,index)=><div key={detail.id} className="grid min-w-0 gap-2 rounded-xl bg-white p-3 md:grid-cols-12"><label className="min-w-0 text-xs font-semibold md:col-span-2">Catégorie<select className={area} disabled={!editable} value={detail.section} onChange={e=>updateQuoteLine(lot.request_version_id,detail.id,{section:e.target.value as QuoteLine['section']})}><option value="materials">Matériaux</option><option value="labor">Main-d’œuvre</option><option value="other">Autre</option></select></label><label className="min-w-0 text-xs font-semibold md:col-span-3">Désignation<Input className="mt-1.5" disabled={!editable} value={detail.designation} onChange={e=>updateQuoteLine(lot.request_version_id,detail.id,{designation:e.target.value})}/></label><label className="min-w-0 text-xs font-semibold md:col-span-1">Unité<Input className="mt-1.5" disabled={!editable} value={detail.unit} onChange={e=>updateQuoteLine(lot.request_version_id,detail.id,{unit:e.target.value})}/></label><label className="min-w-0 text-xs font-semibold md:col-span-2">Quantité<Input className="mt-1.5" inputMode="decimal" disabled={!editable} value={detail.quantity} onChange={e=>updateQuoteLine(lot.request_version_id,detail.id,{quantity:e.target.value})}/></label><label className="min-w-0 text-xs font-semibold md:col-span-2">PU TND<Input className="mt-1.5" inputMode="decimal" disabled={!editable} value={detail.unitPrice} onChange={e=>updateQuoteLine(lot.request_version_id,detail.id,{unitPrice:e.target.value})}/></label><div className="flex min-w-0 items-end justify-between gap-2 md:col-span-2"><span className="min-w-0 pb-2 text-xs font-bold tabular-nums">{formatTnd(lineTotal(detail))}</span>{editable&&<button type="button" aria-label={`Supprimer le poste ${index+1}`} className="mb-1 shrink-0 rounded-lg p-2 text-red-700 hover:bg-red-50" onClick={()=>setQuoteLines(current=>({...current,[lot.request_version_id]:current[lot.request_version_id].filter(item=>item.id!==detail.id)}))}><Trash2 size={15}/></button>}</div></div>)}<p className="text-right text-sm font-bold tabular-nums text-ink">Total du lot : {formatTnd(detailTotal)}</p></div>}</div>
      <SubLotsEditor lotTitle={lot.safe_title} items={subLots[lot.request_version_id] ?? []} editable={editable} priceMillimes={details.length ? detailTotal : decimalToMilli(line.price)} officialOptions={(lot.technical_scope ?? []).map((s: any) => ({ id: s.id, title: s.title }))} onChange={(next) => setSubLots(current => ({ ...current, [lot.request_version_id]: next }))} />
      <label className={`mt-3 ${fieldLabel}`}>Proposition technique / inclusions<textarea disabled={!editable} value={line.inclusions} onChange={(event) => updateLine(lot.request_version_id, 'inclusions', event.target.value)} className={`${area} min-h-28`} placeholder="Fournitures, main-d’œuvre, essais, nettoyage…" /></label><label className={`mt-3 ${fieldLabel}`}>Exclusions / variantes<textarea disabled={!editable} value={line.exclusions} onChange={(event) => updateLine(lot.request_version_id, 'exclusions', event.target.value)} className={`${area} min-h-20`} placeholder="Optionnel" /></label></div>; })}</div>
      {selectedLots.length > 0 && <SubLotLinksEditor links={subLotLinks} editable={editable} referents={referents} ownNodes={selectedLots.flatMap(lot => (subLots[lot.request_version_id] ?? []).map(item => ({ key: item.key, title: item.title, lotTitle: lot.safe_title })))} onChange={setSubLotLinks} />}
      {selectedLots.length>0&&<section className="mt-4 grid gap-3 rounded-xl border border-black/[0.08] p-4 sm:grid-cols-2"><label className={fieldLabel}>Validité annoncée du devis<Input className="mt-1.5" type="date" min={new Date().toISOString().slice(0,10)} disabled={!editable} value={validUntil} onChange={e=>setValidUntil(e.target.value)}/></label><label className={fieldLabel}>Matériaux / références<Input className="mt-1.5" disabled={!editable} value={materialReferences} onChange={e=>setMaterialReferences(e.target.value)} placeholder="Marques ou références proposées"/></label><label className={`${fieldLabel} sm:col-span-2`}>Conditions / garantie annoncées<textarea className={`${area} min-h-20`} disabled={!editable} value={quoteTerms} onChange={e=>setQuoteTerms(e.target.value)} placeholder="Conditions commerciales ou garantie, sans déduction fiscale automatique"/></label></section>}
      {selectedLots.length >= 2 && <label className="mt-4 flex min-h-11 items-start gap-3 rounded-xl bg-clay/[0.06] px-3.5 py-3 text-sm text-ink"><input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-teal" checked={indivisible} disabled={!editable} onChange={event => setIndivisible(event.target.checked)} /><span className="inline-flex items-start gap-1.5"><Package aria-hidden="true" size={15} className="mt-0.5 shrink-0 text-clay" />Package indivisible : tous les lots de cette offre ensemble</span></label>}
      {selectedLots.length > 0 && <div className="mt-6 flex flex-col gap-4 border-t border-black/5 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-xs font-semibold uppercase tracking-wide text-black/45">Total de votre offre</p><p className="text-2xl font-bold tabular-nums text-ink">{formatTnd(totalMillimes)}</p>{longest > 0 && <p className="text-xs text-black/50">Délai le plus long : {longest} jour{longest > 1 ? 's' : ''}</p>}</div>
        <div className="flex flex-col gap-2 sm:flex-row"><Button disabled={saving || !editable} className="min-h-11 bg-white text-ink ring-1 ring-inset ring-black/10 hover:bg-sand" onClick={() => void save(false)}>{saving ? 'Enregistrement…' : 'Enregistrer le brouillon'}</Button><Button disabled={saving || !editable} className="min-h-11 gap-2 bg-clay hover:bg-teal" onClick={() => void save(true)}><Send aria-hidden="true" size={16} />Soumettre l’offre</Button></div>
      </div>}
    </Card>}
  </section>;
}
