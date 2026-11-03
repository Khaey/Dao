/**
 * #410 — Adaptateur de LECTURE entre le contrat serveur réel DEV 3 (#412)
 * et le tableau React. Pas de règles d'autorisation ou calculs métier ici.
 * Toutes les permissions doivent avoir été contrôlées dans le RPC JWT.
 */
import type {
  NativeExecutionPlanDTO,
  NativeExecutionLotDTO,
} from '../../../dao-backend/src/native-tracking/contract';

type NativeSubLot = NativeExecutionLotDTO['executionSubLots'][number];
type NativeDate = { start: string | null; end: string | null };

export interface ExecutionTableNode {
  id: string;
  title: string;
  progress: number | null;
  progressAt: string | null;
  progressStatus: string | null;
  dates: NativeDate | null;
  dateSource: string | null;
  /** Dates constatées au carnet, affichées SOUS la référence, jamais à sa place. */
  observed: NativeDate | null;
  /** Écart de début constaté − référence, en jours calendaires (positif = retard). */
  startVarianceDays: number | null;
}

export interface ExecutionTableLot extends ExecutionTableNode {
  requestId: string;
  awardId: string | null;
  awardItemId: string | null;
  contractor: string | null;
  status: string;
  subLots: ExecutionTableNode[];
  subLotCount: number;
  milestoneCount: number;
  dependencyCount: number;
  installmentCount: number;
  installmentInformational: boolean;
  canRead: boolean;
  canPrepareChange: boolean;
  canDeclareProgress: boolean;
  canReviewProgress: boolean;
  canAcceptEngagingChange: boolean;
  canEditActivities: boolean;
  agreementVersionId: string | null;
  hasProposedDates: boolean;
  hasAgreedDates: boolean;
  hasPlanDates: boolean;
  hasObservedDates: boolean;
}

function exists(date: { start?: string | null; end?: string | null } | null | undefined) {
  return Boolean(date && (date.start != null || date.end != null));
}

const DAY_MS = 86_400_000;
const dayOf = (value: string) => Math.floor(Date.parse(value.slice(0, 10) + 'T00:00:00Z') / DAY_MS);
/** Fin déduite d'une durée enregistrée (jours calendaires inclusifs), comme le Gantt et le moteur natif. */
function endFromDuration(start: string | null, days: number | null | undefined): string | null {
  if (!start || days == null || !Number.isInteger(days) || days < 1 || !Number.isFinite(dayOf(start))) return null;
  return new Date((dayOf(start) + days - 1) * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Référence d'affichage (décision propriétaire 03/11, #175) : l'engagement convenu prime,
 * puis le plan enregistré, puis le devis. Les dates constatées ne remplacent jamais la
 * référence : elles sont rendues à part avec l'écart, sans effet juridique ni financier.
 */
function lotDates(lot: NativeExecutionLotDTO): { dates: NativeDate | null; source: string | null } {
  const agreed = lot.dates.agreed;
  if (exists(agreed)) return { dates: { start: agreed!.start, end: endFromDuration(agreed!.start, agreed!.durationDays) }, source: 'Convenues' };
  if (exists(lot.dates.plan)) return { dates: lot.dates.plan, source: 'Plan actuel (non contractuel)' };
  if (exists(lot.dates.proposed)) return { dates: lot.dates.proposed, source: 'Proposées au devis' };
  return { dates: null, source: null };
}

function startVariance(reference: NativeDate | null, observed: NativeDate | null): number | null {
  if (!reference?.start || !observed?.start) return null;
  const diff = dayOf(observed.start) - dayOf(reference.start);
  return Number.isFinite(diff) ? diff : null;
}

function subLotDates(sub: NativeSubLot): { dates: NativeDate | null; source: string | null } {
  if (exists(sub.agreedDates)) return { dates: sub.agreedDates, source: 'Convenues' };
  if (exists(sub.proposedDates)) return { dates: sub.proposedDates, source: 'Proposées au devis' };
  return { dates: null, source: null };
}

export function adaptNativeExecutionPlan(plan: NativeExecutionPlanDTO): ExecutionTableLot[] {
  if (plan.schemaVersion !== 1) throw new Error('Version de suivi non prise en charge.');
  // DEV 3 N1: modalités sur lot. DEV 3 N2 (#413): modalités normalisées par award.
  // Accepte les deux contrats sans recomputer ou dupliquer les échéances.
  type AgreementProjection = {
    awardId: string; agreementVersionId: string;
    installments?: Array<unknown>; informationalOnly?: boolean; moneyMoved?: boolean;
  };
  const n2 = plan as NativeExecutionPlanDTO & { agreementsByAward?: AgreementProjection[] };
  return plan.lots.filter(lot => lot.permissions.canRead).map(lot => {
    const inline = lot.modalities as AgreementProjection | null;
    const shared = n2.agreementsByAward?.find(row => row.awardId === lot.award?.awardId);
    const modalities = shared ?? inline;
    const selected = lotDates(lot);
    const observed = exists(lot.dates.observed) ? { start: lot.dates.observed!.start, end: lot.dates.observed!.end } : null;
    return {
      id: lot.requestId,
      requestId: lot.requestId,
      title: lot.title?.trim() || 'Lot sans intitulé',
      status: lot.status,
      awardId: lot.award?.awardId ?? null,
      awardItemId: lot.award?.awardItemId ?? null,
      contractor: lot.award?.contractorName ?? null,
      progress: lot.progress?.percent ?? null, // le zéro DECLARÉ reste un vrai 0
      progressAt: lot.progress?.at ?? null,
      progressStatus: lot.progress?.status ?? null,
      dates: selected.dates,
      dateSource: selected.source,
      observed,
      startVarianceDays: startVariance(selected.dates, observed),
      subLots: lot.executionSubLots.map(sub => {
        const subDate = subLotDates(sub);
        return {
          id: sub.id,
          title: sub.title,
          progress: sub.progress?.percent ?? null,
          progressAt: sub.progress?.at ?? null,
          progressStatus: sub.progress?.status ?? null,
          dates: subDate.dates,
          dateSource: subDate.source,
          observed: null,
          startVarianceDays: null,
        };
      }),
      subLotCount: lot.executionSubLots.length,
      milestoneCount: lot.milestones.length,
      dependencyCount: lot.dependencies.length,
      installmentCount: modalities?.installments?.length ?? 0,
      installmentInformational: modalities?.informationalOnly === true && modalities.moneyMoved === false,
      agreementVersionId: modalities?.agreementVersionId ?? lot.dates.agreed?.versionId ?? null,
      canRead: lot.permissions.canRead,
      canPrepareChange: lot.permissions.canPrepareChange,
      canDeclareProgress: lot.permissions.canDeclareProgress,
      canReviewProgress: lot.permissions.canReviewProgress,
      canAcceptEngagingChange: lot.permissions.canAcceptEngagingChange,
      canEditActivities: lot.permissions.canEditActivities,
      hasProposedDates: exists(lot.dates.proposed),
      hasAgreedDates: exists(lot.dates.agreed),
      hasPlanDates: exists(lot.dates.plan),
      hasObservedDates: exists(lot.dates.observed),
    };
  });
}

/** Aucun re-filtrage de rôle côté navigateur : le serveur ne renvoie que les lots autorisés. */
export const workspaceLabels: Record<NativeExecutionPlanDTO['viewer']['workspace'], string> = {
  client: 'Client', contractor: 'Artisan', dao_manager: 'Gestionnaire',
};
