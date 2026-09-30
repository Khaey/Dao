export class ProfileService {
  constructor(private readonly db: any) {}

  async initialize(input: Record<string, unknown> = {}) {
    const { data, error } = await this.db.rpc('initialize_my_account', {
      p_display_name: input.display_name ?? null,
      p_phone_e164: input.phone_e164 ?? null,
      p_account_type: input.account_type,
      p_business_name: input.business_name ?? null,
    });
    if (error) throw error;
    return data;
  }

  async update(input: Record<string, unknown>) {
    const { data, error } = await this.db.rpc('update_my_profile', {
      p_display_name: input.display_name ?? null,
      p_phone_e164: input.phone_e164 ?? null,
    });
    if (error) throw error;
    return data;
  }
}
