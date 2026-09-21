import { DomainError } from '../lib/errors.js';
export class ProjectService {
  constructor(private readonly db: any) {}
  async create(input: Record<string, unknown>) { const { data, error } = await this.db.rpc('create_project_draft', { p_project_type: input.project_type ?? 'other', p_surface_m2: input.surface_m2 ?? null, p_desired_start_date: input.desired_start_date ?? null, p_indicative_budget_millimes: input.indicative_budget_millimes ?? null, p_governorate_id: input.governorate_id, p_delegation_id: input.delegation_id ?? null, p_locality_id: input.locality_id ?? null }); if (error) throw error; return data; }
  async addRequest(input: Record<string, unknown>) { const { data, error } = await this.db.rpc('add_project_request', { p_project_id: input.project_id, p_trade_id: input.trade_id, p_title: input.title, p_scope: input.scope }); if (error) throw error; return data; }
  async get(id: string) { const { data, error } = await this.db.from('projects').select('*').eq('id', id).single(); if (error) throw error; return data; }
  async update(id: string, patch: Record<string, unknown>) { if ('client_id' in patch) throw new DomainError('client_id is immutable'); const { data, error } = await this.db.from('projects').update(patch).eq('id', id).select().single(); if (error) throw error; return data; }
  async confirmClient(id: string, actorId: string) { return this.transition(id, actorId, 'client_review'); }
  async submitForDaoReview(id: string, actorId: string) { return this.transition(id, actorId, 'dao_review'); }
  private async transition(id: string, actorId: string, status: string) {
    const { data, error } = await this.db.from('projects').update({ status }).eq('id', id).eq('client_id', actorId).select().single();
    if (error) throw error; if (!data) throw new DomainError('Project not found or not owned','FORBIDDEN'); return data;
  }
}
