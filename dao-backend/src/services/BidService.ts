import { DomainError } from '../lib/errors.js';
export class BidService {
  constructor(private readonly db: any) {}
  async createDraft(input: Record<string, unknown>) { const { data, error } = await this.db.from('bids').insert(input).select().single(); if(error) throw error; return data; }
  async submit(versionId: string) { const { data, error } = await this.db.from('bid_versions').update({status:'submitted',submitted_at:new Date().toISOString()}).eq('id',versionId).eq('status','draft').select().single(); if(error) throw error; if(!data) throw new DomainError('Bid version is not a draft','BID_NOT_DRAFT'); return data; }
  async get(id: string) { const { data, error } = await this.db.from('bids').select('*').eq('id',id).single(); if(error) throw error; return data; }
  async updateDraft(versionId: string, patch: Record<string, unknown>) { const { data, error } = await this.db.from('bid_versions').update(patch).eq('id',versionId).eq('status','draft').select().single(); if(error) throw error; if(!data) throw new DomainError('Bid version is not a draft','BID_NOT_DRAFT'); return data; }
  async addItem(input: Record<string, unknown>) { const { data, error } = await this.db.from('bid_items').insert(input).select().single(); if(error) throw error; return data; }
  async submitForActor(versionId: string, actorId: string) {
    const { data: version, error: lookupError } = await this.db.from('bid_versions').select('id,contractor_id').eq('id',versionId).single();
    if (lookupError) throw lookupError; if (!version || version.contractor_id !== actorId) throw new DomainError('Bid is not owned by actor','FORBIDDEN');
    return this.submit(versionId);
  }
  async withdraw(versionId: string) { const { data, error } = await this.db.from('bid_versions').update({status:'withdrawn'}).eq('id',versionId).eq('status','submitted').select().single(); if(error) throw error; if(!data) throw new DomainError('Bid cannot be withdrawn','BID_NOT_SUBMITTED'); return data; }
}
