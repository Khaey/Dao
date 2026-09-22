import { randomUUID } from 'node:crypto';
import { DomainError } from '../lib/errors.js';

const allowedMime = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const maxBytes = 20 * 1024 * 1024;

function assertFile(mimeType: string, sizeBytes: number) {
  if (!allowedMime.includes(mimeType)) throw new DomainError('MIME type not allowed', 'INVALID_MIME');
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

  async signedUploadForActor(actorId: string, input: { bidVersionId: string; path: string; mimeType: string; sizeBytes: number }) {
    if (!actorId) throw new DomainError('Authentication required', 'UNAUTHENTICATED');
    assertFile(input.mimeType, input.sizeBytes);
    if (!input.path.startsWith('bid/' + input.bidVersionId + '/')) throw new DomainError('Invalid storage namespace', 'INVALID_PATH');
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
    const { data, error } = await this.storage.from('dao-private').createSignedUploadUrl(input.path);
    if (error) throw error;
    return { path: input.path, token: data.token };
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
    const { data, error } = await this.db.from('documents').select('id,project_id,owner_id,object_path,original_name,mime_type,size_bytes,status,created_at').eq('project_id', projectId).order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async signedProjectUpload(input: { projectId: string; originalName: string; mimeType: string; sizeBytes: number }) {
    assertFile(input.mimeType, input.sizeBytes);
    const path = 'project/' + input.projectId + '/' + randomUUID() + '-' + safeName(input.originalName);
    const { data: document, error: documentError } = await this.db.rpc('create_project_document', {
      p_project_id: input.projectId,
      p_object_path: path,
      p_original_name: input.originalName,
      p_mime_type: input.mimeType,
      p_size_bytes: input.sizeBytes,
    });
    if (documentError) throw documentError;
    const { data: signed, error: signedError } = await this.storage.from('dao-private').createSignedUploadUrl(path);
    if (signedError) throw signedError;
    return { document, path, token: signed.token };
  }

  async signedProjectDownload(documentId: string, expiresIn = 300) {
    const { data: document, error } = await this.db
      .from('documents')
      .select('id,project_id,owner_id,object_path,original_name,mime_type,size_bytes,status')
      .eq('id', documentId)
      .single();
    if (error || !document) throw new DomainError('Document access denied', 'FORBIDDEN');
    if (document.status !== 'approved') throw new DomainError('Document is not approved', 'DOCUMENT_NOT_APPROVED');
    const { data: signed, error: signedError } = await this.storage.from('dao-private').createSignedUrl(document.object_path, expiresIn);
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
