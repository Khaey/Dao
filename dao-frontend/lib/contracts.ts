import { projectApi } from './collaboration';

export type ContractParty = { role: 'client' | 'contractor' | 'dao'; legal_name: string };
export type ContractSummary = {
  id: string; project_id: string; status: string; total_millimes: number; created_at: string;
  validated_at: string | null; legal_effect_enabled: boolean; non_engaging: boolean;
  parties: ContractParty[]; item_count: number; amendment_count: number;
};
export type ContractEvent = { id: string; event_type: string; from_status: string | null; to_status: string | null; reason: string | null; created_at: string };
export type ContractAmendment = {
  id: string; status: string; created_at: string; validated_at: string | null;
  validation_reason: string | null; rejected_at: string | null; rejection_reason: string | null;
  cancelled_at: string | null; cancellation_reason: string | null; non_engaging: boolean;
  proposal: { version_no: number; content_hash: string; reason: string | null; scope_clarification: string | null; amount_delta_millimes: number | null; base_total_millimes: number | null; proposed_total_millimes: number | null; planned_start_date: string | null; duration_days: number | null; non_engaging: boolean };
  acceptances: { party_role: string; method: string; accepted_at: string }[];
  events: ContractEvent[];
};
export type ContractDetail = {
  contract: ContractSummary & { award_id: string; current_version_id: string; signature_mode: string; cancellation_reason: string | null };
  version: { id: string; version_no: number; content_hash: string; created_at: string } | null;
  items: { id: string; agreed_millimes: number; title: string; scope: string; duration_days: number; inclusions: string; exclusions: string | null }[];
  parties: ContractParty[];
  acceptances: { party_role: string; method: string; accepted_at: string }[];
  events: ContractEvent[];
  archives: { id: string; original_name: string; mime_type: string; size_bytes: number; content_hash: string; created_at: string }[];
  amendments: ContractAmendment[];
};

export const contractStatus: Record<string, string> = {
  draft: 'Brouillon technique', review: 'En revue', ready: 'Contrôlé par D.A.O',
  awaiting_signatures: 'Accords techniques en attente', cancelled: 'Annulé', signed: 'État juridique non activé',
};
export const amendmentStatus: Record<string, string> = {
  awaiting_acceptances: 'Accords en attente', accepted: 'Contrôlée par D.A.O', rejected: 'Refusée', cancelled: 'Annulée',
};
export const roleLabel: Record<string, string> = { client: 'Client', contractor: 'Prestataire', dao: 'D.A.O' };
export const formatTnd = (value: number | null | undefined) => new Intl.NumberFormat('fr-TN', { style: 'currency', currency: 'TND', maximumFractionDigits: 3 }).format(Number(value ?? 0) / 1000);
export const formatDate = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('fr-TN', { dateStyle: 'medium' }).format(new Date(value)) : 'Non renseignée';
export const listContracts = () => projectApi<ContractSummary[]>('/api/contracts');
export const readContract = (id: string) => projectApi<ContractDetail>(`/api/contracts/${encodeURIComponent(id)}`);
