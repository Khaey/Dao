import { notificationId, notificationPage, parseNotificationQuery } from '../notifications/contract.js';

export class NotificationService {
  constructor(private readonly db: any) {}
  async list(query: URLSearchParams) {
    const { limit, before, unread, action } = parseNotificationQuery(query);
    const { data, error } = await this.db.rpc('my_notifications_s2', {
      p_limit: limit, p_before: before?.created_at ?? null, p_before_id: before?.id ?? null, p_unread: unread, p_action: action,
    });
    if (error) throw error;
    return notificationPage(data, limit);
  }
  async preferences() {
    const { data,error }=await this.db.rpc('my_notification_preferences');if(error)throw error;return data;
  }
  async updatePreferences(enabled: boolean) {
    const { data,error }=await this.db.rpc('update_my_notification_preferences',{p_invitation_expiring:enabled});if(error)throw error;return data;
  }
  async markAllRead() {
    const { data,error }=await this.db.rpc('mark_my_visible_notifications_read',{p_limit:500});if(error)throw error;return data;
  }
  async markRead(id: unknown) {
    const { error } = await this.db.rpc('mark_my_notification_read', { p_id: notificationId(id) });
    if (error) throw error;
    return { acknowledged: true };
  }
}
