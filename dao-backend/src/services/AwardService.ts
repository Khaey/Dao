export class AwardService {
  constructor(private readonly db: any) {}
  async award(input: Record<string, unknown>) {
    const { data, error } = await this.db.rpc(input.group_id ? 'award_bid_group_atomic' : 'award_bid_item_atomic', {
      p_idempotency_key: input.idempotency_key,
      ...(input.group_id ? { p_group_id: input.group_id } : { p_bid_item_id: input.bid_item_id }),
    });
    if (error) throw error; // DB unique/FK/trigger constraints are authoritative.
    return data;
  }
  async cancel(input: Record<string, unknown>) {
    const { data, error } = await this.db.rpc('cancel_award_item_atomic', {
      p_idempotency_key: input.idempotency_key,
      p_award_item_id: input.award_item_id,
      p_reason: input.reason,
      p_comment: input.comment ?? null,
    });
    if (error) throw error;
    return data;
  }
}
