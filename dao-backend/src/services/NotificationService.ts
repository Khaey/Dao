export class NotificationService {
  constructor(private readonly db: any) {}
  async create(input: Record<string, unknown>) { const { data, error } = await this.db.from('notifications').insert(input).select().single(); if(error) throw error; return data; }
  async unread(userId: string) { const { data, error } = await this.db.from('notifications').select('*').eq('user_id',userId).is('read_at',null); if(error) throw error; return data; }
}
