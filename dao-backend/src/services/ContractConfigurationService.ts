/**
 * JWT-scoped configuration facade. PostgreSQL remains authoritative for owner,
 * active-account and dao_admin checks; no service-role credential is used here.
 */
export class ContractConfigurationService {
  constructor(private readonly db: any) {}

  private async call<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.db.rpc(name, args);
    if (error) throw error;
    return data as T;
  }

  project(projectId: string) {
    return this.call('project_contract_configuration', { p_project_id: projectId });
  }

  setProject(input: Record<string, unknown>) {
    return this.call('set_project_contract_enabled', {
      p_project_id: input.project_id,
      p_enabled: input.enabled,
      p_idempotency_key: input.idempotency_key,
    });
  }

  configureRuntime(input: Record<string, unknown>) {
    return this.call('configure_contract_runtime', {
      p_dao_user_id: input.dao_user_id,
      p_dao_legal_name: input.dao_legal_name,
      p_enabled: input.enabled,
      p_idempotency_key: input.idempotency_key,
    });
  }
}
