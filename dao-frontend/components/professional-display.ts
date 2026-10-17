// Lives under components/ so Tailwind scans the class names below.
// Display helpers shared by the Client directory and the professional profile.
// Pure formatting only: access and publication rules stay in the RPCs.

export const professionalTypeNames: Record<string, string> = {
  artisan: 'Artisan',
  company: 'Entreprise',
  general_contractor: 'Entreprise générale',
  independent_professional: 'Professionnel indépendant',
};

export type AvailabilityState = 'now' | 'soon' | 'to_discuss' | 'unavailable';
type AvailabilityInput = { availability?: string | null; available_from?: string | null };

const today = () => new Date().toISOString().slice(0, 10);

/** Effective availability: a scheduled date that has passed means available now. */
export function availabilityOf(row: AvailabilityInput): AvailabilityState {
  if (row.availability === 'available') return 'now';
  if (row.availability === 'scheduled') return row.available_from && row.available_from <= today() ? 'now' : 'soon';
  if (row.availability === 'unavailable') return 'unavailable';
  return 'to_discuss';
}

export function availabilityLabel(row: AvailabilityInput) {
  const state = availabilityOf(row);
  if (state === 'now') return 'Disponible';
  if (state === 'unavailable') return 'Indisponible';
  if (state === 'soon') {
    if (!row.available_from) return 'Disponibilité planifiée';
    const date = new Date(`${row.available_from}T00:00:00`);
    return `Dès le ${date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`;
  }
  return 'Disponibilité à discuter';
}

export const availabilityTones: Record<AvailabilityState, { pill: string; dot: string }> = {
  now: { pill: 'bg-emerald-50 text-emerald-800', dot: 'bg-emerald-500' },
  soon: { pill: 'bg-amber-50 text-amber-800', dot: 'bg-amber-500' },
  to_discuss: { pill: 'bg-sand text-black/60', dot: 'bg-black/25' },
  unavailable: { pill: 'bg-sand text-black/60', dot: 'bg-black/25' },
};

export function initials(name: string) {
  const words = name.split(/[\s\-'’&.,()/]+/).filter(Boolean);
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? words[0]?.[1] ?? '')).toUpperCase() || '·';
}

const monogramTones = ['bg-teal/10 text-teal', 'bg-clay/10 text-clay', 'bg-ink/[0.06] text-ink', 'bg-amber-100 text-amber-800'];

export function monogramTone(id: string) {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  return monogramTones[hash % monogramTones.length];
}

export const plural = (count: number, singular: string, pluralForm = `${singular}s`) => (count > 1 ? pluralForm : singular);
