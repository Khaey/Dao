import { DomainError } from '../lib/errors.js';
export class ProjectService {
  constructor(private readonly db: any) {}
  async create(input: Record<string, unknown>) { const { data, error } = await this.db.from('projects').insert(input).select().single(); if (error) throw error; return data; }
  async get(id: string) { const { data, error } = await this.db.from('projects').select('*').eq('id', id).single(); if (error) throw error; return data; }
  async update(id: string, patch: Record<string, unknown>) { if ('client_id' in patch) throw new DomainError('client_id is immutable'); const { data, error } = await this.db.from('projects').update(patch).eq('id', id).select().single(); if (error) throw error; return data; }
}
