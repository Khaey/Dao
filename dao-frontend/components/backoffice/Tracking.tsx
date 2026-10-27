'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowRight, RefreshCw, Search } from 'lucide-react';
import { Badge, Button, Card, Input } from '../ui';
import { displayProjectStatus, statusLabel } from '../../lib/utils';
import { readAllBackoffice } from '../../lib/backoffice';
import { StaffHeader } from './PageChrome';

// Published or closed chantiers assigned to the current reviewer. Native tracking
// deliberately does not treat the global Admin role as a project assignment.
const tracked = (status: string) => status === 'open' || status === 'closed';

export default function Tracking() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true; setLoading(true); setError('');
    void readAllBackoffice('projects', { mine: 'true' })
      .then(all => { if (active) setRows(all.filter((p: any) => p.can_manage && tracked(p.status))); })
      .catch(e => { if (active) { setError((e as Error).message || 'Chantiers indisponibles.'); setRows(null); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter((p: any) => !q || `${p.version?.title ?? ''} ${p.client_name ?? ''}`.toLowerCase().includes(q));
  }, [rows, query]);

  return <section className="space-y-5">
    <StaffHeader group="Dossiers" title="Suivi terrain" description="Avancement, contrôles techniques et réserves des chantiers publiés dont vous suivez le dossier. Les décisions restent au Client et à l’Artisan." />

    <Card className="p-4" role="search">
      <label className="relative block"><span className="sr-only">Rechercher un chantier suivi</span><Search aria-hidden="true" size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-black/35" />
        <Input className="pl-10" aria-label="Rechercher un chantier suivi" placeholder="Titre ou client" value={query} onChange={e => setQuery(e.target.value)} /></label>
    </Card>

    <p className="min-h-6 text-sm text-black/55" aria-live="polite">{loading ? 'Chargement…' : error ? '' : `${visible.length} chantier${visible.length > 1 ? 's' : ''} suivi${visible.length > 1 ? 's' : ''}`}</p>

    {error && <Card className="space-y-3"><p role="alert" className="text-sm font-semibold text-red-700">{error}</p><Button type="button" className="gap-2 bg-white text-ink ring-1 ring-black/10 hover:bg-sand" onClick={() => setAttempt(n => n + 1)}><RefreshCw aria-hidden="true" size={16} />Réessayer</Button></Card>}
    {loading && !rows ? <div aria-busy="true" className="grid gap-3 md:grid-cols-2">{[0, 1].map(key => <div key={key} className="h-32 animate-pulse rounded-2xl bg-black/5" />)}</div>
      : !error && visible.length === 0 ? <Card className="flex items-start gap-3 border-dashed"><Activity aria-hidden="true" size={20} className="mt-0.5 shrink-0 text-black/35" /><div><p className="text-sm font-semibold text-ink">{query ? 'Aucun chantier suivi ne correspond à cette recherche.' : 'Aucun chantier publié ne vous est attribué.'}</p><p className="mt-1 text-sm text-black/55">Un chantier apparaît ici une fois publié, si vous avez pris en charge sa revue.</p></div></Card>
      : <ul className="grid gap-3 md:grid-cols-2">{visible.map((p: any) => <li key={p.id}><Link href={`/app/native-execution/${p.id}?from=dao`} className="group block h-full rounded-2xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal/20"><Card className="flex h-full flex-col gap-3 transition group-hover:border-teal/40">
        <div className="flex flex-wrap items-start justify-between gap-2"><h2 className="min-w-0 flex-1 break-words text-lg font-bold leading-snug text-ink">{p.version?.title}</h2><Badge tone={p.status === 'open' ? 'teal' : 'neutral'}>{statusLabel[displayProjectStatus(p.status)] || p.status}</Badge></div>
        <p className="text-sm text-black/60">Client : <span className="font-medium text-ink">{p.client_name || 'Non affecté'}</span></p>
        <span className="mt-auto inline-flex items-center gap-1 border-t border-black/5 pt-3 text-sm font-semibold text-teal">Ouvrir le suivi et les réserves<ArrowRight aria-hidden="true" size={15} className="transition group-hover:translate-x-0.5" /></span>
      </Card></Link></li>)}</ul>}
  </section>;
}
