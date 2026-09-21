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
}
