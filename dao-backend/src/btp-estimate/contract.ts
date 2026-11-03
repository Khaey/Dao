// #551 — contrat v1 de la base de prix et de l'estimation (consommable par l'assistant #543 et l'UI).
// Montants : millimes TND entiers (number, < 2^53). Quantités : chaînes décimales (≤ 6 décimales).

export type EstimateMode = 'reference' | 'simulation';
export type CoverageStatus = 'complete' | 'partial' | 'unavailable';
export type LineStatus = 'priced' | 'priced_components' | 'missing';
export type TaxBasis = 'HT' | 'TTC';
export type PriceComponent = 'composite' | 'material' | 'labour' | 'equipment';

export type EstimateLineInput = {
  workId: string;
  scopeKey?: string;
  quantity?: { value: string; unit?: string };
  source?: { kind: 'declared'; reference: string } | { kind: 'takeoff'; takeoffId: string } | { kind: 'none' };
};

export type EstimateRequest = {
  projectId: string;
  mode?: EstimateMode;
  referenceDate?: string;
  includePrivateAssumptions?: boolean;
  includeAssistantScope?: boolean;
  includeValidatedTakeoffs?: boolean;
  lines?: EstimateLineInput[];
};

export type PriceCandidate = {
  itemId: string; revision: number; priceKind: 'observed' | 'private_assumption'; component: PriceComponent;
  zone: 'governorate' | 'national' | 'project';
  amountMinMinor: number; amountMaxMinor: number; taxBasis: TaxBasis; vatRateBp: number | null;
  includes: string[]; observedOn: string; validFrom: string; validTo: string | null; sourceLocator: string; conditions: string;
  source: { id: string; code: string; name: string; publisher: string; uri: string | null; licenseNote: string; dataNature: 'real' | 'fictitious_test' } | null;
  totalHtMinMinor: number | null; totalHtMaxMinor: number | null; totalTtcMinMinor: number | null; totalTtcMaxMinor: number | null;
};

export type MinorRange = { htMinMinor: number | null; htMaxMinor: number | null; ttcMinMinor: number | null; ttcMaxMinor: number | null };

export type EstimateLine = {
  workId: string; workCode?: string; workLabel?: string; unitCode?: string;
  lotId?: string; lotCode?: string; lotLabel?: string; subLotId?: string; subLotLabel?: string;
  scopeKey: string; origin: 'explicit' | 'validated_takeoff' | 'assistant_scope'; status: LineStatus;
  quantity: { value: string; unit: string } | null;
  quantitySource: { kind: 'declared'; reference: string } | { kind: 'takeoff'; takeoffId: string; revision: number | null } | { kind: 'none' };
  candidates: PriceCandidate[]; totals: MinorRange; missing: string[]; warnings: string[]; formula: string;
};

export type EstimateResult = {
  engine: 'dao-estimate-v1'; nonContractual: true; mode: EstimateMode; referenceDate: string; currency: 'TND'; countryCode: string;
  governorateId: string | null; governorate: string | null; catalogVersion: { id: string; code: string }; takeoffEngineAvailable: boolean;
  coverage: { status: CoverageStatus; totalLines: number; pricedLines: number; completeLines: number; missingLines: number };
  totals: MinorRange & { scope: 'complete' | 'priced_lines_only' | 'none'; linesWithoutHt: number; linesWithoutTtc: number };
  byLot: Array<MinorRange & { lotId: string; lotCode: string; lotLabel: string; totalLines: number; pricedLines: number }>;
  lines: EstimateLine[];
  missing: Array<{ workId: string; workLabel?: string; unitCode?: string; scopeKey: string; codes: string[] }>;
  warnings: string[];
  rules: { version: string; selection: string[]; rounding: string; tax: string; freshness: string };
};

export const MISSING_LABELS: Record<string, string> = {
  quantity_missing: 'Quantité inconnue : fournir un métré validé ou une quantité déclarée avec sa référence.',
  quantity_not_validated: 'Le métré cité n’est pas validé.',
  quantity_unit_mismatch: 'Le métré n’est pas dans l’unité de l’ouvrage (aucune conversion implicite).',
  quantity_precision_unsupported: 'Quantité avec plus de 6 décimales.',
  price_missing: 'Aucun tarif sourcé et vérifié applicable.',
  price_out_of_validity_period: 'Tarif hors période de validité à la date de référence.',
  price_currency_without_sourced_rate: 'Tarif dans une autre devise, sans taux de change sourcé.',
  price_unit_differs_from_work_unit: 'Tarif publié dans une autre unité que l’ouvrage.',
  work_not_in_catalog: 'Ouvrage absent de la version publiée du référentiel.',
};
