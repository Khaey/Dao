/**
 * Server-side contract foundation preparation for an explicitly enabled chantier.
 * #381: no client-side/service-role exposure and no implicit legal consent.
 *
 * This helper is intentionally NOT hooked to award creation until a trusted
 * server-only configuration source and DAO signatory selection are available.
 * The canonical DB function remains the source of truth (one contract per award).
 */
export type ContractPreparationRequest = {
  contractEnabled: boolean;
  awardId: string;
  actorId: string;
  daoAdminUserId: string;
  daoLegalName: string;
  idempotencyKey: string;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ContractPreparationService {
  /** Must receive a trusted server-only Supabase service_role client, never a browser JWT. */
  constructor(private readonly serviceDb: { rpc(name: string, args: Record<string, string>): Promise<{ data: unknown; error: { message?: string } | null }> }) {}

  async prepareOnAward(input: ContractPreparationRequest) {
    if (!input.contractEnabled) return { prepared: false as const, reason: 'contract_disabled' as const };
    for (const field of ['awardId', 'actorId', 'daoAdminUserId', 'idempotencyKey'] as const) {
      if (!uuid.test(input[field])) throw new Error('Invalid UUID: ' + field);
    }
    if (!input.daoLegalName?.trim() || input.daoLegalName.trim().length > 200) {
      throw new Error('DAO legal name must be explicitly configured');
    }
    const result = await this.serviceDb.rpc('prepare_contract_foundation', {
      p_actor_id: input.actorId,
      p_award_id: input.awardId,
      p_dao_user_id: input.daoAdminUserId,
      p_dao_legal_name: input.daoLegalName.trim(),
      p_idempotency_key: input.idempotencyKey,
    });
    if (result.error) throw result.error;
    return { prepared: true as const, result: result.data, legallySigned: false as const };
  }
}
