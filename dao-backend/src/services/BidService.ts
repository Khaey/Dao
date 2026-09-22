import { DomainError } from '../lib/errors.js';
export class BidService {
  constructor(private readonly db: any) {}
  async createDraft(input: Record<string, unknown>) {
    const publicationId = String(input.publication_id ?? '');
    if (!publicationId) throw new DomainError('Publication is required', 'BAD_REQUEST');
    const { data, error } = await this.db.rpc('create_bid_draft', { p_publication_id: publicationId });
    if (error) throw error;
    return data;
  }
  async submit(versionId: string) { return this.submitForActor(versionId); }
  async get(id: string) { const { data, error } = await this.db.from('bids').select('*').eq('id',id).single(); if(error) throw error; return data; }
  async updateDraft(_versionId: string, _patch: Record<string, unknown>) {
    throw new DomainError('Draft metadata cannot be changed in the MVP; update the offer lines instead', 'BID_DRAFT_METADATA_UNSUPPORTED');
  }
  async addItem(input: Record<string, unknown>) {
    const publicationId = String(input.publication_id ?? '');
    const versionId = String(input.version_id ?? '');
    const publicationRequestId = String(input.publication_request_id ?? '');
    if (!publicationId || !versionId || !publicationRequestId) throw new DomainError('Publication, draft and lot are required', 'BAD_REQUEST');
    const { data, error } = await this.db.rpc('upsert_bid_item', {
      p_publication_id: publicationId,
      p_version_id: versionId,
      p_publication_request_id: publicationRequestId,
      p_price_millimes: Number(input.price_millimes),
      p_duration_days: Number(input.duration_days),
      p_inclusions: String(input.inclusions ?? ''),
      p_exclusions: input.exclusions == null ? null : String(input.exclusions),
    });
    if (error) throw error;
    return data;
  }
  async submitForActor(versionId: string, _contractorId?: string) {
    const { data, error } = await this.db.rpc('submit_bid_version', { p_version_id: versionId });
    if (error) throw error;
    return data;
  }
  async withdraw(_versionId: string) {
    throw new DomainError('Le retrait d’une offre soumise est hors périmètre MVP', 'BID_WITHDRAWAL_NOT_AVAILABLE');
  }
}
