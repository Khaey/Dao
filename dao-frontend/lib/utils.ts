import { clsx, type ClassValue } from 'clsx'; import { twMerge } from 'tailwind-merge';
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
export const statusLabel:Record<string,string>={draft:'Brouillon',client_review:'En attente de validation D.A.O.',dao_review:'Revue DAO',approved:'Prêt à publier',rejected:'Corrections demandées',open:'Ouvert',closed:'Clôturé',archived:'Archivé',withdrawn:'Retiré',published:'Publié',suspended:'Suspendu'};
// Once a chantier is published/closed, its lifecycle wins over an approved DAO version.
export function effectiveProjectStatus(projectStatus: string, latestVersionStatus?: string | null) {
  return ['open', 'published', 'closed', 'archived', 'suspended'].includes(projectStatus) ? projectStatus : latestVersionStatus ?? projectStatus;
}
// "open" is an active published chantier, not a dossier waiting for publication.
export function displayProjectStatus(status: string) { return status === 'open' ? 'published' : status; }
export function approvedVersionLabel(status?: string | null, versionNo?: number | null) {
  return status === 'approved' && versionNo != null ? `Version ${versionNo} approuvée` : null;
}

export const publicationStatusLabel: Record<string, string> = { ...statusLabel, superseded: 'Remplacée' };
export const publicationVisibilityLabel: Record<string, string> = { public: 'Public', targeted: 'Ciblé', invite_only: 'DAO sur invitation' };
