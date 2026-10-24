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
  activities: { supported: false; items: [] };
  forecast: null;
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
  modalities: null | {
    awardId: string; agreementVersionId: string; status: string; acceptedByBoth: boolean;
    paymentMode: string | null;
    installments: Array<{ number: number; label: string; dueDate: string | null; amountMillimes: string; latestState: string }>;
    informationalOnly: true; moneyMoved: false;
  };
}
