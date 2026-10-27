import type { Installment, PaymentMode, ReferenceSubLot } from './precontract';

export type SuggestionInput = {
  paymentMode: PaymentMode; startDate?: string | null; durationDays?: number | null;
  totalMillimes?: number | null; subLots?: ReferenceSubLot[];
};

function dayUTC(date: Date, offset: number) {
  const shifted = new Date(date.getTime() + offset * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}
/** Only an editable reference, never a payment order. Distributes every last millime exactly. */
export function suggestInstallments(input: SuggestionInput): Installment[] {
  const { paymentMode: mode, startDate, durationDays, totalMillimes } = input;
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !Number.isInteger(durationDays) ||
      !durationDays || durationDays < 1 || durationDays > 3650 || !Number.isSafeInteger(totalMillimes) ||
      totalMillimes == null || totalMillimes < 1 || mode === 'none') return [];
  const start = new Date(startDate + 'T00:00:00.000Z');
  if (!Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== startDate) return [];
  const end = new Date(start.getTime() + (durationDays - 1) * 86_400_000);
  const items: { label: string; due_date: string }[] = [];
  if (mode === 'daily' || mode === 'weekly') {
    const step = mode === 'daily' ? 1 : 7;
    for (let offset = step - 1; offset < durationDays; offset += step)
      items.push({ label: mode === 'daily' ? 'Jour ' + (offset + 1) : 'Semaine ' + (items.length + 1), due_date: dayUTC(start, offset) });
    if (!items.length || items[items.length - 1].due_date !== dayUTC(start, durationDays - 1))
      items.push({ label: 'Fin de période', due_date: dayUTC(start, durationDays - 1) });
  } else if (mode === 'monthly') {
    for (let month = 1; month <= 121; month++) {
      const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + month, start.getUTCDate()));
      if (date >= end) break;
      items.push({ label: 'Mois ' + month, due_date: date.toISOString().slice(0, 10) });
    }
    items.push({ label: 'Fin de période', due_date: end.toISOString().slice(0, 10) });
  } else if (mode === 'milestone') {
    const count = Math.min(3, durationDays);
    for (let i = 1; i <= count; i++)
      items.push({ label: 'Étape indicative ' + i, due_date: dayUTC(start, Math.ceil(i * durationDays / count) - 1) });
  } else if (mode === 'sub_lot') {
    const subs = input.subLots ?? [];
    if (!subs.length) return [];
    for (let i = 0; i < subs.length; i++)
      items.push({ label: 'Sous-lot : ' + subs[i].title,
        due_date: subs[i].end_date && /^\d{4}-\d{2}-\d{2}$/.test(subs[i].end_date!)
          ? subs[i].end_date! : dayUTC(start, Math.ceil((i + 1) * durationDays / subs.length) - 1) });
  } else {
    items.push({ label: mode === 'project_end' ? 'Fin du chantier (à confirmer)' : 'Fin du lot',
      due_date: end.toISOString().slice(0, 10) });
  }
  if (items.length > 100) return [];
  const base = Math.floor(totalMillimes / items.length);
  return items.map((item, i) => ({
    ...item, amount_millimes: i === items.length - 1
      ? totalMillimes - base * (items.length - 1) : base
  }));
}
