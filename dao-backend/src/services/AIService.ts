import { DomainError } from '../lib/errors.js';

export class AIService {
  constructor(private readonly db: any) {}

  async generate(input: Record<string, unknown>) {
    if (!input.project_id || !input.request_id) {
      throw new DomainError('Project and request are required', 'BAD_REQUEST');
    }
    const { data, error } = await this.db.rpc('generate_ai_proposal', {
      p_project_id: input.project_id,
      p_request_id: input.request_id,
      p_source_description: input.source_description ?? null,
    });
    if (error) throw error;
    return data;
  }

  async proposals(projectId: string) {
    const { data, error } = await this.db
      .from('ai_proposals')
      .select('id,run_id,request_id,trade_id,proposed_scope,status,created_at,ai_runs!inner(project_id)')
      .eq('ai_runs.project_id', projectId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async accept(proposalId: string) {
    const { data, error } = await this.db.rpc('accept_ai_proposal', { p_proposal_id: proposalId });
    if (error) throw error;
    return data;
  }

  async reject(proposalId: string) {
    const { data, error } = await this.db.rpc('reject_ai_proposal', { p_proposal_id: proposalId });
    if (error) throw error;
    return data;
  }
}
