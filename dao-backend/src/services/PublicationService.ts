export class PublicationService {
  constructor(private readonly db: any) {}
  async publish(input: Record<string, unknown>) { const { data, error } = await this.db.rpc('publish_project', { p_project_id: input.project_id, p_visibility: input.visibility, p_request_ids: input.request_ids ?? null, p_contractor_ids: input.contractor_ids ?? null, p_submission_deadline: input.submission_deadline ?? null }); if (error) throw error; return data; }
  async get(id: string) { const { data, error } = await this.db.from('publications').select('*').eq('id', id).single(); if (error) throw error; return data; }
  async close(id: string) { const { data, error } = await this.db.from('publications').update({status:'closed',closed_at:new Date().toISOString()}).eq('id',id).select().single(); if(error) throw error; return data; }
}