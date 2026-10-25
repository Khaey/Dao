import type { NativeForecast } from './planning.js';

export type NativeExecutionWorkspace = 'client' | 'contractor' | 'dao_manager';

export interface NativeExecutionPlanDTO {
  schemaVersion: 1;
  projectId: string;
  generatedAt: string;
  viewer: { workspace: NativeExecutionWorkspace };
  sourceRevisions: {
    plan: number | null;
    executionCursor: { createdAt: string; eventId: string } | null;
  };
  page: { limit: number; nextCursor: string | null };
  lots: NativeExecutionLotDTO[];
  agreementsByAward: NativeExecutionAgreementDTO[];
  activities: { supported: boolean; items: NativeExecutionActivityDTO[]; truncated: boolean };
  dependencies: Array<{ id: string; from: string; to: string; state: 'effective'; relation: 'FS'; lagDays: 0; source: 'manual' }>;
  changeProposals: NativeExecutionChangeProposalDTO[];
  changeProposalsTruncated: boolean;
  forecast: NativeForecast | null;
}

export interface NativeExecutionActivityDTO {
  id: string;
  requestId: string;
  awardItemId: string;
  parentActivityId: string | null;
  kind: 'sub_lot' | 'activity';
  title: string;
  scope: string | null;
  position: number;
  revision: number;
  active: boolean;
  createdBy: string;
  updatedBy: string;
  updatedAt: string;
  plannedDates: { start: string | null; end: string | null; durationDays: number | null; source: 'dao_native_execution' };
  execution: {
    progress: null | { eventId: string; percent: number; status: string; at: string; observation: unknown };
    observed: null | { start: string; end: string };
    quantities: Array<{ quoteLineId: string | null; unit: string; executedMilli: string; referenceMilli: string | null }>;
    milestones: Array<{ key: string; eventId: string; title: string; targetDate: string | null; status: string; at: string }>;
  };
  history: Array<{
    revision: number; action: 'created' | 'updated' | 'retired' | 'manager_change_accepted';
    title: string; scope: string | null; position: number; plannedStart: string | null;
    plannedEnd: string | null; durationDays: number | null; active: boolean; actorId: string; at: string;
  }>;
}

export interface NativeExecutionChangeProposalDTO {
  proposalId: string;
  requestId: string;
  awardItemId: string;
  proposedBy: string;
  activityId: string;
  action: 'create' | 'update' | 'retire';
  kind: 'sub_lot' | 'activity';
  title: string | null;
  scope: string | null;
  parentActivityId: string | null;
  position: number;
  plannedDates: { start: string | null; end: string | null; durationDays: number | null };
  state: 'pending_acceptance' | 'accepted' | 'rejected' | 'stale';
  createdAt: string;
  acceptedBy: Array<'client' | 'contractor'>;
}

export interface NativeExecutionAgreementDTO {
  awardId: string;
  agreementVersionId: string;
  status: string;
  acceptedByBoth: boolean;
  paymentMode: string | null;
  installments: Array<{
    number: number; label: string | null; dueDate: string | null; amountMillimes: string; latestState: string;
    scopeRef: null | { id: string; type: 'lot' | 'sub_lot' | 'milestone' | 'period' | 'project_end';
      awardItemId: string | null; subLotId: string | null; milestoneKey: string | null; periodStart: string | null; periodEnd: string | null };
    scopeProposal: null | { id: string; type: 'lot' | 'sub_lot' | 'milestone' | 'period' | 'project_end'; state: 'pending_acceptance';
      awardItemId: string | null; subLotId: string | null; milestoneKey: string | null; periodStart: string | null; periodEnd: string | null;
      acceptedBy: Array<'client' | 'contractor'> };
  }>;
  informationalOnly: true;
  moneyMoved: false;
}

export interface NativeExecutionLotDTO {
  requestId: string;
  requestVersionId: string | null;
  title: string | null;
  scope: string | null;
  status: string;
  award: null | {
    awardId: string;
    awardItemId: string;
    contractorId: string | null;
    contractorName: string | null;
  };
  permissions: {
    canRead: boolean;
    canPrepareChange: boolean;
    canDeclareProgress: boolean;
    canReviewProgress: boolean;
    canAcceptEngagingChange: boolean;
    canEditActivities: boolean;
  };
  dates: {
    proposed: null | { start: string | null; end: string | null; durationDays: number | null; source: 'winning_bid' };
    agreed: null | { versionId: string; start: string | null; durationDays: number | null; source: 'accepted_agreement' };
    plan: null | { start: string | null; end: string | null; state: string; revision: number; source: 'dao_lot_plan' };
    observed: null | { start: string; end: string; source: 'site_log' };
  };
  progress: null | {
    eventId: string; percent: number; status: string; at: string;
    observation: null | { outcome: string; reason: string | null; at: string };
  };
  quantities: Array<{ quoteLineId: string | null; unit: string; executedMilli: string; referenceMilli: string | null }>;
  officialSubLots: Array<{ id: string; versionId: string; title: string; scope: string }>;
  executionSubLots: Array<{
    id: string; nodeKey: string; officialSubLotId: string | null; title: string; scope: string | null; position: number;
    proposedDates: { start: string | null; end: string | null; durationDays: number | null };
    agreedDates: null | { agreementVersionId: string; start: string | null; end: string | null; durationDays: number | null };
    progress: null | { eventId: string; percent: number; status: string; at: string; observation: unknown };
    quantities: Array<{ quoteLineId: string | null; unit: string; executedMilli: string; referenceMilli: string | null }>;
  }>;
  milestones: Array<{ key: string; eventId: string; title: string; targetDate: string | null; status: string; at: string }>;
  dependencies: Array<{ id: string; from: string | null; to: string | null; state: string; relation: 'FS'; lagDays: 0; source: 'bid_proposal' | 'manual' }>;
  modalities: null | { awardId: string; agreementVersionId: string };
}
