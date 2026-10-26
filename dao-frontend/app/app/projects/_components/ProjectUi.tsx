'use client';

import Link from 'next/link';
import { AlertTriangle, Check, RotateCcw } from 'lucide-react';
import { statusLabel } from '../../../../lib/utils';

/*
 * Mini-guide UX S1 (#198) — primitives visuelles propres aux écrans Client
 * « Mes chantiers » et « Détail d’un chantier ». Elles réutilisent les tokens
 * D.A.O. (ink, sand, teal, clay) sans toucher au thème global ni à RoleNav.
 * 1. Typographie : un seul H1 par écran, H2 de section, méta ≥ ink/65 (AA).
 * 2. Espacement : grille de 4 px, sections à 24 px, cartes à 20–24 px.
 * 3. Titre/action : contexte → titre → une action principale sombre ;
 *    actions secondaires en contour ; action destructrice isolée.
 * 4. Composants : statut = pastille à point coloré, texte toujours lisible ;
 *    cibles tactiles ≥ 44 px sur mobile.
 * 5. États : chargement à la forme du contenu, vide avec action, erreur avec
 *    « Réessayer », jamais de code brut affiché.
 */

export type Tone = 'neutral' | 'teal' | 'clay' | 'red';

export function statusTone(status: string): Tone {
  if (status === 'rejected') return 'red';
  if (['open', 'published', 'approved'].includes(status)) return 'teal';
  if (['client_review', 'dao_review'].includes(status)) return 'clay';
  return 'neutral';
}

export const readableStatus = (status: string) => statusLabel[status] ?? 'Statut à préciser';

const pillTones: Record<Tone, string> = {
  neutral: 'bg-ink/[0.06] text-ink/80',
  teal: 'bg-teal/10 text-teal',
  clay: 'bg-clay/[0.12] text-ink',
  red: 'bg-red-50 text-red-700',
};
const dotTones: Record<Tone, string> = { neutral: 'bg-ink/40', teal: 'bg-teal', clay: 'bg-clay', red: 'bg-red-600' };

/** Pastille de statut : la couleur est portée par le point, le texte reste contrasté. */
export function Pill({ children, tone = 'neutral', className = '' }: { children: React.ReactNode; tone?: Tone; className?: string }) {
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${pillTones[tone]} ${className}`}><span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotTones[tone]}`} />{children}</span>;
}

export function StatusPill({ status }: { status: string }) {
  return <Pill tone={statusTone(status)}>{readableStatus(status)}</Pill>;
}

/* Parcours réel d’une version de DAO : draft → client_review → dao_review → approved → publication. */
const dossierSteps = ['Préparation', 'Soumission', 'Revue D.A.O.', 'Publication'];
export function dossierStep(status: string): { index: number; complete: boolean } | null {
  if (status === 'draft' || status === 'rejected') return { index: 0, complete: false };
  if (status === 'client_review') return { index: 1, complete: false };
  if (status === 'dao_review') return { index: 2, complete: false };
  if (status === 'approved') return { index: 3, complete: false };
  if (['open', 'published', 'closed'].includes(status)) return { index: 3, complete: true };
  return null;
}

/** Phrase d’état courte pour la liste : décrit la situation, sans inventer d’action. */
export function dossierSummary(status: string) {
  return ({
    draft: 'Dossier en préparation',
    rejected: 'Corrections à apporter',
    client_review: 'Soumis, en attente de revue',
    dao_review: 'Revue D.A.O. en cours',
    approved: 'Validé, prêt à publier',
    open: 'Dossier publié',
    published: 'Dossier publié',
    closed: 'Consultation clôturée',
    archived: 'Projet conservé en archive',
  } as Record<string, string>)[status] ?? 'Suivi du dossier';
}

/** Progression compacte (liste) : 4 segments, texte équivalent pour lecteurs d’écran. */
export function DossierMeter({ status }: { status: string }) {
  const step = dossierStep(status);
  if (!step) return null;
  const filled = step.complete ? 4 : step.index + 1;
  const tone = status === 'rejected' ? 'bg-red-500' : step.complete ? 'bg-teal' : 'bg-ink/70';
  return <span className="flex items-center gap-1" aria-hidden="true">{dossierSteps.map((label, index) => <span key={label} className={`h-1 w-5 rounded-full ${index < filled ? tone : 'bg-ink/10'}`} />)}</span>;
}

export function dossierStepText(status: string) {
  const step = dossierStep(status);
  if (!step) return '';
  return step.complete ? 'Parcours du dossier terminé' : `Étape ${step.index + 1} sur 4 : ${dossierSteps[step.index]}`;
}

/** Parcours détaillé (en-tête du chantier). */
export function DossierSteps({ status }: { status: string }) {
  const step = dossierStep(status);
  if (!step) return <p className="text-sm text-ink/70">Ce projet est archivé et reste consultable.</p>;
  const rejectedNow = status === 'rejected';
  // Mobile: the four labels do not fit in quarter-width columns without breaking words,
  // so phones show the bars plus one caption naming the current step; labels appear from sm.
  return <div>
    <ol className="grid grid-cols-4 gap-2" aria-label="Parcours du dossier D.A.O.">{dossierSteps.map((label, index) => {
      const done = step.complete || index < step.index;
      const current = !step.complete && index === step.index;
      const blocked = current && rejectedNow;
      return <li key={label} aria-current={current ? 'step' : undefined} className="min-w-0">
        <span aria-hidden="true" className={`block h-1.5 rounded-full ${done ? 'bg-teal' : current ? (blocked ? 'bg-red-500' : 'bg-ink') : 'bg-ink/10'}`} />
        <span className={`mt-2 hidden items-center gap-1 text-xs font-semibold leading-tight sm:flex ${done ? 'text-teal' : current ? (blocked ? 'text-red-700' : 'text-ink') : 'text-ink/65'}`}>{done && <Check size={12} aria-hidden="true" className="shrink-0" />}<span className="min-w-0">{label}</span></span>
        <span className="sr-only">{label}{done ? ' — terminé' : current ? ' — étape actuelle' : ' — à venir'}</span>
      </li>;
    })}</ol>
    <p aria-hidden="true" className={`mt-2.5 flex items-center gap-1.5 text-xs font-semibold sm:hidden ${rejectedNow ? 'text-red-700' : step.complete ? 'text-teal' : 'text-ink'}`}>{step.complete ? <><Check size={12} className="shrink-0" />Parcours terminé · {dossierSteps[3]}</> : <>Étape {step.index + 1} sur 4 · {dossierSteps[step.index]}{rejectedNow && ' · corrections demandées'}</>}</p>
  </div>;
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const safe = Math.max(0, Math.min(100, value));
  return <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={safe} className="h-1.5 w-full overflow-hidden rounded-full bg-ink/10"><div className="h-full rounded-full bg-teal transition-[width]" style={{ width: `${safe}%` }} /></div>;
}

/** Erreur utile : message annoncé, action de reprise réelle quand elle existe. */
export function ErrorPanel({ title, message, onRetry, backHref }: { title: string; message: string; onRetry?: () => void; backHref?: string }) {
  return <div className="flex flex-col gap-4 rounded-2xl border border-red-200 bg-red-50/70 p-5 sm:flex-row sm:items-start">
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-red-600 ring-1 ring-red-100"><AlertTriangle size={18} aria-hidden="true" /></span>
    <div className="min-w-0 flex-1">
      <p className="font-semibold text-red-800">{title}</p>
      <p role="alert" className="mt-1 text-sm text-red-800">{message}</p>
      {(onRetry || backHref) && <div className="mt-4 flex flex-wrap gap-2">
        {onRetry && <button type="button" onClick={onRetry} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-ink ring-1 ring-black/10 transition hover:bg-sand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"><RotateCcw size={15} aria-hidden="true" />Réessayer</button>}
        {backHref && <Link href={backHref} className="inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold text-teal hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal">Retour à Mes chantiers</Link>}
      </div>}
    </div>
  </div>;
}

/* Styles d’action partagés par les deux écrans (liens et boutons). */
export const primaryAction = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-teal px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-tealdark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal disabled:cursor-not-allowed disabled:opacity-50';
export const secondaryAction = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-ink ring-1 ring-inset ring-black/10 transition hover:bg-sand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal disabled:cursor-not-allowed disabled:opacity-50';
export const fieldClass = 'min-h-11 w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink transition focus:border-teal focus:outline-none focus:ring-4 focus:ring-teal/10';
