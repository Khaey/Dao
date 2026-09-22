'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { supabaseBrowser } from '../../../lib/supabase-browser';
import { Badge, Card } from '../../../components/ui';

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

const visibilityLabel: Record<Publication['visibility'], string> = {
  public: 'DAO public',
  targeted: 'DAO ciblé',
  invite_only: 'Invitation directe',
};
const projectTypeLabel: Record<string, string> = {
  construction: 'Construction', renovation: 'Rénovation', repair: 'Réparation', extension: 'Extension', other: 'Autre',
};

function formatTnd(value: number | null) {
  if (value == null) return 'Budget non renseigné';
  return new Intl.NumberFormat('fr-TN', { style: 'currency', currency: 'TND', maximumFractionDigits: 3 }).format(Number(value) / 1000);
}
function deadlineLabel(deadline: string | null) {
  if (!deadline) return { label: 'Ouvert', tone: 'text-teal' };
  const date = new Date(deadline);
  if (date.getTime() <= Date.now()) return { label: 'Fermé', tone: 'text-red-600' };
  const days = Math.ceil((date.getTime() - Date.now()) / 86_400_000);
  return { label: days <= 7 ? `Clôture dans ${days} j` : `Réponses jusqu’au ${date.toLocaleDateString('fr-TN')}`, tone: days <= 7 ? 'text-clay' : 'text-teal' };
}

export default function ArtisanDashboard() {
  const [rows, setRows] = useState<(Publication & { lots: Lot[]; tradeNames: string[]; governorateName?: string; bidStatus?: string })[]>([]);
  const [trades, setTrades] = useState<{ id: string; name_fr: string }[]>([]);
  const [governorates, setGovernorates] = useState<{ id: string; name_fr: string }[]>([]);
  const [tradeFilter, setTradeFilter] = useState('');
  const [governorateFilter, setGovernorateFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true); setError('');
    const supabase = supabaseBrowser();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) { setAllowed(false); setLoading(false); return; }
    const { data: roleRows, error: roleError } = await supabase.from('user_roles').select('role').eq('user_id', userData.user.id).eq('role', 'contractor');
    if (roleError) { setError('Impossible de vérifier votre rôle artisan.'); setLoading(false); return; }
    if (!roleRows?.length) { setAllowed(false); setLoading(false); return; }
    setAllowed(true);

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
      projectIds.length ? supabase.from('bids').select('id,project_id').in('project_id', projectIds) : Promise.resolve({ data: [], error: null } as any),
    ]);
    const bidIds = (bidsResult.data ?? []).map((row: any) => row.id);
    const versionsResult = bidIds.length ? await supabase.from('bid_versions').select('bid_id,status,version_no').in('bid_id', bidIds).order('version_no', { ascending: false }) : { data: [], error: null } as any;
    const tradeMap = new Map((tradeResult.data ?? []).map((row: any) => [row.id, row.name_fr]));
    const governorateMap = new Map((governorateResult.data ?? []).map((row: any) => [row.id, row.name_fr]));
    const projectBidMap = new Map<string, string>();
    for (const bid of (bidsResult.data ?? [])) {
      const version = (versionsResult.data ?? []).find((item: any) => item.bid_id === bid.id);
      if (version) projectBidMap.set(bid.project_id, version.status);
    }
    const lotMap = new Map<string, Lot[]>();
    for (const lot of (lotResult.data ?? []) as Lot[]) lotMap.set(lot.publication_id, [...(lotMap.get(lot.publication_id) ?? []), lot]);
    setTrades(tradeResult.data ?? []); setGovernorates(governorateResult.data ?? []);
    setRows(publications.map((row) => {
      const lots = lotMap.get(row.id) ?? [];
      return { ...row, lots, tradeNames: [...new Set(lots.map((lot) => tradeMap.get(lot.trade_id)).filter(Boolean) as string[])], governorateName: governorateMap.get(row.governorate_id), bidStatus: projectBidMap.get(row.project_id) };
    }));
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => rows.filter((row) => {
    const matchesQuery = !query.trim() || `${row.safe_title} ${row.safe_description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
    const matchesTrade = !tradeFilter || row.lots.some((lot) => lot.trade_id === tradeFilter);
    return matchesQuery && matchesTrade && (!governorateFilter || row.governorate_id === governorateFilter) && (!typeFilter || row.project_type === typeFilter);
  }), [rows, query, tradeFilter, governorateFilter, typeFilter]);

  if (loading) return <p>Chargement de votre espace artisan…</p>;
  if (allowed === false) return <Card><h1 className="text-xl font-semibold">Espace réservé aux artisans</h1><p className="mt-2 text-sm text-black/60">Votre compte ne dispose pas encore du rôle artisan vérifié.</p></Card>;
  return <section className="space-y-6">
    <div><p className="text-sm font-semibold text-teal">Espace artisan</p><h1 className="mt-1 text-3xl font-bold">DAO disponibles</h1><p className="mt-2 max-w-2xl text-black/60">Les publications affichées ici sont celles que votre compte est autorisé à consulter. Les DAO ciblés et sur invitation restent filtrés par la sécurité Supabase.</p></div>
    <Card><div className="grid gap-3 md:grid-cols-4"><label className="block text-xs font-medium md:col-span-2">Rechercher<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Titre ou description" className="mt-1.5 w-full rounded-xl border border-black/10 px-3 py-2.5 text-sm" /></label><label className="block text-xs font-medium">Métier<select value={tradeFilter} onChange={(event) => setTradeFilter(event.target.value)} className="mt-1.5 w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm"><option value="">Tous les métiers</option>{trades.map((trade) => <option value={trade.id} key={trade.id}>{trade.name_fr}</option>)}</select></label><label className="block text-xs font-medium">Gouvernorat<select value={governorateFilter} onChange={(event) => setGovernorateFilter(event.target.value)} className="mt-1.5 w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm"><option value="">Tous les gouvernorats</option>{governorates.map((item) => <option value={item.id} key={item.id}>{item.name_fr}</option>)}</select></label></div><label className="mt-3 block max-w-xs text-xs font-medium">Type de chantier<select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="mt-1.5 w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm"><option value="">Tous les types</option>{Object.entries(projectTypeLabel).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></Card>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {filtered.length === 0 ? <Card className="border-dashed text-center"><h2 className="font-semibold">Aucun DAO accessible</h2><p className="mt-2 text-sm text-black/55">Essayez un autre filtre ou revenez plus tard.</p></Card> : <div className="grid gap-4 lg:grid-cols-2">{filtered.map((row) => { const deadline = deadlineLabel(row.submission_deadline); return <Link key={row.id} href={`/app/artisan/publications/${row.id}`}><Card className="h-full transition hover:-translate-y-0.5 hover:shadow-md"><div className="flex flex-wrap items-start justify-between gap-3"><div><Badge>{visibilityLabel[row.visibility]}</Badge><h2 className="mt-3 text-lg font-semibold">{row.safe_title}</h2></div><Badge>{row.bidStatus ? 'Offre envoyée' : 'À répondre'}</Badge></div><p className="mt-2 line-clamp-2 text-sm text-black/60">{row.safe_description}</p><div className="mt-4 flex flex-wrap gap-2 text-xs text-black/50"><span>{projectTypeLabel[row.project_type]}</span>{row.surface_m2 && <span>· {row.surface_m2} m²</span>}{row.governorateName && <span>· {row.governorateName}</span>}</div><div className="mt-4 flex items-center justify-between border-t border-black/5 pt-3 text-xs"><span className={deadline.tone}>{deadline.label}</span><span>{formatTnd(row.indicative_budget_millimes)}</span></div>{row.tradeNames.length > 0 && <p className="mt-3 text-xs text-black/45">Métiers : {row.tradeNames.join(' · ')}</p>}</Card></Link>})}</div>}
  </section>;
}
