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

/** Priorité d'affichage pour la maquette seulement : source explicitée, jamais baseline implicite. */
function lotDates(lot: NativeExecutionLotDTO): { dates: NativeDate | null; source: string | null } {
  if (exists(lot.dates.observed)) return { dates: lot.dates.observed, source: 'Observées' };
  if (exists(lot.dates.plan)) return { dates: lot.dates.plan, source: 'Plan actuel (non contractuel)' };
  if (exists(lot.dates.agreed)) return { dates: lot.dates.agreed ? { start: lot.dates.agreed.start, end: null } : null, source: 'Convenues' };
  if (exists(lot.dates.proposed)) return { dates: lot.dates.proposed, source: 'Proposées au devis' };
  return { dates: null, source: null };
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
