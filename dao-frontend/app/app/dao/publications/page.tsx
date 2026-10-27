'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Filter, Megaphone, RefreshCw, Search } from 'lucide-react';
import { supabaseBrowser } from '../../../../lib/supabase-browser';
import { isDaoStaff, type AppRole } from '../../../../lib/roles';
import { redirectToLoginAfterExpiry } from '../../../../lib/session-return';
import { publicationStatusLabel, publicationVisibilityLabel } from '../../../../lib/utils';
import { Badge, Button, Card, Input } from '../../../../components/ui';
import { StaffHeader } from '../../../../components/backoffice/PageChrome';

type Publication = { id: string; safe_title: string; status: string; visibility: string; published_at: string; submission_deadline: string | null };
const formatDate = (value?: string | null) => value ? new Intl.DateTimeFormat('fr-TN', { dateStyle: 'medium' }).format(new Date(value)) : '—';

export default function DaoPublications() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Publication[] | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    const result = await supabaseBrowser().from('publications').select('id,safe_title,status,visibility,published_at,submission_deadline').order('published_at', { ascending: false });
    if (result.error) setError('Impossible de charger le registre des publications.');
    else setRows((result.data ?? []) as Publication[]);
  }, []);

  useEffect(() => { void (async () => {
    const supabase = supabaseBrowser();
    const { data: userResult } = await supabase.auth.getUser();
    // No valid session = expired session, not « Accès réservé »: reconnect and come back here.
    if (!userResult.user) { redirectToLoginAfterExpiry(); return; }
    const roleResult = await supabase.from('user_roles').select('role').eq('user_id', userResult.user.id);
    const roles = (roleResult.data ?? []).map(row => row.role as AppRole);
    if (!isDaoStaff(roles)) { setAllowed(false); return; }
    setAllowed(true);
    await load();
  })(); }, [load]);

  const filtered = useMemo(() => { const normalized = query.trim().toLocaleLowerCase('fr'); return (rows ?? []).filter(row => (!status || row.status === status) && (!normalized || [row.safe_title, row.status, publicationVisibilityLabel[row.visibility]].join(' ').toLocaleLowerCase('fr').includes(normalized))); }, [query, rows, status]);
  const active = Boolean(query.trim() || status);
  const reset = () => { setQuery(''); setStatus(''); };
  if (allowed === null) return <p role="status">Chargement du registre…</p>;
  if (!allowed) return <Card><h1 className="text-xl font-bold">Accès réservé</h1><p className="mt-2 text-sm text-black/60">Le registre Gestionnaire est réservé aux rôles D.A.O autorisés.</p></Card>;
  return <section className="space-y-5">
    <StaffHeader group="Dossiers" title="Publications D.A.O" crumb="Publications" description="Ouvrez une publication pour consulter les offres et gérer ses lots selon vos droits." />
    <Card className="p-3" role="search"><div className="flex flex-col gap-3 md:flex-row"><div className="relative flex-1"><Search size={17} className="absolute left-3 top-3.5 text-black/35" /><Input aria-label="Rechercher une publication" className="pl-10" placeholder="Rechercher par titre, visibilité ou statut…" value={query} onChange={event => setQuery(event.target.value)} /></div><div className="relative md:w-56"><Filter size={16} className="absolute left-3 top-3.5 text-black/35" /><select aria-label="Filtrer les publications" className="w-full rounded-xl border border-black/10 bg-white px-9 py-3 text-sm" value={status} onChange={event => setStatus(event.target.value)}><option value="">Tous les statuts</option>{['published', 'suspended', 'closed', 'superseded'].map(value => <option key={value} value={value}>{publicationStatusLabel[value] ?? value}</option>)}</select></div></div></Card>
    <div className="flex min-h-6 flex-wrap items-center justify-between gap-2 text-sm text-black/55" aria-live="polite">
      <span>{rows === null ? (error ? '' : 'Chargement…') : `${filtered.length} publication${filtered.length > 1 ? 's' : ''}${active ? ' correspondant aux filtres' : ''}`}</span>
      {active && <button type="button" onClick={reset} className="min-h-11 font-semibold text-teal hover:underline">Réinitialiser les filtres</button>}
    </div>
    {error ? <Card className="space-y-3"><p role="alert" className="text-sm font-semibold text-red-700">{error}</p><Button type="button" className="gap-2 bg-white text-ink ring-1 ring-black/10 hover:bg-sand" onClick={() => void load()}><RefreshCw aria-hidden="true" size={16} />Réessayer</Button></Card>
      : rows === null ? <div aria-busy="true" className="space-y-2">{[0, 1, 2].map(key => <div key={key} className="h-16 animate-pulse rounded-2xl bg-black/5" />)}</div>
      : filtered.length === 0 ? <Card className="flex items-start gap-3 border-dashed"><Megaphone aria-hidden="true" size={20} className="mt-0.5 shrink-0 text-black/35" /><div><p className="text-sm font-semibold text-ink">{active ? 'Aucune publication ne correspond à ces critères.' : 'Aucune publication pour le moment.'}</p>{active && <button type="button" onClick={reset} className="mt-1 min-h-11 text-sm font-semibold text-teal hover:underline">Réinitialiser les filtres</button>}</div></Card>
      : <Card className="overflow-hidden p-0">
        <table className="hidden w-full text-left text-[13px] md:table">
          <thead className="bg-sand/60 text-xs font-semibold uppercase tracking-[0.08em] text-black/45"><tr><th scope="col" className="px-3 py-2">Publication</th><th scope="col" className="px-3 py-2">Visibilité</th><th scope="col" className="px-3 py-2">Publiée le</th><th scope="col" className="px-3 py-2">Limite des offres</th><th scope="col" className="px-3 py-2">Statut</th><th scope="col" className="px-3 py-2"><span className="sr-only">Action</span></th></tr></thead>
          <tbody className="divide-y divide-black/5">{filtered.map(publication => <tr key={publication.id} className="hover:bg-sand/40">
            <td className="max-w-xs px-3 py-2"><Link href={`/app/publications/${publication.id}`} className="block truncate font-semibold text-ink hover:text-teal hover:underline">{publication.safe_title}</Link></td>
            <td className="px-3 py-2 text-black/65">{publicationVisibilityLabel[publication.visibility] ?? publication.visibility}</td>
            <td className="px-3 py-2 tabular-nums text-black/65">{formatDate(publication.published_at)}</td>
            <td className="px-3 py-2 tabular-nums text-black/65">{formatDate(publication.submission_deadline)}</td>
            <td className="px-3 py-2"><Badge tone={publication.status === 'published' ? 'teal' : 'neutral'}>{publicationStatusLabel[publication.status] ?? publication.status}</Badge></td>
            <td className="px-3 py-2 text-right"><Link href={`/app/publications/${publication.id}`} aria-label={`Ouvrir ${publication.safe_title}`} className="inline-flex min-h-8 min-w-8 items-center justify-end text-teal"><ArrowRight aria-hidden="true" size={16} /></Link></td>
          </tr>)}</tbody>
        </table>
        <ul className="divide-y divide-black/5 md:hidden">{filtered.map(publication => <li key={publication.id}><Link href={`/app/publications/${publication.id}`} className="block p-4 hover:bg-sand/40">
          <span className="flex items-start justify-between gap-3"><span className="min-w-0 break-words font-semibold">{publication.safe_title}</span><Badge tone={publication.status === 'published' ? 'teal' : 'neutral'}>{publicationStatusLabel[publication.status] ?? publication.status}</Badge></span>
          <span className="mt-2 block text-xs text-black/50">{publicationVisibilityLabel[publication.visibility] ?? publication.visibility} · publiée le {formatDate(publication.published_at)} · limite {formatDate(publication.submission_deadline)}</span>
        </Link></li>)}</ul>
      </Card>}
  </section>;
}
