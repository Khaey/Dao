'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, FolderSearch, Lock, RefreshCw, Search } from 'lucide-react';
import { Badge, Card, Input, Button } from '../ui';
import { effectiveProjectStatus, statusLabel } from '../../lib/utils';
import { readAllBackoffice } from '../../lib/backoffice';
import { supabaseBrowser } from '../../lib/supabase-browser';
import { AssignmentBadge, assignmentOf, pendingReview, rememberList } from './assignment';
import { StaffHeader } from './PageChrome';

type Filters = { q: string; status: string; mine: boolean; ready: boolean };
const PAGE = 100;
const statuses = ['draft', 'client_review', 'dao_review', 'approved', 'rejected', 'archived'];
const tone = (status: string) => status === 'rejected' ? 'red' : status === 'approved' ? 'teal' : pendingReview(status) ? 'clay' : 'neutral';
const selectClass = 'min-h-11 w-full rounded-xl border border-black/10 bg-white px-3 text-sm text-ink outline-none transition focus:border-teal focus:ring-4 focus:ring-teal/10';
const check = 'flex min-h-11 items-center gap-2 rounded-xl border border-black/10 bg-white px-3 text-sm font-medium text-ink has-[:checked]:border-teal has-[:checked]:bg-teal/[0.06]';

function toQuery(filters: Filters) {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.status) params.set('status', filters.status);
  if (filters.mine) params.set('mine', 'true');
  if (filters.ready) params.set('publishable', 'true');
  const query = params.toString();
  return `/app/dao/projects${query ? `?${query}` : ''}`;
}

export default function Projects() {
  const [filters, setFilters] = useState<Filters>({ q: '', status: '', mine: false, ready: false });
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<any[] | null>(null);
  const [offset, setOffset] = useState(0);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q') || '';
    setFilters({ q, status: params.get('status') || '', mine: params.get('mine') === 'true', ready: params.get('publishable') === 'true' });
    setQuery(q); setInitialized(true);
    void supabaseBrowser().auth.getUser().then(({ data }) => setViewerId(data.user?.id ?? null));
  }, []);
  // Debounce the free-text search; other filters apply at once.
  useEffect(() => { const timer = setTimeout(() => setFilters(current => current.q === query ? current : { ...current, q: query }), 300); return () => clearTimeout(timer); }, [query]);
  // The URL carries the filters so « retour » from a dossier restores the same list.
  useEffect(() => {
    if (!initialized) return;
    const href = toQuery(filters);
    try { if (window.location.pathname + window.location.search !== href) window.history.replaceState(window.history.state, '', href); } catch { /* history unavailable */ }
    rememberList(href);
  }, [filters, initialized]);
  useEffect(() => {
    if (!initialized) return;
    let active = true; setLoading(true); setError(''); setOffset(0);
    void readAllBackoffice('projects', { q: filters.q, mine: String(filters.mine) })
      .then(all => { if (active) setRows(all.map((p: any) => ({ ...p, version: { ...p.version, status: effectiveProjectStatus(p.status, p.version.status) } }))); })
      .catch(e => { if (active) { setError((e as Error).message || 'Chantiers indisponibles.'); setRows(null); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filters.q, filters.mine, initialized, attempt]);

  const filtered = useMemo(() => (rows ?? []).filter((p: any) => (!filters.status || p.version.status === filters.status) && (!filters.ready || (p.version.status === 'approved' && Number(p.publishable_lots) > 0))), [rows, filters.status, filters.ready]);
  const visible = filtered.slice(offset, offset + PAGE);
  const active = Boolean(filters.q || filters.status || filters.mine || filters.ready);
  const update = (next: Partial<Filters>) => { setFilters(current => ({ ...current, ...next })); setOffset(0); };
  const reset = () => { setQuery(''); setFilters({ q: '', status: '', mine: false, ready: false }); setOffset(0); };

  return <section className="space-y-5">
    <StaffHeader group="Dossiers" title="Chantiers" description="Tous les chantiers et leur suivi D.A.O. Vous gérez les dossiers qui vous sont attribués ; les autres s’ouvrent en lecture seule." />

    <Card className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_14rem_auto_auto]" role="search">
      <label className="relative block sm:col-span-2 lg:col-span-1"><span className="sr-only">Rechercher un chantier</span><Search aria-hidden="true" size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-black/35" />
        <Input className="pl-10" aria-label="Rechercher un chantier" placeholder="Titre ou client" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <select aria-label="État du chantier" className={selectClass} value={filters.status} onChange={e => update({ status: e.target.value })}><option value="">Tous les états</option>{statuses.map(s => <option key={s} value={s}>{statusLabel[s] || s}</option>)}</select>
      <label className={check}><input type="checkbox" className="h-4 w-4 accent-teal" checked={filters.mine} onChange={e => update({ mine: e.target.checked })} />Mes revues</label>
      <label className={check}><input type="checkbox" className="h-4 w-4 accent-teal" checked={filters.ready} onChange={e => update({ ready: e.target.checked })} />Prêts à publier uniquement</label>
    </Card>

    <div className="flex min-h-6 flex-wrap items-center justify-between gap-2 text-sm text-black/55" aria-live="polite">
      <span>{loading ? 'Chargement…' : error ? '' : `${filtered.length} chantier${filtered.length > 1 ? 's' : ''}${active ? ' correspondant aux filtres' : ''}`}</span>
      {active && <button type="button" onClick={reset} className="min-h-11 font-semibold text-teal hover:underline">Réinitialiser les filtres</button>}
    </div>

    {error && <Card className="space-y-3"><p role="alert" className="text-sm font-semibold text-red-700">{error}</p><Button type="button" className="gap-2 bg-white text-ink ring-1 ring-black/10 hover:bg-sand" onClick={() => setAttempt(n => n + 1)}><RefreshCw aria-hidden="true" size={16} />Réessayer</Button></Card>}
    {loading && !rows ? <div aria-busy="true" className="grid gap-3 md:grid-cols-2">{[0, 1, 2, 3].map(key => <div key={key} className="h-40 animate-pulse rounded-2xl bg-black/5" />)}</div>
      : !error && filtered.length === 0 ? <Card className="flex items-start gap-3 border-dashed"><FolderSearch aria-hidden="true" size={20} className="mt-0.5 shrink-0 text-black/35" /><div><p className="text-sm font-semibold text-ink">{filters.mine ? 'Aucun chantier ne vous est attribué avec ces filtres.' : active ? 'Aucun chantier ne correspond à ces filtres.' : 'Aucun chantier.'}</p>{active && <button type="button" onClick={reset} className="mt-1 min-h-11 text-sm font-semibold text-teal hover:underline">Réinitialiser les filtres</button>}</div></Card>
      : <ul className={`grid gap-3 md:grid-cols-2 ${loading ? 'opacity-60' : ''}`}>{visible.map((p: any) => {
        const state = assignmentOf(p.reviewer_id, viewerId), pending = pendingReview(p.version.status);
        return <li key={p.id}><Link href={`/app/dao/projects/${p.id}`} className="group block h-full rounded-2xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal/20"><Card className="flex h-full flex-col gap-3 transition group-hover:border-teal/40">
          <div className="flex flex-wrap items-start justify-between gap-2"><h2 className="min-w-0 flex-1 break-words text-lg font-bold leading-snug text-ink">{p.version.title}</h2><Badge tone={tone(p.version.status)}>{statusLabel[p.version.status] || p.version.status}</Badge></div>
          <dl className="grid gap-1 text-sm text-black/60"><div className="flex gap-1.5"><dt>Client :</dt><dd className="min-w-0 truncate font-medium text-ink">{p.client_name || 'Non affecté'}</dd></div><div className="flex gap-1.5"><dt>Version</dt><dd className="font-medium text-ink">{p.version.version_no}</dd></div></dl>
          <p className="text-sm text-black/60">Pris en charge par : {p.reviewer_name || 'À prendre en charge'}</p>
          <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-black/5 pt-3">
            {p.reviewer_id || pending ? <AssignmentBadge state={state} name={p.reviewer_name} /> : <span />}
            <span className="inline-flex items-center gap-1 text-sm font-semibold text-teal">{p.can_manage ? 'Ouvrir et gérer le dossier' : <><Lock aria-hidden="true" size={14} />Ouvrir en lecture seule</>}<ArrowRight aria-hidden="true" size={15} className="transition group-hover:translate-x-0.5" /></span>
          </div>
        </Card></Link></li>;
      })}</ul>}
    {filtered.length > PAGE && <div className="flex items-center justify-between gap-3"><Button type="button" disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Précédent</Button><span className="text-sm text-black/50">{offset + 1}–{Math.min(offset + PAGE, filtered.length)} sur {filtered.length}</span><Button type="button" disabled={loading || offset + PAGE >= filtered.length} onClick={() => setOffset(offset + PAGE)}>Suivant</Button></div>}
  </section>;
}
