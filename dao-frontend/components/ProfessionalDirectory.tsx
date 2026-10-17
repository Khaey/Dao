'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, BadgeCheck, MapPin, Search, SlidersHorizontal, Users, X } from 'lucide-react';
import { Badge, Card, Input } from './ui';
import { Stars } from './reviews/ReviewStars';
import { formatRating } from '../lib/reviews';
import { professionalBlob, professionalRead, professionalStatus } from '../lib/professionals';
import { availabilityLabel, availabilityOf, availabilityTones, initials, monogramTone, professionalTypeNames as typeNames } from './professional-display';

type DirectoryRow = {
  id: string;
  name: string;
  city?: string | null;
  governorate?: string | null;
  areas?: string[] | null;
  trades?: string[] | null;
  contractor_type?: string | null;
  presentation?: string | null;
  years_experience?: number | null;
  availability?: string | null;
  available_from?: string | null;
  logo_id?: string | null;
  portfolio_count?: number | null;
  rating_average?: number | string | null; // absent until the reviews migration is deployed
  rating_count?: number | null;
  verification_status?: string | null;
  review_status?: string | null;
};

type Filters = { trade: string; zone: string; availability: string; type: string; rating: string };
type SortKey = 'recent' | 'rating' | 'experience' | 'portfolio' | 'name';

const noFilters: Filters = { trade: '', zone: '', availability: '', type: '', rating: '' };
const ratingFilters: Record<string, string> = { '4': '4 ★ et plus', '3': '3 ★ et plus' };
const availabilityFilters: Record<string, string> = {
  now: 'Disponible maintenant',
  soon: 'Disponible prochainement',
  to_discuss: 'À discuter',
};
const sortNames: Record<SortKey, string> = {
  recent: 'Plus récents',
  rating: 'Mieux notés',
  experience: 'Plus d’expérience',
  portfolio: 'Plus de réalisations',
  name: 'Nom (A → Z)',
};
const selectBase = 'min-h-11 rounded-xl border border-black/10 bg-white px-3 text-sm font-normal normal-case tracking-normal text-ink outline-none transition focus:border-teal focus:ring-4 focus:ring-teal/10';
const filterLabelClass = 'space-y-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-black/50';
const collator = new Intl.Collator('fr', { sensitivity: 'base' });

const list = (values?: string[] | null) => (Array.isArray(values) ? values.filter(Boolean) : []);
const normalize = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
// Logos are private files streamed through /api/professionals (access rechecked server-side):
// load them lazily, at most 4 at a time, once per page.
const logoCache = new Map<string, Promise<string>>();
const logoQueue: Array<() => void> = [];
let logoRunning = 0;

function loadLogo(id: string) {
  const cached = logoCache.get(id);
  if (cached) return cached;
  const promise = new Promise<string>((resolve, reject) => {
    const run = () => {
      logoRunning += 1;
      professionalBlob('professional', id)
        .then((blob) => {
          if (!blob.type.startsWith('image/')) throw new Error('Logo indisponible');
          resolve(URL.createObjectURL(blob));
        })
        .catch(reject)
        .finally(() => { logoRunning -= 1; logoQueue.shift()?.(); });
    };
    if (logoRunning < 4) run(); else logoQueue.push(run);
  });
  promise.catch(() => logoCache.delete(id));
  logoCache.set(id, promise);
  return promise;
}

function releaseLogos() {
  logoQueue.length = 0;
  logoCache.forEach((promise) => { void promise.then((url) => URL.revokeObjectURL(url), () => undefined); });
  logoCache.clear();
}

function DirectoryLogo({ id, logoId, name }: { id: string; logoId?: string | null; name: string }) {
  const holder = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState('');
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    setUrl('');
    setBroken(false);
    if (!logoId) return;
    let alive = true;
    const start = () => { void loadLogo(logoId).then((next) => { if (alive) setUrl(next); }, () => undefined); };
    if (typeof IntersectionObserver === 'undefined' || !holder.current) { start(); return () => { alive = false; }; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { observer.disconnect(); start(); }
    }, { rootMargin: '240px' });
    observer.observe(holder.current);
    return () => { alive = false; observer.disconnect(); };
  }, [logoId]);

  return <div ref={holder} aria-hidden="true"
    className={`flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-black/5 text-lg font-bold tracking-tight ${url && !broken ? 'bg-white' : monogramTone(id)}`}>
    {url && !broken ? <img src={url} alt="" onError={() => setBroken(true)} className="h-full w-full object-contain p-1.5" /> : initials(name)}
  </div>;
}

function AvailabilityPill({ row }: { row: DirectoryRow }) {
  const tone = availabilityTones[availabilityOf(row)];
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${tone.pill}`}>
    <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />{availabilityLabel(row)}
  </span>;
}

function ProfessionalCard({ row, href, review }: { row: DirectoryRow; href: string; review: boolean }) {
  const trades = list(row.trades);
  const areas = list(row.areas);
  const place = [row.city, row.governorate].filter((value, index, all) => value && all.indexOf(value) === index).join(', ');
  const otherZones = areas.filter((area) => area !== row.governorate && area !== row.city);
  const verified = row.verification_status === 'verified';
  const years = row.years_experience;
  const works = row.portfolio_count ?? 0;

  return <Link href={href}
    className="group block rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal">
    <Card className="flex h-full flex-col gap-4 transition duration-200 group-hover:-translate-y-0.5 group-hover:border-teal/25 group-hover:shadow-[0_14px_40px_rgba(23,32,42,0.08)] motion-reduce:transition-none motion-reduce:group-hover:translate-y-0">
      <div className="flex items-start gap-3.5">
        <DirectoryLogo id={row.id} logoId={row.logo_id} name={row.name} />
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="line-clamp-2 break-words font-bold leading-snug text-ink transition group-hover:text-teal">{row.name}</h2>
          <p className="text-xs font-medium text-black/50">{typeNames[row.contractor_type ?? ''] ?? 'Professionnel'}</p>
          {verified
            ? <p className="inline-flex items-center gap-1 text-xs font-semibold text-teal"><BadgeCheck aria-hidden="true" size={15} />Vérifié par D.A.O.</p>
            : <Badge tone={row.verification_status === 'suspended' ? 'red' : 'clay'}>
              {row.verification_status === 'suspended' ? 'Suspendu' : 'Vérification en attente / à corriger'}
            </Badge>}
          {row.rating_count != null && (row.rating_count > 0
            ? <p className="flex items-center gap-1.5 text-xs text-black/60"><Stars value={Number(row.rating_average ?? 0)} size={13} />
              <span className="font-semibold text-ink">{formatRating(row.rating_average)}</span>({row.rating_count} avis)</p>
            : <p className="text-xs font-medium text-black/45">Nouveau sur D.A.O.</p>)}
        </div>
      </div>

      <div className="flex items-start gap-1.5 text-sm text-black/60">
        <MapPin aria-hidden="true" size={16} className="mt-0.5 shrink-0 text-black/35" />
        <div className="min-w-0">
          <p>{place || (otherZones.length > 0 ? `Intervient à ${otherZones.slice(0, 2).join(', ')}` : 'Ville non renseignée')}</p>
          {place && otherZones.length > 0 && <p className="truncate text-xs text-black/45" title={otherZones.join(', ')}>Intervient aussi à {otherZones.join(', ')}</p>}
        </div>
      </div>

      {trades.length > 0 && <ul aria-label="Métiers" className="flex flex-wrap gap-1.5">
        {trades.slice(0, 3).map((trade) => <li key={trade} className="rounded-lg bg-sand px-2 py-1 text-xs font-medium text-ink">{trade}</li>)}
        {trades.length > 3 && <li className="rounded-lg px-1.5 py-1 text-xs font-medium text-black/50">+{trades.length - 3}</li>}
      </ul>}

      {row.presentation && <p className="line-clamp-2 text-sm leading-relaxed text-black/60">{row.presentation}</p>}

      <dl className="mt-auto grid grid-cols-2 gap-3 border-t border-black/5 pt-4">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/40">Expérience</dt>
          <dd className="mt-0.5 text-sm font-semibold text-ink">{years == null ? 'Non renseignée' : `${years} an${years > 1 ? 's' : ''}`}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/40">Réalisations</dt>
          <dd className="mt-0.5 text-sm font-semibold text-ink">{works > 0 ? `${works} publiée${works > 1 ? 's' : ''}` : 'Aucune pour l’instant'}</dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {review ? <Badge>{professionalStatus[row.review_status ?? ''] || 'Dossier à compléter'}</Badge> : <AvailabilityPill row={row} />}
        <span className="inline-flex items-center gap-1 text-sm font-semibold text-teal">
          {review ? 'Ouvrir le dossier' : 'Voir la fiche'}
          <ArrowRight aria-hidden="true" size={16} className="transition group-hover:translate-x-0.5 motion-reduce:transition-none" />
        </span>
      </div>
    </Card>
  </Link>;
}

function SkeletonCard() {
  return <div aria-hidden="true" className="rounded-2xl border border-black/5 bg-white p-5">
    <div className="flex gap-3.5"><div className="h-14 w-14 animate-pulse rounded-2xl bg-sand" />
      <div className="flex-1 space-y-2 pt-1"><div className="h-4 w-3/4 animate-pulse rounded bg-sand" /><div className="h-3 w-1/3 animate-pulse rounded bg-sand" /></div></div>
    <div className="mt-5 h-3 w-1/2 animate-pulse rounded bg-sand" />
    <div className="mt-4 flex gap-1.5"><div className="h-6 w-20 animate-pulse rounded-lg bg-sand" /><div className="h-6 w-16 animate-pulse rounded-lg bg-sand" /></div>
    <div className="mt-6 h-10 animate-pulse rounded-xl bg-sand/70" />
  </div>;
}

export default function ProfessionalDirectory({ review = false }: { review?: boolean }) {
  const [context, setContext] = useState('');
  const [rows, setRows] = useState<DirectoryRow[] | null>(null);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Filters>(noFilters);
  const [sort, setSort] = useState<SortKey>('recent');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (review) return;
    const params = new URLSearchParams(window.location.search);
    const projectId = params.get('project_id');
    const requestId = params.get('request_id');
    if (projectId && requestId && /^[0-9a-f-]{36}$/i.test(projectId) && /^[0-9a-f-]{36}$/i.test(requestId)) {
      setContext(`?project_id=${encodeURIComponent(projectId)}&request_id=${encodeURIComponent(requestId)}`);
    }
  }, [review]);

  useEffect(() => {
    let active = true;
    setRows(null);
    setError('');
    void professionalRead({ view: 'directory', review: String(review) })
      .then((result: DirectoryRow[]) => { if (active) setRows(Array.isArray(result) ? result : []); })
      .catch((exception: Error) => { if (active) setError(exception.message); });
    return () => { active = false; };
  }, [review]);

  useEffect(() => releaseLogos, []);

  const options = useMemo(() => {
    const trades = new Set<string>(), zones = new Set<string>(), types = new Set<string>();
    for (const row of rows ?? []) {
      list(row.trades).forEach((trade) => trades.add(trade));
      [row.governorate, ...list(row.areas)].forEach((zone) => { if (zone) zones.add(zone); });
      if (row.contractor_type && typeNames[row.contractor_type]) types.add(row.contractor_type);
    }
    return {
      trades: [...trades].sort(collator.compare),
      zones: [...zones].sort(collator.compare),
      types: Object.keys(typeNames).filter((type) => types.has(type)),
    };
  }, [rows]);

  const activeFilters = (Object.keys(filters) as Array<keyof Filters>).filter((key) => filters[key]);
  const searching = Boolean(query.trim()) || activeFilters.length > 0;

  const visible = useMemo(() => {
    const needle = normalize(query);
    const result = (rows ?? []).filter((row) => {
      if (needle && !normalize(`${row.name} ${row.city ?? ''} ${row.governorate ?? ''}`).includes(needle)) return false;
      if (filters.trade && !list(row.trades).includes(filters.trade)) return false;
      if (filters.zone && row.governorate !== filters.zone && !list(row.areas).includes(filters.zone)) return false;
      if (filters.availability && availabilityOf(row) !== filters.availability) return false;
      if (filters.type && row.contractor_type !== filters.type) return false;
      if (filters.rating && !((row.rating_count ?? 0) > 0 && Number(row.rating_average) >= Number(filters.rating))) return false;
      return true;
    });
    if (sort === 'experience') result.sort((a, b) => (b.years_experience ?? -1) - (a.years_experience ?? -1));
    if (sort === 'portfolio') result.sort((a, b) => (b.portfolio_count ?? 0) - (a.portfolio_count ?? 0));
    if (sort === 'name') result.sort((a, b) => collator.compare(a.name, b.name));
    if (sort === 'rating') result.sort((a, b) => ((b.rating_count ?? 0) > 0 ? Number(b.rating_average) : -1) - ((a.rating_count ?? 0) > 0 ? Number(a.rating_average) : -1)
      || (b.rating_count ?? 0) - (a.rating_count ?? 0));
    return result;
  }, [rows, query, filters, sort]);

  const setFilter = (key: keyof Filters, value: string) => setFilters((current) => ({ ...current, [key]: value }));
  const resetAll = () => { setQuery(''); setFilters(noFilters); };
  const filterLabel = (key: keyof Filters) => key === 'type' ? typeNames[filters.type] : key === 'availability' ? availabilityFilters[filters.availability]
    : key === 'rating' ? ratingFilters[filters.rating] : filters[key];
  const hasRatings = (rows ?? []).some((row) => row.rating_count != null);
  const sortKeys = (Object.keys(sortNames) as SortKey[]).filter((key) => key !== 'rating' || hasRatings);
  const total = rows?.length ?? 0;

  return <section className="mx-auto w-full max-w-6xl space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal">
          {review ? 'Gestion des dossiers' : 'Annuaire D.A.O'}
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-ink">
          {review ? 'Dossiers professionnels à contrôler' : 'Professionnels vérifiés'}
        </h1>
        <p className="max-w-2xl text-sm text-black/55">
          {review
            ? 'Contrôlez les informations déclarées, la visibilité et les médias avant publication.'
            : 'Comparez les professionnels vérifiés par D.A.O. : métiers, zones d’intervention, expérience et réalisations publiées.'}
        </p>
      </div>
      {rows && <span className="hidden sm:block"><Badge tone="neutral">{total} professionnel{total > 1 ? 's' : ''}</Badge></span>}
    </div>

    {context && <Card className="border-teal/10 bg-teal/5">
      <p className="text-sm text-teal">Sélectionnez une fiche pour ce lot. L’invitation se prépare depuis l’équipe du chantier après votre choix.</p>
    </Card>}

    <Card className="space-y-4 p-4 sm:p-6">
      <div className="space-y-2">
        <label htmlFor="professional-search" className="block text-sm font-semibold text-ink">Rechercher par nom ou ville</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search aria-hidden="true" size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-black/40" />
            <Input id="professional-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} className="min-h-11 pl-11" placeholder="Nom ou ville…" />
          </div>
          <button type="button" onClick={() => setFiltersOpen((open) => !open)} aria-expanded={filtersOpen} aria-controls="directory-filters"
            className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-black/10 bg-white px-3.5 text-sm font-semibold text-ink transition hover:border-teal hover:text-teal focus:outline-none focus:ring-4 focus:ring-teal/20 sm:hidden">
            <SlidersHorizontal aria-hidden="true" size={17} />Filtres{activeFilters.length > 0 && <span className="rounded-full bg-teal px-1.5 text-xs text-white">{activeFilters.length}</span>}
          </button>
        </div>
      </div>

      <div id="directory-filters" className={`${filtersOpen ? 'grid' : 'hidden'} gap-3 sm:grid sm:grid-cols-2 ${hasRatings ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
        <label className={filterLabelClass}>
          <span className="block">Métier</span>
          <select className={`${selectBase} w-full`} value={filters.trade} onChange={(event) => setFilter('trade', event.target.value)}>
            <option value="">Tous les métiers</option>
            {options.trades.map((trade) => <option key={trade} value={trade}>{trade}</option>)}
          </select>
        </label>
        <label className={filterLabelClass}>
          <span className="block">Zone d’intervention</span>
          <select className={`${selectBase} w-full`} value={filters.zone} onChange={(event) => setFilter('zone', event.target.value)}>
            <option value="">Tous les gouvernorats</option>
            {options.zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
          </select>
        </label>
        <label className={filterLabelClass}>
          <span className="block">Disponibilité</span>
          <select className={`${selectBase} w-full`} value={filters.availability} onChange={(event) => setFilter('availability', event.target.value)}>
            <option value="">Toutes</option>
            {Object.entries(availabilityFilters).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className={filterLabelClass}>
          <span className="block">Type de professionnel</span>
          <select className={`${selectBase} w-full`} value={filters.type} onChange={(event) => setFilter('type', event.target.value)}>
            <option value="">Tous les types</option>
            {options.types.map((type) => <option key={type} value={type}>{typeNames[type]}</option>)}
          </select>
        </label>
        {hasRatings && <label className={filterLabelClass}>
          <span className="block">Note</span>
          <select className={`${selectBase} w-full`} value={filters.rating} onChange={(event) => setFilter('rating', event.target.value)}>
            <option value="">Toutes les notes</option>
            {Object.entries(ratingFilters).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>}
      </div>

      {activeFilters.length > 0 && <div className="-my-1 flex flex-wrap items-center gap-x-2">
        {activeFilters.map((key) => <button key={key} type="button" onClick={() => setFilter(key, '')} aria-label={`Retirer le filtre ${filterLabel(key)}`}
          className="group/chip inline-flex min-h-11 items-center focus:outline-none">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-teal/10 py-1.5 pl-3 pr-2 text-xs font-semibold text-teal transition group-hover/chip:bg-teal/15 group-focus-visible/chip:ring-4 group-focus-visible/chip:ring-teal/20">{filterLabel(key)}<X aria-hidden="true" size={14} /></span>
        </button>)}
        <button type="button" onClick={() => setFilters(noFilters)} className="min-h-11 px-2 text-xs font-semibold text-black/55 underline-offset-4 hover:text-ink hover:underline">Effacer les filtres</button>
      </div>}
    </Card>

    {error && <Card className="border-red-200 bg-red-50"><p role="alert" className="text-sm text-red-700">{error}</p></Card>}
    {!rows && !error && <div className="space-y-3">
      <p role="status" className="text-sm text-black/55">Chargement des professionnels…</p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
    </div>}

    {rows && visible.length === 0 && <Card className="flex flex-col items-center gap-3 px-5 py-10 text-center sm:py-14">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-teal/10 text-teal"><Users aria-hidden="true" size={24} /></div>
      <h2 className="text-lg font-bold text-ink">{searching
        ? 'Aucun résultat pour votre recherche'
        : review ? 'Aucun dossier à contrôler pour le moment' : 'Aucun professionnel disponible pour le moment'}</h2>
      <p className="max-w-md text-sm text-black/55">{searching
        ? 'Essayez un autre nom ou une autre ville, ou retirez un filtre.'
        : review ? 'Les nouveaux dossiers apparaîtront ici dès leur soumission.' : 'Revenez prochainement pour découvrir les professionnels référencés sur D.A.O.'}</p>
      {searching && <button type="button" onClick={resetAll} className="mt-2 inline-flex min-h-11 items-center rounded-xl bg-ink px-4 text-sm font-semibold text-white transition hover:bg-teal focus:outline-none focus:ring-4 focus:ring-teal/20">Réinitialiser la recherche</button>}
      {!searching && !review && <Link href="/app/projects" className="mt-2 inline-flex min-h-11 items-center rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:border-teal hover:text-teal">Retour à mes chantiers</Link>}
    </Card>}

    {visible.length > 0 && <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-black/55" aria-live="polite">
          <span className="font-semibold text-ink">{visible.length}</span> {visible.length > 1 ? 'résultats' : 'résultat'}{searching && ` sur ${total}`}
        </p>
        <label className="flex items-center gap-2 text-sm text-black/55">
          <span>Trier</span>
          <select className={selectBase} value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
            {sortKeys.map((key) => <option key={key} value={key}>{sortNames[key]}</option>)}
          </select>
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((row) => <ProfessionalCard key={row.id} row={row} review={review}
          href={review ? `/app/dao/professionals/${row.id}/dossier` : `/app/professionals/${row.id}${context}`} />)}
      </div>
    </div>}
  </section>;
}
