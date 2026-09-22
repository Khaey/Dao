import { clsx, type ClassValue } from 'clsx'; import { twMerge } from 'tailwind-merge';
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
export const statusLabel:Record<string,string>={draft:'Brouillon',client_review:'Validation client',dao_review:'Revue DAO',approved:'Prêt à publier',rejected:'Corrections demandées',open:'Ouvert',closed:'Clôturé',archived:'Archivé',withdrawn:'Retiré',published:'Publié',suspended:'Suspendu'};
