'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Filter, Search } from 'lucide-react';
import { supabaseBrowser } from '../../../../lib/supabase-browser';
import { isDaoStaff, type AppRole } from '../../../../lib/roles';
import { statusLabel } from '../../../../lib/utils';
import { Badge, Card, Input } from '../../../../components/ui';

type Publication = { id: string; safe_title: string; status: string; visibility: string; published_at: string; submission_deadline: string | null };
const visibilityLabel: Record<string, string> = { public: 'Public', targeted: 'Ciblé', invite_only: 'DAO sur invitation' };
const formatDate = (value?: string | null) => value ? new Intl.DateTimeFormat('fr-TN', { dateStyle: 'medium' }).format(new Date(value)) : '—';

export default function DaoPublications() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Publication[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { void (async () => {
    const supabase = supabaseBrowser();
    const { data: userResult } = await supabase.auth.getUser();
    if (!userResult.user) { setAllowed(false); return; }
    const roleResult = await supabase.from('user_roles').select('role').eq('user_id', userResult.user.id);
    const roles = (roleResult.data ?? []).map(row => row.role as AppRole);
    if (!isDaoStaff(roles)) { setAllowed(false); return; }
    setAllowed(true);
    const result = await supabase.from('publications').select('id,safe_title,status,visibility,published_at,submission_deadline').order('published_at', { ascending: false });
    if (result.error) setError('Impossible de charger le registre des publications.');
    else setRows((result.data ?? []) as Publication[]);
  })(); }, []);

  const filtered = useMemo(() => { const normalized = query.trim().toLocaleLowerCase('fr'); return rows.filter(row => (!status || row.status === status) && (!normalized || [row.safe_title, row.status, visibilityLabel[row.visibility]].join(' ').toLocaleLowerCase('fr').includes(normalized))); }, [query, rows, status]);
  if (allowed === null) return <p role="status">Chargement du registre…</p>;
  if (!allowed) return <Card><h1 className="text-xl font-bold">Accès réservé</h1><p className="mt-2 text-sm text-black/60">Le registre Gestionnaire est réservé aux rôles D.A.O autorisés.</p></Card>;
  return <section className="space-y-6"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-teal">Back-office Gestionnaire</p><h1 className="mt-2 text-3xl font-bold tracking-tight">Publications D.A.O</h1><p className="mt-2 text-sm text-black/55">Ouvrez une publication pour consulter les offres et gérer ses lots selon vos droits.</p></div>
    <Card className="p-3"><div className="flex flex-col gap-3 md:flex-row"><div className="relative flex-1"><Search size={17} className="absolute left-3 top-3.5 text-black/35" /><Input aria-label="Rechercher une publication" className="pl-10" placeholder="Rechercher par titre, visibilité ou statut…" value={query} onChange={event => setQuery(event.target.value)} /></div><div className="relative md:w-56"><Filter size={16} className="absolute left-3 top-3.5 text-black/35" /><select aria-label="Filtrer les publications" className="w-full rounded-xl border border-black/10 bg-white px-9 py-3 text-sm" value={status} onChange={event => setStatus(event.target.value)}><option value="">Tous les statuts</option>{['published', 'suspended', 'closed', 'superseded'].map(value => <option key={value} value={value}>{statusLabel[value] ?? value}</option>)}</select></div></div></Card>
    {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
    {filtered.length === 0 ? <Card>Aucune publication ne correspond à ces critères.</Card> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{filtered.map(publication => <Link key={publication.id} href={`/app/publications/${publication.id}`}><Card className="h-full transition hover:-translate-y-0.5 hover:border-teal/30"><div className="flex items-start justify-between gap-3"><h2 className="min-w-0 truncate font-bold">{publication.safe_title}</h2><Badge tone={publication.status === 'published' ? 'teal' : 'neutral'}>{statusLabel[publication.status] ?? publication.status}</Badge></div><p className="mt-4 text-sm font-medium">{visibilityLabel[publication.visibility] ?? publication.visibility}</p><dl className="mt-4 grid grid-cols-2 gap-3 border-t border-black/5 pt-4 text-xs"><div><dt className="text-black/40">Publication</dt><dd className="mt-1 font-semibold">{formatDate(publication.published_at)}</dd></div><div><dt className="text-black/40">Limite offres</dt><dd className="mt-1 font-semibold">{formatDate(publication.submission_deadline)}</dd></div></dl></Card></Link>)}</div>}
  </section>;
}
