export class PublicationService {
  constructor(private readonly db: any) {}
  async publish(input: Record<string, unknown>) { const { data, error } = await this.db.from('publications').insert({...input,status:'published',published_at:new Date().toISOString()}).select().single(); if (error) throw error; return data; }
  async get(id: string) { const { data, error } = await this.db.from('publications').select('*').eq('id', id).single(); if (error) throw error; return data; }
  async close(id: string) { const { data, error } = await this.db.from('publications').update({status:'closed',closed_at:new Date().toISOString()}).eq('id',id).select().single(); if(error) throw error; return data; }
}
