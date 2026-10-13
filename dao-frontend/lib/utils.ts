import { clsx, type ClassValue } from 'clsx'; import { twMerge } from 'tailwind-merge';
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
export const statusLabel:Record<string,string>={draft:'Brouillon',client_review:'Validation client',dao_review:'Revue DAO',approved:'Prêt à publier',rejected:'Corrections demandées',open:'Ouvert',closed:'Clôturé',archived:'Archivé',withdrawn:'Retiré',published:'Publié',suspended:'Suspendu'};
export function effectiveProjectStatus(projectStatus: string, latestVersionStatus?: string | null) { return projectStatus === 'archived' ? 'archived' : latestVersionStatus ?? projectStatus; }

export const publicationStatusLabel: Record<string, string> = { ...statusLabel, superseded: 'Remplacée' };
export const publicationVisibilityLabel: Record<string, string> = { public: 'Public', targeted: 'Ciblé', invite_only: 'DAO sur invitation' };
