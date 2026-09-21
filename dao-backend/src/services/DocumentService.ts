import { DomainError } from '../lib/errors.js';
export class DocumentService {
  constructor(private readonly db: any, private readonly storage: any) {}
  async get(id: string) { const { data, error } = await this.db.from('bid_documents').select('*').eq('id',id).single(); if(error) throw error; return data; }
  async signedDownload(id: string, expiresIn = 300) {
    const doc = await this.get(id);
    if (doc.status !== 'approved') throw new DomainError('Document is not approved','DOCUMENT_NOT_APPROVED');
    const { data, error } = await this.storage.from('dao-private').createSignedUrl(doc.object_path, expiresIn);
    if (error) throw error; return data.signedUrl;
  }
  async signedUploadForActor(actorId: string, input: { bidVersionId: string; path: string; mimeType: string; sizeBytes: number }) {
    if (!actorId) throw new DomainError('Authentication required','UNAUTHENTICATED');
    const allowed = ['application/pdf','image/jpeg','image/png'];
    if (!allowed.includes(input.mimeType)) throw new DomainError('MIME type not allowed','INVALID_MIME');
    if (input.sizeBytes < 1 || input.sizeBytes > 20 * 1024 * 1024) throw new DomainError('File too large','INVALID_SIZE');
    if (!input.path.startsWith(`bid/${input.bidVersionId}/`)) throw new DomainError('Invalid storage namespace','INVALID_PATH');
    const { data: version, error: versionError } = await this.db.from('bid_versions').select('id,contractor_id,status').eq('id',input.bidVersionId).single();
    if (versionError) throw versionError; if (!version || version.contractor_id !== actorId || version.status !== 'draft') throw new DomainError('Upload is not authorized','FORBIDDEN');
    const { data, error } = await this.storage.from('dao-private').createSignedUploadUrl(input.path);
    if (error) throw error; return { path: input.path, token: data.token };
  }
  async signedDownloadForActor(actorId: string, id: string, expiresIn = 300) {
    if (!actorId) throw new DomainError('Authentication required','UNAUTHENTICATED');
    const { data: doc, error } = await this.db.from('bid_documents').select('*').eq('id',id).single();
    if (error) throw error; if (!doc || doc.status !== 'approved') throw new DomainError('Document is not approved','DOCUMENT_NOT_APPROVED');
    // bid_documents are authorized by their own RLS policy: owner contractor,
    // submitted-offer project owner, or DAO staff. document_grants is only for
    // generic project documents and must never widen bid-document access.
    const { data: signed, error: signedError } = await this.storage.from('dao-private').createSignedUrl(doc.object_path, expiresIn);
    if (signedError) throw signedError; return signed.signedUrl;
  }
}
