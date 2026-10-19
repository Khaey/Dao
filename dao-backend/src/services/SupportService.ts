import { createTicketInput, nextSupportCursor, replyInput, statusInput, supportId, supportListQuery, type SupportTicket } from '../support/contract.js';

export class SupportService {
  constructor(private readonly db: any) {}

  private async rpc(name: string, parameters: Record<string, unknown> = {}) {
    const { data, error } = await this.db.rpc(name, parameters);
    if (error) throw error;
    return data;
  }

  summary() { return this.rpc('my_support_summary'); }

  async list(query: URLSearchParams, staff = false) {
    const parsed = supportListQuery(query, staff);
    const rows = await this.rpc(staff ? 'support_queue' : 'list_my_support_tickets', {
      p_limit: parsed.limit,
      p_before: parsed.cursor?.before ?? null,
      p_before_id: parsed.cursor?.id ?? null,
      ...(staff ? { p_status: parsed.status, p_assignee: parsed.assignee } : {}),
    }) as SupportTicket[];
    const items = Array.isArray(rows) ? rows : [];
    return {
      items,
      next_cursor: items.length === parsed.limit && items.length > 0 ? nextSupportCursor(items[items.length - 1]) : null,
      total: items.length,
    };
  }

  create(value: unknown) {
    const input = createTicketInput(value);
    return this.rpc('create_support_ticket', {
      p_subject: input.subject, p_category: input.category, p_body: input.body, p_project_id: input.project_id,
      p_origin_route: input.origin?.route ?? null, p_origin_faq_id: input.origin?.faq_id ?? null,
      p_idempotency_key: input.idempotency_key,
    });
  }
  detail(id: unknown) { return this.rpc('get_support_ticket', { p_ticket_id: supportId(id) }); }
  reply(id: unknown, value: unknown) {
    const input = replyInput(value);
    return this.rpc('reply_support_ticket', { p_ticket_id: supportId(id), p_body: input.body, p_idempotency_key: input.idempotency_key });
  }
  async markRead(id: unknown) {
    await this.rpc('mark_support_ticket_read', { p_ticket_id: supportId(id) });
    return { acknowledged: true };
  }
  assign(id: unknown, value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value as object).length !== 1 || (value as Record<string, unknown>).assignee !== 'me')
      throw Object.assign(new Error('invalid'), { code: 'invalid' });
    return this.rpc('assign_support_ticket_to_me', { p_ticket_id: supportId(id) });
  }
  setStatus(id: unknown, value: unknown) {
    const input = statusInput(value);
    return this.rpc('set_support_ticket_status', { p_ticket_id: supportId(id), p_status: input.status, p_reason: input.reason });
  }
}
