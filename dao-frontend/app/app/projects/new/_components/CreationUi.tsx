'use client';

import Link from 'next/link';
import { ArrowLeft, ArrowRight, Check, ChevronLeft, Pencil } from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import { primaryAction, secondaryAction } from '../../_components/ProjectUi';

/*
 * UX S2 (#203) — primitives propres à la création de chantier Client.
 * Mêmes règles que S1 : un H1, une action principale par étape, cibles 44 px,
 * erreurs reliées aux champs (aria-invalid + aria-describedby), aucun code brut.
 */

/** Retour : `backHref` (lien) ou `onBack` (bouton). Sans l'un ni l'autre, pas de retour : on n'expose aucun lien qui perdrait la saisie en cours. */
export function CreationHeader({ eyebrow, title, description, onBack, backHref, backLabel = 'Mes chantiers' }: { eyebrow: string; title: string; description: string; onBack?: () => void; backHref?: string; backLabel?: string }) {
  const backClass = '-ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-teal transition hover:bg-teal/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal';
  return <header className="space-y-4">
    {onBack ? <button type="button" onClick={onBack} className={backClass}><ChevronLeft size={16} aria-hidden="true" />{backLabel}</button> : backHref ? <Link href={backHref} className={backClass}><ChevronLeft size={16} aria-hidden="true" />{backLabel}</Link> : null}
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal">{eyebrow}</p>
      <h1 className="mt-2 text-[1.75rem] font-bold leading-tight tracking-tight text-ink sm:text-3xl">{title}</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink/70">{description}</p>
    </div>
  </header>;
}

/** Progression : barres + libellés à partir de 640 px, légende unique sur mobile (pas de mots coupés). */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return <div>
    <ol className="grid gap-2" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }} aria-label="Étapes de création">{steps.map((label, index) => {
      const done = index < current; const active = index === current;
      return <li key={label} aria-current={active ? 'step' : undefined} className="min-w-0">
        <span aria-hidden="true" className={`block h-1.5 rounded-full transition-colors ${done ? 'bg-teal' : active ? 'bg-ink' : 'bg-ink/10'}`} />
        <span className={`mt-2 hidden items-center gap-1 text-xs font-semibold leading-tight sm:flex ${done ? 'text-teal' : active ? 'text-ink' : 'text-ink/65'}`}>{done && <Check size={12} aria-hidden="true" className="shrink-0" />}<span className="min-w-0">{label}</span></span>
        <span className="sr-only">{label}{done ? ' — terminé' : active ? ' — étape actuelle' : ' — à venir'}</span>
      </li>;
    })}</ol>
    <p aria-hidden="true" className="mt-2.5 text-xs font-semibold text-ink sm:hidden">Étape {current + 1} sur {steps.length} · {steps[current]}</p>
  </div>;
}

/** Champ avec libellé, aide et erreur reliées. Le libellé visible reste celui des E2E. */
export function Field({ id, label, hint, error, optional, className, children }: { id: string; label: string; hint?: string; error?: string; optional?: boolean; className?: string; children: React.ReactNode }) {
  return <div className={cn('min-w-0', className)}>
    <label htmlFor={id} className="block text-sm font-semibold text-ink">{label}{optional && <span className="ml-1.5 text-xs font-medium text-ink/65">facultatif</span>}</label>
    <div className="mt-2">{children}</div>
    {hint && !error && <p id={`${id}-hint`} className="mt-1.5 text-xs leading-relaxed text-ink/65">{hint}</p>}
    {error && <p id={`${id}-error`} className="mt-1.5 text-xs font-medium text-red-700">{error}</p>}
  </div>;
}

/** Props ARIA d'un contrôle selon son état d'erreur et la présence d'une aide. */
export const describe = (id: string, error?: string, hint?: string) => ({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? `${id}-error` : hint ? `${id}-hint` : undefined });

export const controlClass = (error?: string) => cn('min-h-11 w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm text-ink transition placeholder:text-ink/45 focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:bg-sand disabled:text-ink/55', error ? 'border-red-300 focus:border-red-500 focus:ring-red-100' : 'border-black/10 focus:border-teal focus:ring-teal/10');

export function Panel({ title, description, children, className }: { title: string; description?: string; children: React.ReactNode; className?: string }) {
  return <section className={cn('rounded-2xl border border-black/[0.06] bg-white p-5 shadow-[0_1px_2px_rgba(23,32,42,0.04)] sm:p-7', className)}>
    <div className="border-b border-black/[0.06] pb-4"><h2 className="text-lg font-bold tracking-tight text-ink sm:text-xl">{title}</h2>{description && <p className="mt-1 text-sm leading-relaxed text-ink/70">{description}</p>}</div>
    <div className="pt-5">{children}</div>
  </section>;
}

/** Ligne de récapitulatif avec accès direct à l'étape à corriger. */
export function SummaryBlock({ title, onEdit, editLabel, children }: { title: string; onEdit?: () => void; editLabel?: string; children: React.ReactNode }) {
  return <div className="rounded-xl bg-sand/80 p-4">
    <div className="flex items-start justify-between gap-3"><p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink/65">{title}</p>{onEdit && <button type="button" onClick={onEdit} aria-label={editLabel ?? `Modifier : ${title}`} className="-my-2.5 -mr-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-teal transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal"><Pencil size={13} aria-hidden="true" />Modifier</button>}</div>
    <div className="mt-1.5 min-w-0 text-sm text-ink">{children}</div>
  </div>;
}

/**
 * Barre d'actions : collée en bas sur mobile pour garder « Continuer » à portée du pouce.
 * Un seul bouton principal par étape (les E2E le trouvent par son nom).
 */
export function StepActions({ onPrevious, previousDisabled, primaryLabel, primaryDisabled, busy, primaryType = 'submit', onPrimary, note }: { onPrevious?: () => void; previousDisabled?: boolean; primaryLabel: string; primaryDisabled?: boolean; busy?: boolean; primaryType?: 'submit' | 'button'; onPrimary?: () => void; note?: string }) {
  const final = !/^Continuer$/.test(primaryLabel);
  return <div data-dao-bottom-bar className="sticky bottom-0 z-10 -mx-5 mt-8 border-t border-black/[0.08] bg-white/95 px-5 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:static sm:mx-0 sm:bg-transparent sm:px-0 sm:pb-0 sm:pt-5 sm:backdrop-blur-none">
    <div className="flex items-center justify-between gap-3">
      {onPrevious ? <button type="button" className={cn(secondaryAction, 'min-w-11 px-3 sm:px-4')} disabled={previousDisabled} onClick={onPrevious}><ArrowLeft size={16} aria-hidden="true" /><span className="hidden min-[380px]:inline">Précédent</span><span className="sr-only min-[380px]:hidden">Précédent</span></button> : <span />}
      <button type={primaryType} onClick={onPrimary} className={cn(primaryAction, 'flex-1 sm:flex-none')} disabled={primaryDisabled || busy} aria-busy={busy || undefined}>{primaryLabel}{!final && !busy && <ArrowRight size={16} aria-hidden="true" />}</button>
    </div>
    {note && <p className="mt-2 text-center text-xs text-ink/65 sm:text-right">{note}</p>}
  </div>;
}

export function FormAlert({ children }: { children: React.ReactNode }) {
  return <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{children}</p>;
}

export const formatTnd = (value: string) => value.trim() === '' || !Number.isFinite(Number(value)) ? '' : new Intl.NumberFormat('fr-TN', { style: 'currency', currency: 'TND', maximumFractionDigits: 3 }).format(Number(value));
export const formatDay = (value: string) => value ? new Intl.DateTimeFormat('fr-TN', { dateStyle: 'medium' }).format(new Date(`${value}T00:00:00`)) : '';
