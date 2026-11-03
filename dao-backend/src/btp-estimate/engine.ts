// #551 — vérificateur arithmétique indépendant de l'estimation calculée en base.
// La base (`dao_private.btp_estimate_compute`) sélectionne les tarifs et calcule ; ce module
// recalcule chaque montant en entiers exacts (BigInt) et signale tout écart. Il ne choisit
// jamais un tarif et n'invente aucune valeur.
import type { EstimateResult, MinorRange, PriceCandidate, TaxBasis } from './contract.js';

const QUANTITY = /^[0-9]{1,12}(\.[0-9]{1,6})?$/;
// Constantes BigInt sans littéraux `n` (le build Next.js cible une version antérieure à ES2020).
const B = (n: number | string) => BigInt(n);
const ZERO = B(0), ONE_MICRO = B(1_000_000), TWO = B(2), BP = B(10_000), HT_TTC = B('10000000000');

/** Quantité décimale → micro-unités entières ; null si invalide ou plus de 6 décimales. */
export function quantityMicro(value: string): bigint | null {
  if (!QUANTITY.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * ONE_MICRO + BigInt(fraction.padEnd(6, '0'));
}

/** Arrondi demi-supérieur de n/d (n, d > 0) en entier. */
function halfUp(n: bigint, d: bigint) { return (TWO * n + d) / (TWO * d); }

/**
 * Montant de ligne en millimes : quantité × prix unitaire (millimes), conversion HT↔TTC
 * uniquement avec un taux explicite (points de base). Identique à `dao_private.btp_estimate_amount`.
 */
export function lineAmount(qtyMicro: bigint, amountMinor: number, basis: TaxBasis, vatRateBp: number | null, target: TaxBasis): number | null {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new Error('amount must be integer millimes');
  const amount = BigInt(amountMinor);
  if (basis === target) return Number(halfUp(qtyMicro * amount, ONE_MICRO));
  if (vatRateBp == null) return null;
  const rate = BigInt(vatRateBp);
  if (basis === 'HT') return Number(halfUp(qtyMicro * amount * (BP + rate), HT_TTC));
  return Number(halfUp(qtyMicro * amount * BP, ONE_MICRO * (BP + rate)));
}

function candidateTotals(qty: bigint, c: PriceCandidate): MinorRange {
  return {
    htMinMinor: lineAmount(qty, c.amountMinMinor, c.taxBasis, c.vatRateBp, 'HT'),
    htMaxMinor: lineAmount(qty, c.amountMaxMinor, c.taxBasis, c.vatRateBp, 'HT'),
    ttcMinMinor: lineAmount(qty, c.amountMinMinor, c.taxBasis, c.vatRateBp, 'TTC'),
    ttcMaxMinor: lineAmount(qty, c.amountMaxMinor, c.taxBasis, c.vatRateBp, 'TTC'),
  };
}

/** Fourchette de ligne : min/max entre sources ex aequo d'une composante, somme des composantes. */
export function aggregateLine(candidates: PriceCandidate[], qty: bigint): MinorRange {
  const byComponent = new Map<string, MinorRange[]>();
  for (const c of candidates) byComponent.set(c.component, [...(byComponent.get(c.component) ?? []), candidateTotals(qty, c)]);
  const sum = (pick: (r: MinorRange[]) => number | null) => {
    let total = 0;
    for (const ranges of byComponent.values()) { const v = pick(ranges); if (v == null) return null; total += v; }
    return total;
  };
  const extreme = (key: keyof MinorRange, fn: (...n: number[]) => number) => (ranges: MinorRange[]) =>
    ranges.some(r => r[key] == null) ? null : fn(...ranges.map(r => r[key] as number));
  const ht = sum(extreme('htMinMinor', Math.min)) != null && sum(extreme('htMaxMinor', Math.max)) != null;
  const ttc = sum(extreme('ttcMinMinor', Math.min)) != null && sum(extreme('ttcMaxMinor', Math.max)) != null;
  return {
    htMinMinor: ht ? sum(extreme('htMinMinor', Math.min)) : null,
    htMaxMinor: ht ? sum(extreme('htMaxMinor', Math.max)) : null,
    ttcMinMinor: ttc ? sum(extreme('ttcMinMinor', Math.min)) : null,
    ttcMaxMinor: ttc ? sum(extreme('ttcMaxMinor', Math.max)) : null,
  };
}

const KEYS: (keyof MinorRange)[] = ['htMinMinor', 'htMaxMinor', 'ttcMinMinor', 'ttcMaxMinor'];

/** Recalcule toutes les lignes et les totaux ; `ok` seulement si tout concorde et si l'état est honnête. */
export function verifyEstimateResult(result: EstimateResult): { ok: boolean; mismatches: string[] } {
  const mismatches: string[] = [];
  const priced = result.lines.filter(l => l.status !== 'missing');
  for (const line of result.lines) {
    const id = `${line.workCode ?? line.workId}/${line.scopeKey}`;
    if (line.status === 'missing') {
      if (KEYS.some(k => line.totals?.[k] != null)) mismatches.push(`${id}: missing line carries an amount`);
      if (!line.missing?.length) mismatches.push(`${id}: missing line without reason`);
      continue;
    }
    const qty = line.quantity ? quantityMicro(line.quantity.value) : null;
    if (qty == null || qty <= ZERO) { mismatches.push(`${id}: priced line without a valid quantity`); continue; }
    if (!line.candidates.length) { mismatches.push(`${id}: priced line without a source`); continue; }
    if (line.candidates.some(c => c.priceKind === 'observed' && c.source?.dataNature !== (result.mode === 'simulation' ? 'fictitious_test' : 'real')))
      mismatches.push(`${id}: data nature does not match the estimate mode`);
    for (const c of line.candidates) {
      const t = candidateTotals(qty, c);
      if (t.htMinMinor !== c.totalHtMinMinor || t.htMaxMinor !== c.totalHtMaxMinor || t.ttcMinMinor !== c.totalTtcMinMinor || t.ttcMaxMinor !== c.totalTtcMaxMinor)
        mismatches.push(`${id}: candidate ${c.itemId} amount mismatch`);
    }
    const expected = aggregateLine(line.candidates, qty);
    for (const k of KEYS) if (expected[k] !== line.totals[k]) mismatches.push(`${id}: ${k} ${line.totals[k]} ≠ ${expected[k]}`);
  }
  for (const k of KEYS) {
    const expected = priced.length && priced.every(l => l.totals[k] != null) ? priced.reduce((s, l) => s + (l.totals[k] as number), 0) : null;
    if ((result.totals[k] ?? null) !== expected) mismatches.push(`total ${k} ${result.totals[k]} ≠ ${expected}`);
  }
  const complete = result.lines.length > 0 && result.lines.every(l => l.status === 'priced');
  const status = complete ? 'complete' : priced.length === 0 ? 'unavailable' : 'partial';
  if (result.coverage.status !== status) mismatches.push(`coverage ${result.coverage.status} ≠ ${status}`);
  if (status !== 'complete' && result.totals.scope === 'complete') mismatches.push('incomplete estimate presented as complete');
  return { ok: mismatches.length === 0, mismatches };
}
