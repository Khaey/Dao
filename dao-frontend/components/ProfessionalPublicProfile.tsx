'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  AlertCircle, ArrowLeft, BadgeCheck, Expand, FileDown, Globe, ImageOff, Info, Link2, Mail, MapPin, MessageCircle, Phone, ShieldCheck, X,
} from 'lucide-react';
import { Card } from './ui';
import { professionalBlob, professionalRead } from '../lib/professionals';
import {
  availabilityLabel, availabilityOf, availabilityTones, initials, monogramTone, plural, professionalTypeNames,
} from './professional-display';

type Asset = {
  id: string; caption?: string | null; mime_type: string; asset_kind?: string | null; original_name?: string | null;
  status?: string | null; public_consent?: boolean | null; // owner/staff preview only
};
type PortfolioProject = {
  id: string; title: string; description?: string | null; completed_year?: number | null;
  approximate_location?: string | null; trade?: string | null; assets?: Asset[] | null;
  status?: string | null; publication_consent?: boolean | null; // owner/staff preview only
};
type Profile = {
  id: string; name: string; contractor_type?: string | null; presentation?: string | null; verification_status?: string | null;
  preview?: boolean; years_experience?: number | null; availability?: string | null; available_from?: string | null;
  city?: string | null; governorate?: string | null; founded_year?: number | null; specialties?: string | null;
  office_address?: string | null; website_url?: string | null; professional_phone?: string | null; professional_email?: string | null;
  whatsapp_phone?: string | null; social_links?: string[] | null; trades?: string[] | null;
  areas?: Array<{ governorate: string; delegation?: string | null }> | null; logo_id?: string | null; portfolio?: PortfolioProject[] | null;
  logo_status?: string | null; logo_public_consent?: boolean | null; // owner/staff preview only
};

const assetKinds: Record<string, string> = { before: 'Avant', after: 'Après', brochure: 'Brochure PDF' };
const previewFileStates: Record<string, string> = { ready: 'À contrôler', approved: 'Approuvé', rejected: 'Refusé' };
const previewProjectStates: Record<string, string> = { draft: 'Brouillon', pending_review: 'En revue', published: 'Publié', hidden: 'Masqué' };

/** Moderation state shown only in the owner/staff preview, and only when the server returns it. */
function PreviewState({ label, status, consent, states }: { label: string; status?: string | null; consent?: boolean | null; states: Record<string, string> }) {
  if (!status) return null;
  return <p className="text-xs font-medium text-clay">
    {label} : {states[status] || status}{typeof consent === 'boolean' && (consent ? ' · Consentement accordé' : ' · Consentement non accordé')}
  </p>;
}
const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

// Media are private files streamed through /api/professionals with access rechecked on every call:
// load them a few at a time and release each object URL when its tile unmounts.
const mediaQueue: Array<() => void> = [];
let mediaRunning = 0;
function queued<T>(task: () => Promise<T>) {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      mediaRunning += 1;
      task().then(resolve, reject).finally(() => { mediaRunning -= 1; mediaQueue.shift()?.(); });
    };
    if (mediaRunning < 3) run(); else mediaQueue.push(run);
  });
}

function useMediaUrl(kind: 'professional' | 'portfolio', id: string | null | undefined, enabled = true) {
  const [state, setState] = useState<{ url: string; failed: boolean }>({ url: '', failed: false });
  useEffect(() => {
    setState({ url: '', failed: false });
    if (!id || !enabled) return;
    let alive = true, created = '';
    void queued(() => professionalBlob(kind, id)).then((blob) => {
      if (!blob.type.startsWith('image/')) throw new Error('Média indisponible');
      created = URL.createObjectURL(blob);
      if (alive) setState({ url: created, failed: false }); else URL.revokeObjectURL(created);
    }).catch(() => { if (alive) setState({ url: '', failed: true }); });
    return () => { alive = false; if (created) URL.revokeObjectURL(created); };
  }, [kind, id, enabled]);
  return state;
}

function ProfileLogo({ profile }: { profile: Profile }) {
  const { url, failed } = useMediaUrl('professional', profile.logo_id);
  const [broken, setBroken] = useState(false);
  const show = url && !failed && !broken;
  return <div
    className={`flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-3xl border-4 border-white text-2xl font-bold tracking-tight shadow-[0_8px_24px_rgba(23,32,42,0.10)] sm:h-24 sm:w-24 sm:text-3xl ${show ? 'bg-white' : monogramTone(profile.id)}`}>
    {show ? <img src={url} alt={`Logo de ${profile.name}`} onError={() => setBroken(true)} className="h-full w-full object-contain p-2" />
      : <span aria-hidden="true">{initials(profile.name)}</span>}
  </div>;
}

function Lightbox({ url, alt, onClose }: { url: string; alt: string; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; previous?.focus(); };
  }, [onClose]);
  return <div role="dialog" aria-modal="true" aria-label={`Média : ${alt}`} onClick={onClose}
    className="fixed inset-0 z-50 flex items-center justify-center bg-ink/85 p-4 backdrop-blur-sm">
    <button ref={close} type="button" onClick={onClose} aria-label="Fermer"
      className="absolute right-3 top-3 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus:outline-none focus:ring-4 focus:ring-white/30">
      <X aria-hidden="true" size={22} />
    </button>
    <img src={url} alt="" onClick={(event) => event.stopPropagation()} className="max-h-[85vh] max-w-full rounded-2xl object-contain shadow-2xl" />
  </div>;
}

function MediaTile({ asset, preview }: { asset: Asset; preview: boolean }) {
  const pdf = asset.mime_type === 'application/pdf';
  const alt = asset.caption || asset.original_name || 'Média professionnel';
  const label = assetKinds[asset.asset_kind ?? ''] ?? 'Photo';
  const { url, failed } = useMediaUrl('portfolio', asset.id, !pdf);
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  async function download() {
    setDownloading(true); setError('');
    try {
      const blob = await professionalBlob('portfolio', asset.id);
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href; anchor.download = asset.original_name || 'document.pdf'; anchor.click();
      URL.revokeObjectURL(href);
    } catch (exception) { setError((exception as Error).message); } finally { setDownloading(false); }
  }

  if (pdf) return <figure className="flex flex-col justify-between gap-3 rounded-2xl border border-black/5 bg-sand/60 p-4">
    <div className="space-y-2">
      <span className="inline-flex rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-ink">{label}</span>
      {asset.caption && <figcaption className="text-sm text-black/60">{asset.caption}</figcaption>}
      {preview && <PreviewState label="Média" status={asset.status} consent={asset.public_consent} states={previewFileStates} />}
    </div>
    <button type="button" onClick={() => void download()} disabled={downloading}
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-3 text-sm font-semibold text-ink transition hover:text-teal focus:outline-none focus:ring-4 focus:ring-teal/20 disabled:opacity-60">
      <FileDown aria-hidden="true" size={17} className="shrink-0" /><span className="truncate">{downloading ? 'Téléchargement…' : `Télécharger ${asset.original_name || 'la brochure'}`}</span>
    </button>
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
  </figure>;

  return <figure className="space-y-2">
    <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-sand">
      {url && <img src={url} alt={alt} onClick={() => setOpen(true)} className="h-full w-full cursor-zoom-in object-cover transition duration-300 hover:scale-[1.02] motion-reduce:transition-none" />}
      {!url && !failed && <div aria-hidden="true" className="h-full w-full animate-pulse bg-sand" />}
      {failed && <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-black/40">
        <ImageOff aria-hidden="true" size={22} /><span className="text-xs">Média indisponible</span>
      </div>}
      <span className="pointer-events-none absolute left-2.5 top-2.5 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold text-ink shadow-sm">{label}</span>
      {url && <button type="button" onClick={() => setOpen(true)} aria-label={`Agrandir ${alt}`}
        className="absolute bottom-2 right-2 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-ink shadow-sm transition hover:text-teal focus:outline-none focus:ring-4 focus:ring-teal/30">
        <Expand aria-hidden="true" size={17} />
      </button>}
    </div>
    {asset.caption && <figcaption className="text-sm text-black/60">{asset.caption}</figcaption>}
    {preview && <PreviewState label="Média" status={asset.status} consent={asset.public_consent} states={previewFileStates} />}
    {open && url && <Lightbox url={url} alt={alt} onClose={() => setOpen(false)} />}
  </figure>;
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="min-w-0 rounded-2xl bg-sand/60 px-4 py-3">
    <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">{label}</dt>
    <dd className="mt-1 break-words text-sm font-semibold text-ink">{value}</dd>
  </div>;
}

function ContactRow({ href, icon, children, external = false }: { href: string; icon: React.ReactNode; children: React.ReactNode; external?: boolean }) {
  return <li>
    <a href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold text-ink transition hover:bg-teal/5 hover:text-teal focus:outline-none focus:ring-4 focus:ring-teal/20">
      <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal/10 text-teal">{icon}</span>
      <span className="min-w-0 break-all">{children}</span>
    </a>
  </li>;
}

function ProfileSkeleton() {
  return <div aria-hidden="true" className="space-y-6">
    <div className="overflow-hidden rounded-2xl border border-black/5 bg-white">
      <div className="h-24 animate-pulse bg-sand sm:h-32" />
      <div className="space-y-3 p-6"><div className="h-20 w-20 animate-pulse rounded-3xl bg-sand" /><div className="h-7 w-1/2 animate-pulse rounded bg-sand" /><div className="h-4 w-1/3 animate-pulse rounded bg-sand" /></div>
    </div>
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]"><div className="h-64 animate-pulse rounded-2xl bg-white" /><div className="h-64 animate-pulse rounded-2xl bg-white" /></div>
  </div>;
}

export default function ProfessionalPublicProfile({ id, previewOverride }: { id: string; previewOverride?: boolean }) {
  const params = useSearchParams();
  const preview = previewOverride ?? (params.get('preview') === 'true');
  const projectId = params.get('project_id');
  const requestId = params.get('request_id');
  const projectContext = projectId && requestId && /^[0-9a-f-]{36}$/i.test(projectId) && /^[0-9a-f-]{36}$/i.test(requestId)
    ? `/app/projects/${encodeURIComponent(projectId)}?tab=team&request_id=${encodeURIComponent(requestId)}` : null;
  const directoryContext = projectContext ? `/app/professionals?project_id=${encodeURIComponent(projectId!)}&request_id=${encodeURIComponent(requestId!)}` : '/app/professionals';
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setProfile(null); setError('');
    void professionalRead({ view: 'public', id, preview: String(preview) })
      .then((next: Profile) => { if (active) setProfile(next); })
      .catch((exception: Error) => { if (active) setError(exception.message); });
    return () => { active = false; };
  }, [id, preview]);

  const backLink = <Link href={directoryContext}
    className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-black/60 transition hover:text-teal">
    <ArrowLeft aria-hidden="true" size={16} />Retour aux professionnels
  </Link>;

  if (!profile) {
    if (!error) return <section className="mx-auto w-full max-w-6xl space-y-4">
      <p role="status" className="text-sm text-black/55">Chargement de la fiche…</p>
      <ProfileSkeleton />
    </section>;
    return <section className="mx-auto w-full max-w-6xl">
      <Card className="flex flex-col items-center gap-3 px-5 py-10 text-center sm:py-14">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-clay/10 text-clay"><AlertCircle aria-hidden="true" size={24} /></div>
        <p role="alert" className="max-w-md text-base font-semibold text-ink">{error}</p>
        <p className="max-w-md text-sm text-black/55">Cette fiche n’est pas accessible. Elle n’est peut-être pas encore publiée par D.A.O.</p>
        {backLink}
      </Card>
    </section>;
  }

  const showPreview = Boolean(profile.preview);
  const verified = profile.verification_status === 'verified';
  const trades = profile.trades ?? [];
  const areas = profile.areas ?? [];
  const portfolio = profile.portfolio ?? [];
  const socialLinks = profile.social_links ?? [];
  const place = [profile.city, profile.governorate].filter((value, index, all) => value && all.indexOf(value) === index).join(', ');
  const availability = availabilityTones[availabilityOf(profile)];
  const hasContact = [profile.professional_phone, profile.professional_email, profile.website_url, profile.whatsapp_phone].some(Boolean) || socialLinks.length > 0;
  const byGovernorate = areas.reduce<Record<string, string[]>>((groups, area) => {
    groups[area.governorate] = groups[area.governorate] ?? [];
    if (area.delegation) groups[area.governorate].push(area.delegation);
    return groups;
  }, {});
  const governorateCount = Object.keys(byGovernorate).length;

  return <section className="mx-auto w-full max-w-6xl space-y-6">
    {!showPreview && <div className="-my-2">{backLink}</div>}

    {showPreview && <div role="status" className="flex items-start gap-2.5 rounded-2xl border border-clay/20 bg-clay/10 p-4 text-sm text-clay">
      <Info aria-hidden="true" size={18} className="mt-0.5 shrink-0" />
      <div><strong className="block">APERÇU PRIVÉ — NON PUBLIÉ</strong>
        <span>Prévisualisation propriétaire / staff. Les médias en revue ne sont pas visibles par les clients tant que leur publication n’est pas approuvée et consentie.</span></div>
    </div>}

    <Card className="overflow-hidden p-0">
      <div aria-hidden="true" className="h-24 bg-[linear-gradient(120deg,rgba(15,118,110,0.18),rgba(247,245,239,0.9)_55%,rgba(217,119,69,0.16))] sm:h-32" />
      <div className="px-5 pb-6 sm:px-8 sm:pb-8">
        <div className="-mt-10 flex items-end justify-between gap-4 sm:-mt-12">
          <div className="space-y-1.5">
            <ProfileLogo profile={profile} />
            {showPreview && <PreviewState label="Logo" status={profile.logo_status} consent={profile.logo_public_consent} states={previewFileStates} />}
          </div>
          <span className={`mb-1 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${availability.pill}`}>
            <span aria-hidden="true" className={`h-2 w-2 rounded-full ${availability.dot}`} />{availabilityLabel(profile)}
          </span>
        </div>
        <div className="mt-4 space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-teal">{professionalTypeNames[profile.contractor_type ?? ''] || 'Professionnel'}</p>
            <h1 className="break-words text-3xl font-bold tracking-tight text-ink sm:text-4xl">{profile.name}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            {verified
              ? <span className="inline-flex items-center gap-1.5 font-semibold text-teal"><BadgeCheck aria-hidden="true" size={18} />Vérifié par D.A.O.</span>
              : <span className="inline-flex items-center gap-1.5 font-semibold text-clay"><AlertCircle aria-hidden="true" size={18} />Vérification en attente / suspendue</span>}
            <span className="inline-flex items-center gap-1.5 text-black/60"><MapPin aria-hidden="true" size={16} className="text-black/35" />{place || 'Localisation non renseignée'}</span>
          </div>
          {trades.length > 0 && <ul aria-label="Métiers" className="flex flex-wrap gap-2 pt-1">
            {trades.map((trade) => <li key={trade} className="rounded-lg bg-sand px-2.5 py-1 text-sm font-medium text-ink">{trade}</li>)}
          </ul>}
        </div>
        <dl className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Fact label="Expérience" value={profile.years_experience == null ? 'Non renseignée' : `${profile.years_experience} ${plural(profile.years_experience, 'an')}`} />
          <Fact label="Activité créée" value={profile.founded_year ? `En ${profile.founded_year}` : 'Non renseignée'} />
          <Fact label="Réalisations" value={portfolio.length ? `${portfolio.length} ${plural(portfolio.length, 'publiée')}` : 'Aucune'} />
          <Fact label="Zones" value={governorateCount ? `${governorateCount} ${plural(governorateCount, 'gouvernorat')}` : 'À discuter'} />
        </dl>
      </div>
    </Card>

    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <aside aria-label="Contact et confiance" className="space-y-6 lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1 lg:self-start">
        <Card className="space-y-4">
          <h2 className="text-lg font-bold text-ink">Contacter le professionnel</h2>
          {hasContact ? <ul className="-mx-3 space-y-0.5">
            {profile.professional_phone && <ContactRow href={`tel:${profile.professional_phone}`} icon={<Phone size={16} />}>{profile.professional_phone}</ContactRow>}
            {profile.professional_email && <ContactRow href={`mailto:${profile.professional_email}`} icon={<Mail size={16} />}>{profile.professional_email}</ContactRow>}
            {profile.whatsapp_phone && <ContactRow external href={`https://wa.me/${profile.whatsapp_phone.slice(1)}`} icon={<MessageCircle size={16} />}>Contacter sur WhatsApp</ContactRow>}
            {profile.website_url && <ContactRow external href={profile.website_url} icon={<Globe size={16} />}>Site officiel · {hostOf(profile.website_url)}</ContactRow>}
            {socialLinks.map((url) => <ContactRow key={url} external href={url} icon={<Link2 size={16} />}>{hostOf(url)}</ContactRow>)}
          </ul> : <p className="text-sm text-black/55">Ce professionnel n’a pas choisi de publier ses coordonnées.</p>}
          {!showPreview && <div className="space-y-2 border-t border-black/5 pt-4">
            <Link href={projectContext || '/app/projects'}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-ink px-4 text-center text-sm font-semibold text-white transition hover:bg-teal focus:outline-none focus:ring-4 focus:ring-teal/20">
              {projectContext ? 'Préparer une invitation pour ce lot' : 'Inviter depuis mes chantiers'}
            </Link>
            <p className="text-xs leading-relaxed text-black/55">L’invitation s’effectue dans l’onglet Équipe et requiert une action explicite du client. Consignez le professionnel choisi et ne communiquez le lien qu’au destinataire souhaité.</p>
          </div>}
        </Card>

        <Card className="space-y-3">
          <h2 className="text-lg font-bold text-ink">Ce que D.A.O. a contrôlé</h2>
          <ul className="space-y-3 text-sm">
            <li className="flex gap-2.5">
              {verified ? <ShieldCheck aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-teal" /> : <AlertCircle aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-clay" />}
              <span className="text-black/70">{verified ? 'Professionnel vérifié par D.A.O. à partir de son dossier privé.' : 'Vérification du professionnel en attente ou suspendue.'}</span>
            </li>
            {!showPreview && <li className="flex gap-2.5"><ShieldCheck aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-teal" /><span className="text-black/70">Fiche publique relue et approuvée par D.A.O.</span></li>}
            <li className="flex gap-2.5"><Info aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-black/40" /><span className="text-black/55">Les réalisations sont déclarées par le professionnel et leurs médias sont modérés.</span></li>
          </ul>
        </Card>
      </aside>

      <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-1">
        <Card className="space-y-4 sm:p-7">
          <h2 className="text-xl font-bold text-ink">Présentation</h2>
          <p className="whitespace-pre-wrap leading-relaxed text-black/75">{profile.presentation || 'Présentation non renseignée'}</p>
          {profile.specialties && <div className="rounded-2xl bg-sand/60 p-4">
            <h3 className="text-sm font-semibold text-ink">Spécialités</h3>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-black/70">{profile.specialties}</p>
          </div>}
        </Card>

        <section aria-labelledby="portfolio-title" className="space-y-4">
          <div className="space-y-1">
            <h2 id="portfolio-title" className="text-2xl font-bold tracking-tight text-ink">Réalisations</h2>
            <p className="text-sm text-black/55">Réalisations déclarées par le professionnel et médias modérés. D.A.O. ne certifie pas la réalisation des travaux.</p>
          </div>
          {!portfolio.length && <Card className="flex items-center gap-3 text-sm text-black/60">
            <ImageOff aria-hidden="true" size={20} className="shrink-0 text-black/35" />{showPreview ? 'Aucune réalisation à prévisualiser.' : 'Aucune réalisation publiée pour le moment.'}
          </Card>}
          {portfolio.map((project) => <Card key={project.id} className="space-y-4 sm:p-7">
            <div className="space-y-1.5">
              <h3 className="text-xl font-bold text-ink">{project.title}</h3>
              {showPreview && <PreviewState label="Réalisation" status={project.status} consent={project.publication_consent} states={previewProjectStates} />}
              {[project.trade, project.approximate_location, project.completed_year].some(Boolean) && <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-black/55">
                {project.trade && <span className="font-medium text-teal">{project.trade}</span>}
                {project.approximate_location && <span className="inline-flex items-center gap-1"><MapPin aria-hidden="true" size={14} />{project.approximate_location}</span>}
                {project.completed_year && <span>{project.completed_year}</span>}
              </p>}
            </div>
            {project.description && <p className="whitespace-pre-wrap text-sm leading-relaxed text-black/70">{project.description}</p>}
            {(project.assets ?? []).length > 0 && <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {(project.assets ?? []).map((asset) => <MediaTile key={asset.id} asset={asset} preview={showPreview} />)}
            </div>}
          </Card>)}
        </section>

        <Card className="space-y-4 sm:p-7">
          <h2 className="text-xl font-bold text-ink">Zones d’intervention</h2>
          {governorateCount ? <ul className="space-y-2.5">
            {Object.entries(byGovernorate).map(([governorate, delegations]) => <li key={governorate} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
              <span className="inline-flex items-center gap-1.5 font-semibold text-ink"><MapPin aria-hidden="true" size={15} className="text-teal" />{governorate}</span>
              <span className="text-black/55">{delegations.length ? delegations.join(' · ') : 'tout le gouvernorat'}</span>
            </li>)}
          </ul> : <p className="text-sm text-black/55">À discuter avec le professionnel.</p>}
          {profile.office_address && <p className="border-t border-black/5 pt-4 text-sm text-black/70"><strong className="text-ink">Bureau : </strong>{profile.office_address}</p>}
        </Card>
      </div>
    </div>
  </section>;
}
