export class AwardService {
  constructor(private readonly db: any) {}
  async award(input: Record<string, unknown>) {
    const { data, error } = await this.db.from('award_items').insert(input).select().single();
    if (error) throw error; // DB unique/FK/trigger constraints are authoritative.
    return data;
  }
}
