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

/** Same contact-detail rule as dao_private.review_text, checked early for a friendlier message. */
export function containsContact(text: string) {
  return /[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(text) || /\+[0-9][0-9 .()-]{7,}/.test(text)
    || /(^|[^0-9])[0-9]{8,}([^0-9]|$)/.test(text) || /(https?:\/\/|www\.)/i.test(text);
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
