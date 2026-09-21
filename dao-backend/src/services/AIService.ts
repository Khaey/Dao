export class AIService {
  constructor(private readonly db: any) {}
  async createRun(input: Record<string, unknown>) { const { data, error } = await this.db.from('ai_runs').insert(input).select().single(); if(error) throw error; return data; }
  async proposals(runId: string) { const { data, error } = await this.db.from('ai_proposals').select('*').eq('run_id',runId); if(error) throw error; return data; }
}
