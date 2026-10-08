import { projectApi } from './collaboration';
export type BackofficeResult = { rows: any; admin: boolean; actor_id: string; offset: number; limit: number };
export function readBackoffice(view: string, filters: Record<string,string> = {}) { return projectApi<BackofficeResult>('/api/dao/backoffice?' + new URLSearchParams({view,...filters})); }
export function commandBackoffice(action: string, input: Record<string,unknown>, key = crypto.randomUUID()) { return projectApi('/api/dao/backoffice', { action, input, idempotency_key: key }); }
export const actionLabels: Record<string,string> = { review_submitted:'Dossier soumis',review_resubmitted:'Dossier resoumis',review_lot_withdrawn:'Lot retiré de la revue',review_claimed:'Revue prise en charge',review_reassigned:'Revue réaffectée',review_approved:'Revue approuvée',review_rejected:'Corrections demandées',staff_project_updated:'Nouvelle version préparée',lot_created:'Lot créé',lot_updated:'Lot modifié',sub_lot_versioned:'Sous-lot versionné',publication_lot_withdrawn:'Lot retiré de la publication',publication_created:'Publication créée',assisted_award:'Attribution pour le compte du client',assisted_cancel:'Annulation pour le compte du client',award_confirmed:'Attribution confirmée',award_cancelled:'Attribution annulée',professional_verify:'Professionnel vérifié',professional_reject:'Professionnel refusé',professional_suspend:'Professionnel suspendu',professional_reactivate:'Professionnel réactivé',professional_approve_identity:'Identité publique approuvée',professional_hide_identity:'Identité publique masquée',account_role:'Rôle modifié',account_account:'Compte modifié',staff_invited:'Staff invité' };
export const withdrawalReasons: Record<string,string> = { correction:'Correction du périmètre',publication_error:'Erreur de publication',client_request:'Demande du client',postponed:'Report',scope_change:'Changement de périmètre',premature:'Publication prématurée',other:'Autre' };

// Page through the existing authorized reader; never infer totals from its first page.
export async function readAllBackoffice(view: string, filters: Record<string, string> = {}) {
  const rows: any[] = [];
  for (let offset = 0; offset <= 100000; offset += 100) {
    const result = await readBackoffice(view, {...filters, offset: String(offset)});
    rows.push(...result.rows);
    if (result.rows.length < result.limit) return rows;
  }
  throw new Error('Trop de résultats : précisez les filtres.');
}
export const accountStatusLabels: Record<string,string> = {active:'Actif',suspended:'Suspendu'};
export const verificationLabels: Record<string,string> = {pending:'En attente',verified:'Vérifié',rejected:'Refusé',suspended:'Suspendu'};
export const identityLabels: Record<string,string> = {draft:'Brouillon',approved:'Approuvée',hidden:'Masquée'};
export const projectTypeLabels: Record<string,string> = {construction:'Construction',renovation:'Rénovation',repair:'Réparation',extension:'Extension',other:'Autre'};
export const noticeStatusLabels: Record<string,string> = {pending:'En attente',sending:'En cours',sent:'Envoyé',failed:'Échec'};
