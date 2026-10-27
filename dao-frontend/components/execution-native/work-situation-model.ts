import type { NativeExecutionWorkspace } from '../../../dao-backend/src/native-tracking/contract';

/** Situations de travaux P12 : quantités techniques seulement (milli-unités physiques, jamais des millimes TND). */
export type SituationStatus = 'draft' | 'submitted' | 'under_review' | 'revision_requested' | 'validated_technical' | 'contested' | 'withdrawn';
export type SituationAction = 'save_draft' | 'submit' | 'start_review' | 'request_revision' | 'validate_technical' | 'contest' | 'manager_suggestion' | 'withdraw';

export const situationStatus: Record<SituationStatus, string> = {
  draft: 'Brouillon', submitted: 'Soumise', under_review: 'En revue', revision_requested: 'Correction demandée',
  validated_technical: 'Quantités validées techniquement', contested: 'Contestée', withdrawn: 'Retirée',
};
export const situationEvent: Record<string, string> = {
  created: 'Situation créée', draft_saved: 'Brouillon enregistré', submitted: 'Situation soumise', review_started: 'Revue démarrée',
  revision_requested: 'Correction demandée', quantities_validated: 'Quantités validées techniquement', contested: 'Situation contestée',
  manager_suggestion: 'Suggestion du Gestionnaire', withdrawn: 'Situation retirée',
};

/** « 12,5 » → « 12500 » sans passer par un flottant ; null si la saisie n’est pas un nombre à 3 décimales au plus. */
export function toMilli(input: string, allowZero = false): string | null {
  const match = /^\s*(\d{1,13})(?:[.,](\d{1,3}))?\s*$/.exec(input);
  if (!match) return null;
  const digits = (match[1] + (match[2] ?? '').padEnd(3, '0')).replace(/^0+(?=\d)/, '');
  if (digits.length > 13 || BigInt(digits) > BigInt('1000000000000')) return null;
  if (digits === '0' && !allowZero) return null;
  return digits;
}

/** « 12500 » → « 12,5 » ; la chaîne exacte du serveur reste la référence. */
export function fromMilli(value: string | null | undefined): string {
  if (value == null || !/^\d+$/.test(value)) return '—';
  const padded = value.padStart(4, '0');
  const whole = padded.slice(0, -3).replace(/^0+(?=\d)/, '');
  const fraction = padded.slice(-3).replace(/0+$/, '');
  return fraction ? `${whole},${fraction}` : whole;
}

/**
 * Actions proposées selon l’espace renvoyé par le serveur et l’état de la situation.
 * Le serveur reste seul juge : un refus 403/409 est affiché tel quel. Le Gestionnaire ne fait que suggérer.
 */
export function situationActions(workspace: NativeExecutionWorkspace, status: SituationStatus, opts: { ownContractor: boolean; canComment: boolean }): SituationAction[] {
  if (workspace === 'contractor') {
    if (!opts.ownContractor) return [];
    return ({
      draft: ['save_draft', 'submit', 'withdraw'], revision_requested: ['save_draft', 'submit', 'withdraw'],
      submitted: ['withdraw'], contested: ['save_draft', 'withdraw'], under_review: ['contest'], validated_technical: ['contest'], withdrawn: [],
    } as Record<SituationStatus, SituationAction[]>)[status];
  }
  if (workspace === 'client') {
    return ({
      submitted: ['start_review', 'request_revision'], under_review: ['validate_technical', 'request_revision', 'contest'],
      contested: ['request_revision'], validated_technical: ['request_revision', 'contest'], draft: [], revision_requested: [], withdrawn: [],
    } as Record<SituationStatus, SituationAction[]>)[status];
  }
  return opts.canComment && ['submitted', 'under_review', 'contested'].includes(status) ? ['manager_suggestion'] : [];
}

/** Intervention du carnet de chantier telle que renvoyée par l’API du carnet (quantité facultative). */
export type JournalIntervention = { id: string; kind: string; award_item_id: string; work_date?: string | null; created_at: string;
  quantity?: { executed_quantity_milli: number | string; unit?: string | null; quote_line_id?: string | null; designation?: string | null } | null };

/**
 * Interventions rattachables à une ligne : même lot, même unité (et même poste du devis s’il est choisi), quantité renseignée,
 * date des travaux dans la période et non déjà rattachées à une autre ligne. Le serveur revérifie tout et exige la somme exacte.
 */
export function attachableInterventions(events: JournalIntervention[], line: { awardItemId: string; quoteLineId: string; unit: string },
  period: { start: string; end: string }, takenElsewhere: Set<string>): JournalIntervention[] {
  const unit = line.unit.trim();
  return events.filter(event => event.kind === 'intervention' && event.award_item_id === line.awardItemId && event.quantity
    && /^\d+$/.test(String(event.quantity.executed_quantity_milli)) && (!unit || (event.quantity.unit ?? '') === unit)
    && (!line.quoteLineId || event.quantity.quote_line_id === line.quoteLineId)
    && (!period.start || (event.work_date ?? '') >= period.start) && (!period.end || (event.work_date ?? '') <= period.end)
    && !takenElsewhere.has(event.id));
}

/** Somme exacte (BigInt) des quantités des interventions choisies, en milli-unités. */
export function sumMilli(events: JournalIntervention[]): string {
  return events.reduce((total, event) => total + BigInt(String(event.quantity?.executed_quantity_milli ?? 0)), BigInt(0)).toString();
}
