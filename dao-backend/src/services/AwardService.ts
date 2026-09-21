export class AwardService {
  constructor(private readonly db: any) {}
  async award(input: Record<string, unknown>) {
    const { data, error } = await this.db.rpc('award_request_atomic', {
      p_idempotency_key: input.idempotency_key,
      p_award_id: input.award_id, p_project_id: input.project_id,
      p_contractor_id: input.contractor_id, p_request_id: input.request_id,
      p_bid_item_id: input.bid_item_id, p_agreed_millimes: input.agreed_millimes
    });
    if (error) throw error; // DB unique/FK/trigger constraints are authoritative.
    return data;
  }
}
