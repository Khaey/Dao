'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { supabaseBrowser } from '../../../lib/supabase-browser';
import { ArrowRight, CalendarClock, Hammer, MapPin, Ruler, Search, ShieldAlert, X } from 'lucide-react';
import { Badge, Card } from '../../../components/ui';
import { ErrorPanel } from '../projects/_components/ProjectUi';

type Publication = {
  id: string;
  project_id: string;
  visibility: 'public' | 'targeted' | 'invite_only';
  status: string;
  safe_title: string;
  safe_description: string;
  governorate_id: string;
  project_type: string;
  surface_m2: number | null;
  desired_start_date: string | null;
  indicative_budget_millimes: number | null;
  submission_deadline: string | null;
};
type Lot = { publication_id: string; trade_id: string; safe_title: string };
type ProfessionalProfile = { business_name: string; public_trade_name: string; verification_status: string };

const visibilityLabel: Record<Publication['visibility'], string> = {
  public: 'DAO public',
  targeted: 'DAO ciblé',
  invite_only: 'DAO sur invitation',
};
const projectTypeLabel: Record<string, string> = {
  construction: 'Construction', renovation: 'Rénovation', repair: 'Réparation', extension: 'Extension', other: 'Autre',
};
const verificationLabel: Record<string, string> = {
  pending: 'En attente de vérification',
  verified: 'Profil vérifié',
  rejected: 'Corrections demandées',
  suspended: 'Profil suspendu',
};
const offerStatus: Record<string, { label: string; tone: 'neutral' | 'teal' | 'clay' | 'red' }> = {
  draft: { label: 'Brouillon', tone: 'clay' },
  submitted: { label: 'Offre envoyée', tone: 'teal' },
  withdrawn: { label: 'Offre retirée', tone: 'neutral' },
  expired: { label: 'Offre expirée', tone: 'red' },
  superseded: { label: 'Version remplacée', tone: 'neutral' },
};

function formatTnd(value: number | null) {
  if (value == null) return 'Budget non renseigné';
  return new Intl.NumberFormat('fr-TN', { style: 'currency', currency: 'TND', maximumFractionDigits: 3 }).format(Number(value) / 1000);
}
function deadlineLabel(deadline: string | null) {
  if (!deadline) return { label: 'Ouvert', tone: 'bg-teal/10 text-teal' };
  const date = new Date(deadline);
  if (date.getTime() <= Date.now()) return { label: 'Fermé', tone: 'bg-red-50 text-red-700' };
  const days = Math.ceil((date.getTime() - Date.now()) / 86_400_000);
  return { label: days <= 7 ? `Clôture dans ${days} j` : `Réponses jusqu’au ${date.toLocaleDateString('fr-TN', { day: 'numeric', month: 'short' })}`, tone: days <= 3 ? 'bg-red-50 text-red-700' : days <= 7 ? 'bg-clay/10 text-clay' : 'bg-teal/10 text-teal' };
}
const select = 'min-h-11 w-full rounded-xl border border-black/10 bg-white px-3 text-sm text-ink outline-none transition focus:border-teal focus:ring-4 focus:ring-teal/10';

export default function ArtisanDashboard() {
  const [rows, setRows] = useState<(Publication & { lots: Lot[]; tradeNames: string[]; governorateName?: string; bidStatus?: string; acceptsOffers: boolean; openLots: number })[]>([]);
  const [trades, setTrades] = useState<{ id: string; name_fr: string }[]>([]);
  const [governorates, setGovernorates] = useState<{ id: string; name_fr: string }[]>([]);
  const [tradeFilter, setTradeFilter] = useState('');
  const [governorateFilter, setGovernorateFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [professional, setProfessional] = useState<ProfessionalProfile | null>(null);

  async function load() {
    setLoading(true); setError('');
    const supabase = supabaseBrowser();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) { setAllowed(false); setLoading(false); return; }
    const { data: roleRows, error: roleError } = await supabase.from('user_roles').select('role').eq('user_id', userData.user.id).eq('role', 'contractor');
    if (roleError) { setError('Impossible de vérifier votre rôle artisan.'); setLoading(false); return; }
    if (!roleRows?.length) { setAllowed(false); setLoading(false); return; }
    setAllowed(true);
    const professionalResult = await supabase.from('contractor_profiles').select('business_name,public_trade_name,verification_status').eq('user_id', userData.user.id).maybeSingle();
    if (professionalResult.error || !professionalResult.data) { setError('Votre profil professionnel est introuvable.'); setLoading(false); return; }
    setProfessional(professionalResult.data as ProfessionalProfile);

    const [publicationResult, tradeResult, governorateResult] = await Promise.all([
      supabase.from('publications').select('id,project_id,visibility,status,safe_title,safe_description,governorate_id,project_type,surface_m2,desired_start_date,indicative_budget_millimes,submission_deadline').eq('status', 'published').order('published_at', { ascending: false }),
      supabase.from('trades').select('id,name_fr').eq('active', true).order('name_fr'),
      supabase.from('governorates').select('id,name_fr').order('name_fr'),
    ]);
    if (publicationResult.error) { setError('Impossible de charger les DAO accessibles.'); setLoading(false); return; }
    const publications = (publicationResult.data ?? []) as Publication[];
    const ids = publications.map((row) => row.id);
    const projectIds = publications.map((row) => row.project_id);
    const [lotResult, bidsResult] = await Promise.all([
      ids.length ? supabase.from('publication_requests').select('publication_id,trade_id,safe_title').in('publication_id', ids) : Promise.resolve({ data: [], error: null } as any),
      projectIds.length ? supabase.from('bids').select('id,project_id,publication_id').in('project_id', projectIds) : Promise.resolve({ data: [], error: null } as any),
    ]);
    const bidIds = (bidsResult.data ?? []).map((row: any) => row.id);
    const versionsResult = bidIds.length ? await supabase.from('bid_versions').select('bid_id,status,version_no').in('bid_id', bidIds).order('version_no', { ascending: false }) : { data: [], error: null } as any;
    // Same authoritative availability RPC used by the DAO detail, including withdrawn and awarded lots.
    // Bound concurrency avoids flooding PostgREST when many publications are accessible.
    const availability = new Map<string, boolean>(); const openLots = new Map<string, number>();
    for (let offset=0; offset<publications.length; offset+=10) {
      const batch=publications.slice(offset,offset+10);
      const results=await Promise.all(batch.map(publication=>supabase.rpc('publication_lot_availability',{p_publication_id:publication.id})));
      if(results.some(result=>result.error)){setError('Impossible de vérifier la disponibilité des lots.');setLoading(false);return;}
      batch.forEach((publication,index)=>{const lots=(results[index].data??[]) as any[];availability.set(publication.id,lots.some(lot=>lot.accepts_offers===true));openLots.set(publication.id,lots.filter(lot=>lot.accepts_offers===true).length);});
    }
    const tradeMap = new Map((tradeResult.data ?? []).map((row: any) => [row.id, row.name_fr]));
    const governorateMap = new Map((governorateResult.data ?? []).map((row: any) => [row.id, row.name_fr]));
    const projectBidMap = new Map<string, string>();
    for (const bid of (bidsResult.data ?? [])) {
      const version = (versionsResult.data ?? []).find((item: any) => item.bid_id === bid.id);
      if (version) projectBidMap.set(bid.publication_id||bid.project_id, version.status);
    }
    const lotMap = new Map<string, Lot[]>();
    for (const lot of (lotResult.data ?? []) as Lot[]) lotMap.set(lot.publication_id, [...(lotMap.get(lot.publication_id) ?? []), lot]);
    setTrades(tradeResult.data ?? []); setGovernorates(governorateResult.data ?? []);
    // #356: « DAO disponibles » lists only publications where an offer is still possible (fail closed on unknown
    // availability). Sent offers stay in « Mes offres »; publication statuses are never changed here.
    const stillOpen = (row: Publication) => row.status === 'published' && availability.get(row.id) === true && (!row.submission_deadline || new Date(row.submission_deadline).getTime() > Date.now());
    setRows(publications.filter(stillOpen).map((row) => {
      const lots = lotMap.get(row.id) ?? [];
      return { ...row, lots, tradeNames: [...new Set(lots.map((lot) => tradeMap.get(lot.trade_id)).filter(Boolean) as string[])], governorateName: governorateMap.get(row.governorate_id), bidStatus: projectBidMap.get(row.id)||projectBidMap.get(row.project_id), acceptsOffers: availability.get(row.id)===true, openLots: openLots.get(row.id) ?? 0 };
    }));
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => rows.filter((row) => {
    const matchesQuery = !query.trim() || `${row.safe_title} ${row.safe_description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
    const matchesTrade = !tradeFilter || row.lots.some((lot) => lot.trade_id === tradeFilter);
    return matchesQuery && matchesTrade && (!governorateFilter || row.governorate_id === governorateFilter) && (!typeFilter || row.project_type === typeFilter);
  }), [rows, query, tradeFilter, governorateFilter, typeFilter]);

  const filtersActive = Boolean(query || tradeFilter || governorateFilter || typeFilter);
  const verified = professional?.verification_status === 'verified';
  if (loading) return <section aria-busy="true" className="space-y-6"><span className="sr-only">Chargement de votre espace artisan…</span><div className="h-20 w-2/3 animate-pulse rounded-2xl bg-black/5" /><div className="h-24 animate-pulse rounded-2xl bg-black/5" /><div className="grid gap-4 lg:grid-cols-2">{[0, 1, 2, 3].map(item => <div key={item} className="h-52 animate-pulse rounded-2xl bg-black/5" />)}</div></section>;
  if (allowed === false) return <Card><h1 className="text-xl font-semibold">Espace réservé aux artisans</h1><p className="mt-2 text-sm text-black/60">Votre compte ne dispose pas du rôle Artisan / Entreprise.</p></Card>;
  return <section className="space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-6 rounded-3xl border border-teal/10 bg-gradient-to-br from-white via-teal/[0.055] to-sand/60 px-6 py-8 shadow-sm sm:px-9 sm:py-10"><div className="space-y-3"><p className="text-xs font-bold uppercase tracking-[0.16em] text-teal">Appels d’offres · espace professionnel</p><h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">DAO disponibles</h1><p className="text-lg font-semibold text-teal">Découvrez les chantiers accessibles</p><p className="max-w-2xl text-sm leading-relaxed text-black/60">Consultez les lots ouverts dans vos spécialités, comparez les besoins et proposez votre devis. Les publications ciblées et privées restent accessibles uniquement aux comptes autorisés.</p><p className="text-sm font-semibold text-teal">{rows.length} DAO accessible{rows.length > 1 ? 's' : ''} aux offres</p></div>
      <Link href="/app/artisan/offers" className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-black/10 bg-white px-4 text-sm font-semibold text-ink transition hover:border-teal hover:text-teal">Mes offres<ArrowRight aria-hidden="true" size={15} /></Link></header>
    {/* #356 owner decision: no profile card on « DAO disponibles ». Only a compact notice when a restriction
        actually applies (unverified, suspended or incomplete profile), with the way to fix it. */}
    {!verified && <div role="note" className={`flex flex-col gap-2 rounded-xl border px-4 py-3 text-sm sm:flex-row sm:items-center ${professional?.verification_status === 'suspended' ? 'border-red-200 bg-red-50 text-red-800' : 'border-clay/25 bg-clay/[0.05] text-black/70'}`}>
      <ShieldAlert aria-hidden="true" size={18} className="shrink-0 text-clay" />
      <p className="min-w-0 flex-1"><strong className="text-ink">Mon profil professionnel</strong> · <Badge tone={professional?.verification_status === 'suspended' ? 'red' : 'clay'}>{verificationLabel[professional?.verification_status ?? ''] ?? 'Statut indisponible'}</Badge> <span className="block sm:inline">{professional?.verification_status === 'suspended' ? 'Votre profil est suspendu : vous pouvez consulter les DAO, mais pas soumettre d’offre. Contactez D.A.O. depuis l’assistance.' : 'Vous pouvez consulter les DAO publics, mais la soumission d’offres sera possible après vérification par D.A.O.'}</span></p>
      <Link href="/app/profile#professional-profile" className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-teal px-4 text-sm font-semibold text-white transition hover:bg-tealdark">Voir mon profil</Link>
    </div>}
    {error ? <ErrorPanel title="Les DAO disponibles n’ont pas pu être chargés" message={error} onRetry={() => void load()} /> : <div className="space-y-3">
      <label className="relative block"><span className="sr-only">Rechercher</span><Search size={17} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-black/40" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un DAO (titre ou description)" className={`${select} pl-10`} /></label>
      <div className="grid gap-2 sm:grid-cols-3">
        <label><span className="sr-only">Métier</span><select aria-label="Métier" value={tradeFilter} onChange={(event) => setTradeFilter(event.target.value)} className={select}><option value="">Tous les métiers</option>{trades.map((trade) => <option value={trade.id} key={trade.id}>{trade.name_fr}</option>)}</select></label>
        <label><span className="sr-only">Gouvernorat</span><select aria-label="Gouvernorat" value={governorateFilter} onChange={(event) => setGovernorateFilter(event.target.value)} className={select}><option value="">Tous les gouvernorats</option>{governorates.map((item) => <option value={item.id} key={item.id}>{item.name_fr}</option>)}</select></label>
        <label><span className="sr-only">Type de chantier</span><select aria-label="Type de chantier" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className={select}><option value="">Tous les types</option>{Object.entries(projectTypeLabel).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      </div>
      <div className="flex min-h-6 flex-wrap items-center justify-between gap-2 text-sm text-black/55"><p aria-live="polite">{filtered.length} DAO{filtered.length !== rows.length ? ` sur ${rows.length}` : ''}</p>{filtersActive && <button type="button" onClick={() => { setQuery(''); setTradeFilter(''); setGovernorateFilter(''); setTypeFilter(''); }} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 font-semibold text-teal transition hover:bg-teal/5"><X aria-hidden="true" size={15} />Effacer les filtres</button>}</div>
    </div>}
    {!error && (filtered.length === 0 ? <Card className="flex flex-col items-center gap-2 border-dashed py-12 text-center"><Search aria-hidden="true" size={24} className="text-black/25" /><h2 className="font-semibold text-ink">Aucun DAO accessible</h2><p className="max-w-sm text-sm text-black/55">Aucun DAO encore ouvert aux offres ne correspond à vos accès et aux filtres. Les DAO fermés ou attribués n’apparaissent plus ici ; vos offres restent dans « Mes offres ».</p></Card>
    : <div className="grid gap-4 xl:grid-cols-2">{filtered.map((row) => { const open = row.status==='published' && row.acceptsOffers && (!row.submission_deadline || new Date(row.submission_deadline).getTime()>Date.now()); const deadline = open ? deadlineLabel(row.submission_deadline) : { label:'Fermé', tone:'bg-red-50 text-red-700' }; const bid = row.bidStatus ? offerStatus[row.bidStatus] ?? { label: row.bidStatus, tone: 'neutral' as const } : null;
      return <Link key={row.id} href={`/app/artisan/publications/${row.id}`} className="group block rounded-2xl focus:outline-none focus-visible:ring-4 focus-visible:ring-teal/25"><Card className="flex h-full flex-col p-5 transition group-hover:-translate-y-0.5 group-hover:border-teal/25 group-hover:shadow-[0_12px_32px_rgba(23,32,42,0.08)] sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2"><Badge>{visibilityLabel[row.visibility]}</Badge><div className="flex flex-wrap gap-2"><Badge tone={bid?.tone ?? (open ? 'neutral' : 'red')}>{bid?.label ?? (!open ? 'Fermé' : verified ? 'À répondre' : 'Consultation uniquement')}</Badge>{bid && !open && <Badge tone="red">Fermé</Badge>}</div></div>
        <h2 className="mt-3 break-words text-lg font-bold tracking-tight text-ink group-hover:text-teal">{row.safe_title}</h2>
        {row.safe_description && <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-black/60">{row.safe_description}</p>}
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-black/60"><span className="inline-flex items-center gap-1.5"><Hammer aria-hidden="true" size={14} />{projectTypeLabel[row.project_type] ?? 'Projet'}</span>{row.surface_m2 && <span className="inline-flex items-center gap-1.5"><Ruler aria-hidden="true" size={14} />{row.surface_m2} m²</span>}{row.governorateName && <span className="inline-flex items-center gap-1.5"><MapPin aria-hidden="true" size={14} />{row.governorateName}</span>}</div>
        {row.lots.length > 1 && row.openLots > 0 && row.openLots < row.lots.length && <p className="mt-2 text-xs font-semibold text-teal">{row.openLots} lot{row.openLots > 1 ? 's' : ''} sur {row.lots.length} encore ouvert{row.openLots > 1 ? 's' : ''} aux offres</p>}{row.tradeNames.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{row.tradeNames.map(name => <span key={name} className="rounded-lg bg-sand px-2 py-1 text-xs font-medium text-ink/75">{name}</span>)}</div>}
        <div aria-hidden="true" className="min-h-4 flex-1" /><div className="flex flex-wrap items-center justify-between gap-2 border-t border-black/5 pt-4"><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${deadline.tone}`}><CalendarClock aria-hidden="true" size={13} />{deadline.label}</span><span className="text-sm font-bold tabular-nums text-ink">{formatTnd(row.indicative_budget_millimes)}</span></div>
      </Card></Link>; })}</div>)}
  </section>;
}
