import { notificationId, notificationPage, parseNotificationQuery } from '../notifications/contract.js';

export class NotificationService {
  constructor(private readonly db: any) {}
  async list(query: URLSearchParams) {
    const { limit, before, unread } = parseNotificationQuery(query);
    const { data, error } = await this.db.rpc('my_notifications', {
      p_limit: limit, p_before: before?.created_at ?? null, p_before_id: before?.id ?? null, p_unread: unread,
    });
    if (error) throw error;
    return notificationPage(data, limit);
  }
  async markRead(id: unknown) {
    const { error } = await this.db.rpc('mark_my_notification_read', { p_id: notificationId(id) });
    if (error) throw error;
    return { acknowledged: true };
  }
}
