import { Lock, UserCheck, UserPlus, type LucideIcon } from 'lucide-react';

// Who handles a review, from the assignment the server already returns (review_assignments.reviewer_id).
// Display only: permissions stay server-side (manages_project / claim_review).
export type Assignment = 'unassigned' | 'mine' | 'other';
export const assignmentOf = (reviewerId: string | null | undefined, viewerId: string | null | undefined): Assignment =>
  !reviewerId ? 'unassigned' : reviewerId === viewerId ? 'mine' : 'other';

const styles: Record<Assignment, { label: string; className: string; icon: LucideIcon }> = {
  unassigned: { label: 'À prendre en charge', className: 'bg-clay/10 text-clay', icon: UserPlus },
  mine: { label: 'Vous', className: 'bg-teal/10 text-teal', icon: UserCheck },
  other: { label: 'Autre gestionnaire', className: 'bg-black/[0.06] text-black/60', icon: Lock },
};

/** Compact assignment chip. `name` is shown for another reviewer when known. */
export function AssignmentBadge({ state, name }: { state: Assignment; name?: string | null }) {
  const { label, className, icon: Icon } = styles[state];
  return <span className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}>
    <Icon aria-hidden="true" size={13} className="shrink-0" />
    <span className="truncate">{state === 'other' && name ? name : label}</span>
  </span>;
}

/** Review states still waiting for a D.A.O. decision. */
export const pendingReview = (status?: string | null) => status === 'client_review' || status === 'dao_review';

/** Queue wording: a client-submitted dossier is « Nouveau » until a reviewer starts it. */
export const reviewStatusLabel: Record<string, string> = { client_review: 'Nouveau dossier', dao_review: 'Revue DAO' };

const lastListKey = 'dao:last-review-list';
/** Remembers the list (with its filters) a reviewer opened a dossier from, for a faithful « retour ». */
export function rememberList(href: string) { try { sessionStorage.setItem(lastListKey, href); } catch { /* storage unavailable */ } }
export function lastList(): { href: string; label: string } {
  let href = '';
  try { href = sessionStorage.getItem(lastListKey) || ''; } catch { /* storage unavailable */ }
  if (!href.startsWith('/app/dao/')) href = '/app/dao/projects';
  return { href, label: href.startsWith('/app/dao/review') ? 'Revues' : 'Chantiers' };
}

export const formatTnd = (value?: number | string | null) => value == null || value === '' ? 'Non renseigné'
  : new Intl.NumberFormat('fr-TN', { style: 'currency', currency: 'TND', maximumFractionDigits: 3 }).format(Number(value) / 1000);
export const formatDate = (value?: string | null) => value ? new Date(value).toLocaleString('fr-TN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
