import { projectApi } from '../../lib/collaboration';
import { supabaseBrowser } from '../../lib/supabase-browser';

/** Dossier documentaire V2 (#456) : DTO renvoyé par `document_dossier_v1`, filtré côté serveur. */
export type DossierDocument = { id: string; originalName: string; mimeType: string; sizeBytes: number; status: string };
export type DossierRevision = {
  id: string; revisionNo: number; note: string | null; createdAt: string; createdBy: string; createdByName: string | null;
  isCurrent: boolean; reviewStatus: ReviewStatus; correctionRequested: boolean; document: DossierDocument | null; fileStatus: string;
};
export type DossierEvent = { id: string; createdAt: string; revisionId: string | null; actorRole: string; actorName: string | null; kind: string; note: string | null };
export type DossierFamily = {
  id: string; title: string; category: Category | null; visibility: Visibility; version: number; createdAt: string; updatedAt: string;
  createdBy: string; createdByName: string | null; isMine: boolean; canAddRevision: boolean; currentRevisionId: string; currentRevisionNo: number;
  lots: { requestId: string; title: string | null }[]; revisions: DossierRevision[]; events: DossierEvent[];
};
export type Dossier = {
  projectId: string; requestId: string | null;
  actor: { isClient: boolean; isManager: boolean; isMember: boolean; heldRequestIds: string[]; canControlFiles: boolean; canReview: boolean };
  lots: { id: string; title: string | null; status: string }[];
  families: DossierFamily[];
};
export type Category = 'plan' | 'technical' | 'photo' | 'certificate' | 'other';
export type Visibility = 'private' | 'project' | 'lots';
export type ReviewStatus = 'to_review' | 'in_review' | 'observations' | 'reviewed' | 'superseded';
export type ReviewAction = 'start_review' | 'observations' | 'correction_requested' | 'reviewed' | 'comment';

export const categoryLabels: Record<Category, string> = { plan: 'Plan', technical: 'Pièce technique', photo: 'Photo', certificate: 'Attestation', other: 'Autre' };
export const visibilityLabels: Record<Visibility, string> = { private: 'Moi uniquement', project: 'Membres du chantier', lots: 'Lots sélectionnés' };
export const reviewLabels: Record<ReviewStatus, string> = { to_review: 'À consulter', in_review: 'En revue', observations: 'Observations émises', reviewed: 'Revu techniquement', superseded: 'Remplacé' };
export const reviewTones: Record<ReviewStatus, 'neutral' | 'teal' | 'clay' | 'red'> = { to_review: 'neutral', in_review: 'clay', observations: 'red', reviewed: 'teal', superseded: 'neutral' };
export const eventLabels: Record<string, string> = {
  family_created: 'Document classé', revision_added: 'Nouvelle version déposée', metadata_updated: 'Classement modifié',
  file_approved: 'Fichier contrôlé', file_rejected: 'Fichier refusé', start_review: 'Revue démarrée', observations: 'Observations émises',
  correction_requested: 'Correction demandée', reviewed: 'Revu techniquement', comment: 'Commentaire',
};
export const roleLabels: Record<string, string> = { author: 'Auteur', client: 'Client', manager: 'Gestionnaire', participant: 'Participant' };
export const mimeLabels: Record<string, string> = { 'application/pdf': 'PDF', 'image/jpeg': 'Image JPG', 'image/png': 'Image PNG', 'image/webp': 'Image WebP', 'image/vnd.dwg': 'Plan DWG' };
// #464 : plans DWG acceptés (stockés privés, téléchargés, jamais prévisualisés). Les navigateurs
// n'attribuent pas de type MIME aux .dwg : il est déduit de l'extension, le serveur revérifie.
export const DWG_MIME = 'image/vnd.dwg';
export const PROJECT_FILE_ACCEPT = '.pdf,image/jpeg,image/png,image/webp,.dwg';
export const isDwg = (mimeType: string) => mimeType === DWG_MIME;
export function projectFileMime(file: File) {
  return file.name.toLowerCase().endsWith('.dwg') ? DWG_MIME : file.type;
}
/** Envoi d'octets vers l'URL signée préparée par le serveur, avec le type déclaré. */
export async function uploadSignedProjectFile(path: string, token: string, file: File) {
  // Storage reads the type from the Blob itself (contentType is ignored for a File): a .dwg
  // usually arrives untyped or as application/octet-stream, so retype it before sending.
  const mime = projectFileMime(file);
  const body = file.type === mime ? file : new File([file], file.name, { type: mime });
  const result = await supabaseBrowser().storage.from('dao-private').uploadToSignedUrl(path, token, body, { contentType: mime });
  if (result.error) throw result.error;
}

export const idempotencyKey = () => `doc-${crypto.randomUUID()}`;
export const formatDateTime = (value?: string | null) => value ? new Intl.DateTimeFormat('fr-TN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '';

export function loadDossier(projectId: string, requestId?: string | null) {
  const query = new URLSearchParams({ project_id: projectId });
  if (requestId) query.set('request_id', requestId);
  return projectApi<Dossier>(`/api/documents/dossier?${query}`);
}
export function dossierCommand(body: Record<string, unknown>) {
  return projectApi('/api/documents/dossier', { ...body, idempotency_key: idempotencyKey() });
}
export function signedDocumentUrl(documentId: string) {
  return projectApi<string>('/api/documents/project/download', { document_id: documentId });
}

/** Dépôt privé existant (URL signée après contrôle JWT) : le fichier reste « Moi uniquement » et en contrôle. */
export async function uploadPrivateFile(projectId: string, file: File) {
  const data = await projectApi<{ document: { id: string }; path: string; token: string }>('/api/documents/project', {
    project_id: projectId, original_name: file.name, mime_type: projectFileMime(file), size_bytes: file.size, share_scope: 'owner_only',
  });
  await uploadSignedProjectFile(data.path, data.token, file);
  return data.document;
}

export function currentRevision(family: DossierFamily) {
  return family.revisions.find(revision => revision.isCurrent) ?? family.revisions[0];
}
