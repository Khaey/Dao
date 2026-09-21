import { DomainError } from '../lib/errors.js';
export class BidService {
  constructor(private readonly db: any) {}
  async createDraft(input: Record<string, unknown>) { const { data, error } = await this.db.from('bids').insert(input).select().single(); if(error) throw error; return data; }
  async submit(versionId: string) { const { data, error } = await this.db.from('bid_versions').update({status:'submitted',submitted_at:new Date().toISOString()}).eq('id',versionId).eq('status','draft').select().single(); if(error) throw error; if(!data) throw new DomainError('Bid version is not a draft','BID_NOT_DRAFT'); return data; }
  async get(id: string) { const { data, error } = await this.db.from('bids').select('*').eq('id',id).single(); if(error) throw error; return data; }
  async updateDraft(versionId: string, patch: Record<string, unknown>) { const { data, error } = await this.db.from('bid_versions').update(patch).eq('id',versionId).eq('status','draft').select().single(); if(error) throw error; if(!data) throw new DomainError('Bid version is not a draft','BID_NOT_DRAFT'); return data; }
  async addItem(input: Record<string, unknown>) { const { data, error } = await this.db.from('bid_items').insert(input).select().single(); if(error) throw error; return data; }
  async submitForActor(versionId: string, _contractorId?: string) {
    const { data, error } = await this.db.rpc('submit_bid_version', { p_version_id: versionId });
    if (error) throw error;
    return data;
  }
  async withdraw(versionId: string) { const { data, error } = await this.db.from('bid_versions').update({status:'withdrawn'}).eq('id',versionId).eq('status','submitted').select().single(); if(error) throw error; if(!data) throw new DomainError('Bid cannot be withdrawn','BID_NOT_SUBMITTED'); return data; }
}
