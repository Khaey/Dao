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
  async configurePackage(input: Record<string, unknown>) {
    const { data, error } = await this.db.rpc('configure_bid_package', {
      p_version_id: input.version_id,
      p_indivisible: input.indivisible === true,
      p_item_ids: input.item_ids ?? null,
    });
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
  async updateQuoteMetadata(input: Record<string, unknown>) {
    const { data, error } = await this.db.rpc('update_bid_quote_metadata', {
      p_version_id: input.version_id,
      p_valid_until: input.valid_until || null,
      p_terms: input.terms || null,
      p_material_references: input.material_references || null,
    });
    if (error) throw error;
    return data;
  }
  async replaceQuoteLines(input: Record<string, unknown>) {
    if (!Array.isArray(input.lines)) throw new DomainError('Quote lines are required', 'BAD_REQUEST');
    const { data, error } = await this.db.rpc('replace_bid_quote_lines', { p_bid_item_id: input.bid_item_id, p_lines: input.lines });
    if (error) throw error;
    return data;
  }
  async replaceSubLots(input: Record<string, unknown>) {
    if (!Array.isArray(input.sub_lots)) throw new DomainError('Sub-lots are required', 'BAD_REQUEST');
    const { data, error } = await this.db.rpc('replace_bid_sub_lots', { p_bid_item_id: input.bid_item_id, p_sub_lots: input.sub_lots });
    if (error) throw error;
    return data;
  }
  async replaceSubLotLinks(input: Record<string, unknown>) {
    if (!Array.isArray(input.links)) throw new DomainError('Links are required', 'BAD_REQUEST');
    const { data, error } = await this.db.rpc('replace_bid_sub_lot_links', { p_version_id: input.version_id, p_links: input.links });
    if (error) throw error;
    return data;
  }
  async withdraw(versionId: string) {
    if (!versionId) throw new DomainError('Offer version is required', 'BAD_REQUEST');
    const { data, error } = await this.db.rpc('withdraw_bid_version', { p_version_id: versionId });
    if (error) throw error;
    return data;
  }
}
