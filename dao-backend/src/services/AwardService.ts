export class AwardService {
  constructor(private readonly db: any) {}
  async award(input: Record<string, unknown>) {
    const { data, error } = await this.db.rpc('award_bid_item_atomic', {
      p_idempotency_key: input.idempotency_key,
      p_bid_item_id: input.bid_item_id,
    });
    if (error) throw error; // DB unique/FK/trigger constraints are authoritative.
    return data;
  }
}
