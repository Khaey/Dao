import { randomUUID } from 'node:crypto';
import { DomainError } from '../lib/errors.js';

const allowedMime = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
// #464 : DWG accepté pour les plans de chantier uniquement, stocké privé et jamais prévisualisé.
export const DWG_MIME = 'image/vnd.dwg';
const projectMime = [...allowedMime, DWG_MIME];
const maxBytes = 20 * 1024 * 1024;

function assertFile(mimeType: string, sizeBytes: number, allowed: string[] = allowedMime) {
  if (!allowed.includes(mimeType)) throw new DomainError('MIME type not allowed', 'INVALID_MIME');
  if (!Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > maxBytes) {
    throw new DomainError('File too large', 'INVALID_SIZE');
  }
}

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 120) || 'document';
}

export class DocumentService {
  constructor(private readonly db: any, private readonly storage: any) {}

  async get(id: string) {
    const { data, error } = await this.db.from('bid_documents').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
  }

  async signedDownload(id: string, expiresIn = 300) {
    const doc = await this.get(id);
    if (doc.status !== 'approved') throw new DomainError('Document is not approved', 'DOCUMENT_NOT_APPROVED');
    const { data, error } = await this.storage.from('dao-private').createSignedUrl(doc.object_path, expiresIn);
    if (error) throw error;
    return data.signedUrl;
  }

  async signedUploadForActor(actorId: string, input: { bidVersionId: string; originalName: string; mimeType: string; sizeBytes: number }) {
    if (!actorId) throw new DomainError('Authentication required', 'UNAUTHENTICATED');
    assertFile(input.mimeType, input.sizeBytes);
    if (input.mimeType !== 'application/pdf' || !input.originalName.toLowerCase().endsWith('.pdf')) {
      throw new DomainError('A PDF quote is required', 'INVALID_MIME');
    }
    const { data: version, error: versionError } = await this.db
      .from('bid_versions')
      .select('id,contractor_id,status,contractor_profiles!inner(user_id)')
      .eq('id', input.bidVersionId)
      .single();
    if (versionError) throw versionError;
    const contractor = Array.isArray(version?.contractor_profiles) ? version.contractor_profiles[0] : version?.contractor_profiles;
    if (!version || contractor?.user_id !== actorId || version.status !== 'draft') {
      throw new DomainError('Upload is not authorized', 'FORBIDDEN');
    }
    const path = `bid/${input.bidVersionId}/${randomUUID()}-${safeName(input.originalName)}`;
    const { data: document, error: documentError } = await this.db.rpc('create_bid_quote_document', {
      p_version_id: input.bidVersionId,
      p_object_path: path,
      p_original_name: input.originalName,
      p_size_bytes: input.sizeBytes,
    });
    if (documentError) throw documentError;
    const { data, error } = await this.storage.from('dao-private').createSignedUploadUrl(path);
    if (error) throw error;
    return { document, path, token: data.token };
  }

  async completeBidQuoteUpload(actorId: string, documentId: string) {
    if (!actorId) throw new DomainError('Authentication required', 'UNAUTHENTICATED');
    const { data: document, error } = await this.db.from('bid_documents').select('*').eq('id', documentId).single();
    if (error || !document || document.status !== 'quarantined') throw new DomainError('Document access denied', 'FORBIDDEN');
    const { data: blob, error: downloadError } = await this.storage.from('dao-private').download(document.object_path);
    if (downloadError || !blob) throw new DomainError('Uploaded PDF cannot be verified', 'INVALID_PDF');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const signature = new TextDecoder().decode(bytes.slice(0, 5));
    if (bytes.byteLength !== Number(document.size_bytes) || signature !== '%PDF-') {
      await this.storage.from('dao-private').remove([document.object_path]);
      await this.db.rpc('delete_owned_bid_quote_document', { p_document_id: documentId });
      throw new DomainError('The uploaded file is not a valid PDF', 'INVALID_PDF');
    }
    const approved = await this.db.rpc('approve_owned_bid_quote_document', { p_document_id: documentId });
    if (approved.error) throw approved.error;
    return approved.data;
  }

  async deleteBidQuote(actorId: string, documentId: string) {
    if (!actorId) throw new DomainError('Authentication required', 'UNAUTHENTICATED');
    const { data, error } = await this.db.rpc('delete_owned_bid_quote_document', { p_document_id: documentId });
    if (error) throw error;
    if (data?.object_path) await this.storage.from('dao-private').remove([data.object_path]);
    return data;
  }

  async signedDownloadForActor(actorId: string, id: string, expiresIn = 300) {
    if (!actorId) throw new DomainError('Authentication required', 'UNAUTHENTICATED');
    const { data: doc, error } = await this.db.from('bid_documents').select('*').eq('id', id).single();
    if (error || !doc) throw new DomainError('Document access denied', 'FORBIDDEN');
    if (doc.status !== 'approved') throw new DomainError('Document is not approved', 'DOCUMENT_NOT_APPROVED');
    // RLS on bid_documents is the authorization source. document_grants is
    // intentionally not consulted for offer attachments.
    const { data: signed, error: signedError } = await this.storage.from('dao-private').createSignedUrl(doc.object_path, expiresIn);
    if (signedError) throw signedError;
    return signed.signedUrl;
  }

  async listProjectDocuments(projectId: string) {
    const { data, error } = await this.db.from('documents').select('id,project_id,owner_id,object_path,original_name,mime_type,size_bytes,status,share_scope,created_at').eq('project_id', projectId).order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async signedProjectUpload(input: { projectId: string; originalName: string; mimeType: string; sizeBytes: number; shareScope?: string }) {
    assertFile(input.mimeType, input.sizeBytes, projectMime);
    if (input.mimeType === DWG_MIME && !String(input.originalName ?? '').toLowerCase().endsWith('.dwg')) {
      throw new DomainError('MIME type not allowed', 'INVALID_MIME');
    }
    if (input.shareScope != null && !['owner_only','project_members'].includes(input.shareScope)) {
      throw new DomainError('Partage du document invalide', 'BAD_REQUEST');
    }
    const path = 'project/' + input.projectId + '/' + randomUUID() + '-' + safeName(input.originalName);
    const { data: document, error: documentError } = await this.db.rpc('create_project_document', {
      p_project_id: input.projectId,
      p_object_path: path,
      p_original_name: input.originalName,
      p_mime_type: input.mimeType,
      p_size_bytes: input.sizeBytes,
    });
    if (documentError) throw documentError;
    if (input.shareScope === 'project_members') await this.setProjectSharing(document.id, 'project_members');
    const { data: signed, error: signedError } = await this.storage.from('dao-private').createSignedUploadUrl(path);
    if (signedError) throw signedError;
    return { document, path, token: signed.token };
  }

  async setProjectSharing(documentId: string, shareScope: string) {
    if (!['owner_only','project_members'].includes(shareScope)) throw new DomainError('Partage du document invalide', 'BAD_REQUEST');
    const { data, error } = await this.db.rpc('set_project_document_sharing', { p_document_id: documentId, p_share_scope: shareScope });
    if (error) throw error;
    return data;
  }

  async signedProjectDownload(documentId: string, expiresIn = 300) {
    const { data: document, error } = await this.db
      .from('documents')
      .select('id,project_id,owner_id,object_path,original_name,mime_type,size_bytes,status')
      .eq('id', documentId)
      .single();
    if (error || !document) throw new DomainError('Document access denied', 'FORBIDDEN');
    // The JWT-scoped query above is the authorization check. Project owners
    // may consult their own files while they are pending or rejected; RLS
    // deliberately grants the owner visibility for every validation status.
    // Other users only receive rows when the existing RLS policy authorizes
    // them, so the privileged Storage client is used only after that check.
    // A DWG is always served as an attachment: no browser rendering of CAD content.
    const options = document.mime_type === DWG_MIME ? { download: safeName(document.original_name) } : undefined;
    const { data: signed, error: signedError } = await this.storage.from('dao-private').createSignedUrl(document.object_path, expiresIn, options);
    if (signedError) throw signedError;
    return signed.signedUrl;
  }

  async deleteProjectDocument(documentId: string) {
    const { data, error } = await this.db.rpc('delete_project_document', { p_document_id: documentId });
    if (error) throw error;
    if (data?.object_path) await this.storage.from('dao-private').remove([data.object_path]);
    return data;
  }
}
