import { DomainError } from '../lib/errors.js';

export class MessageService {
  constructor(private readonly db: any) {}

  private async command(name: string, input: Record<string, unknown> = {}) {
    const { data, error } = await this.db.rpc(name, input);
    if (error) throw error;
    return data;
  }

  listConversations() { return this.command('list_my_conversations'); }

  open(projectId: string, contractorId: string, memberId: string) {
    if (!projectId || (!contractorId && !memberId)) throw new DomainError('Chantier et professionnel requis', 'BAD_REQUEST');
    return memberId
      ? this.command('open_project_member_conversation', { p_project_id: projectId, p_member_id: memberId })
      : this.command('open_project_conversation', { p_project_id: projectId, p_contractor_id: contractorId });
  }

  listMessages(conversationId: string, before?: string | null, limit = 30) {
    if (!conversationId) throw new DomainError('Conversation requise', 'BAD_REQUEST');
    return this.command('list_conversation_messages', {
      p_conversation_id: conversationId,
      p_before: before || null,
      p_limit: Math.min(Math.max(Number(limit) || 30, 1), 50),
    });
  }

  send(conversationId: string, body: string, idempotencyKey: string) {
    if (!conversationId || !idempotencyKey) throw new DomainError('Conversation et clé idempotente requises', 'BAD_REQUEST');
    return this.command('send_conversation_message', {
      p_conversation_id: conversationId,
      p_body: body,
      p_idempotency_key: idempotencyKey,
    });
  }

  markRead(conversationId: string) {
    if (!conversationId) throw new DomainError('Conversation requise', 'BAD_REQUEST');
    return this.command('mark_conversation_read', { p_conversation_id: conversationId });
  }
}
