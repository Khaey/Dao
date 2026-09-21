import { DomainError } from '../lib/errors.js';
export class BidService {
  constructor(private readonly db: any) {}
  async createDraft(input: Record<string, unknown>) { const { data, error } = await this.db.from('bids').insert(input).select().single(); if(error) throw error; return data; }
  async submit(versionId: string) { const { data, error } = await this.db.from('bid_versions').update({status:'submitted',submitted_at:new Date().toISOString()}).eq('id',versionId).eq('status','draft').select().single(); if(error) throw error; if(!data) throw new DomainError('Bid version is not a draft','BID_NOT_DRAFT'); return data; }
  async get(id: string) { const { data, error } = await this.db.from('bids').select('*').eq('id',id).single(); if(error) throw error; return data; }
}
