'use client';
import { supabaseBrowser } from './supabase-browser';

// Verified Client reviews (#213). Every call goes through the RPCs, which recheck
// eligibility, publication and moderation server-side; the UI only mirrors the rules.

export type ReviewCriteria = { quality: number | null; deadlines: number | null; budget: number | null; communication: number | null; cleanliness: number | null };
export type PublicReview = {
  id: string; rating: number; criteria: ReviewCriteria; comment: string; author: string;
  governorate: string | null; month: string; edited: boolean; response: { body: string; created_at: string } | null;
};
export type RatingSummary = {
  average: number | null; count: number; distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
  criteria: Record<keyof ReviewCriteria, number | null>;
};
export type OwnReview = {
  id: string; status: 'published' | 'hidden' | 'withdrawn'; rating: number; criteria: ReviewCriteria; comment: string;
  created_at: string; edited_at: string | null; hidden_reason: string | null;
};
export type ReviewOpportunity = {
  project_id: string; project_title: string | null; project_stage: string;
  contractor_id: string; contractor_name: string; review: OwnReview | null;
};
export type ReviewInput = { rating: number; comment: string } & Partial<Record<keyof ReviewCriteria, number | null>>;

export const criteriaLabels: Record<keyof ReviewCriteria, string> = {
  quality: 'Qualité du travail',
  deadlines: 'Respect des délais',
  budget: 'Respect du budget',
  communication: 'Communication',
  cleanliness: 'Propreté du chantier',
};
export const criteriaKeys = Object.keys(criteriaLabels) as Array<keyof ReviewCriteria>;
export const COMMENT_MIN = 30;
export const COMMENT_MAX = 2000;

/** Mirrors dao_private.contains_contact (server stays authoritative) for an early, friendlier message. */
export function containsContact(input: string) {
  const t = input.toLowerCase()
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\uff10-\uff19]/g, (d) => String(d.charCodeAt(0) - 0xff10))
    .replace(/[\u00a0\u202f\u2007]/g, ' ').replace(/\uff20/g, '@').replace(/\uff0e/g, '.')
    .replace(/[\u200b-\u200d\u2060\ufeff\u00ad]/g, '');
  return /[0-9]{8,}/.test(t)
    || /(^|[^0-9])[0-9]{2}[ .()_-]*[0-9]{3}[ .()_-]*[0-9]{3}([^0-9]|$)/.test(t)
    || /(^|[^0-9])[0-9]{2}([ .()_-]+[0-9]{2}){3}([^0-9]|$)/.test(t)
    || /(\+|(^|[^0-9])00) *[0-9][0-9 .()_-]{6,}/.test(t)
    || /[^\s@]+ *@ *[^\s@]+\.[a-z]{2,}/.test(t)
    || /(^|[\s(])@[a-z0-9_.]{3,}/.test(t)
    || /(https?:|www\.|\barobase\b)/.test(t)
    || /[a-z0-9-]{2,} *\. *(tn|com|net|org|fr|me|io|info|biz|co|app|site|online|shop|store|pro|tech|link|ly)([^a-z0-9]|$)/.test(t)
    || /(^|[^a-z0-9])(wa|t) *\. *me([^a-z0-9]|$)/.test(t);
}

const reviewErrors: Record<string, string> = {
  '42501': 'Action non autorisée pour cet avis.',
  '23505': 'Un avis existe déjà pour ce chantier et ce professionnel.',
};
async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabaseBrowser().rpc(name, args);
  if (error) throw new Error(error.code === '22023' ? error.message : reviewErrors[error.code] ?? 'Opération indisponible. Réessayez.');
  return data as T;
}

export const formatRating = (value: number | string | null | undefined) =>
  value == null ? '–' : Number(value).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const reviewCount = (count: number) => `${count} avis`;
export function formatReviewMonth(month: string) {
  const [year, value] = month.split('-').map(Number);
  if (!year || !value) return month;
  return new Date(year, value - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

export const professionalReviews = (contractorId: string, limit = 10, offset = 0) =>
  call<{ summary: RatingSummary | null; items: PublicReview[] }>('professional_reviews', { p_contractor_id: contractorId, p_limit: limit, p_offset: offset });
export const myReviewOpportunities = () => call<ReviewOpportunity[]>('my_review_opportunities');
export const submitReview = (projectId: string, contractorId: string, input: ReviewInput) =>
  call<{ id: string; status: OwnReview['status']; edited: boolean }>('submit_contractor_review', { p_project_id: projectId, p_contractor_id: contractorId, p_input: input });
export const withdrawReview = (reviewId: string) => call<{ id: string; status: 'withdrawn' }>('withdraw_contractor_review', { p_review_id: reviewId });

// Professional (R4) and staff (R5) views.
export type ReceivedReview = PublicReview & {
  status: 'published' | 'hidden'; response_status: 'published' | 'hidden' | null;
  response_editable_until: string | null; report_status: 'open' | 'dismissed' | 'actioned' | null;
};
export type ModerationItem = PublicReview & {
  status: 'published' | 'hidden' | 'withdrawn'; hidden_reason: string | null; project_id: string; contractor_id: string;
  contractor_name: string; author_name: string | null; response_status: 'published' | 'hidden' | null;
  project_origin: string | null; author_since: string | null; edited_since_hidden?: boolean; open_reports?: number;
  reports: Array<{ reason: string; details: string; status: 'open' | 'dismissed' | 'actioned'; created_at: string }>;
};
export type ModerationAction = 'hide' | 'restore' | 'dismiss_reports' | 'hide_response' | 'restore_response';
export const reportReasons: Record<string, string> = {
  insult: 'Propos injurieux', personal_data: 'Données personnelles', off_topic: 'Hors sujet', fake: 'Chantier inexistant / faux avis', other: 'Autre',
};

export const myReceivedReviews = () => call<ReceivedReview[]>('my_received_reviews');
export const respondToReview = (reviewId: string, body: string) => call<{ review_id: string; status: string }>('respond_to_contractor_review', { p_review_id: reviewId, p_body: body });
export const reportReview = (reviewId: string, reason: string, details: string) =>
  call<{ id?: string; status: 'open' | 'already_reviewed' }>('report_contractor_review', { p_review_id: reviewId, p_reason: reason, p_details: details });
export const moderationQueue = () => call<ModerationItem[]>('review_moderation_queue');
export const moderateReview = (reviewId: string, action: ModerationAction, reason: string | null) =>
  call<{ id: string; action: ModerationAction }>('moderate_contractor_review', { p_review_id: reviewId, p_action: action, p_reason: reason });
export type ModerationFilter = 'reported' | 'edited' | 'hidden' | 'all';
export const moderationPage = (filter: ModerationFilter, limit = 30, offset = 0) =>
  call<{ total: number; items: ModerationItem[] }>('review_moderation_page', { p_filter: filter, p_limit: limit, p_offset: offset });
