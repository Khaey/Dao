'use client';

import { notificationPage, type NotificationPage } from '../../dao-backend/src/notifications/contract';
import { supabaseBrowser } from './supabase-browser';
import { notifyUnreadChanged } from './unread-events';
export type { NotificationItem, NotificationPage } from '../../dao-backend/src/notifications/contract';

export class NotificationApiError extends Error {
  constructor(public readonly status: number) {
    super(status === 401 ? 'Session expirée. Reconnectez-vous.' : status === 403 ? 'Votre compte ne permet pas de consulter ces notifications.'
      : 'Impossible de charger vos notifications. Vérifiez votre connexion et réessayez.');
  }
}
async function request(method: 'GET' | 'PATCH', query: string, signal: AbortSignal, body?: object) {
  const { data } = await supabaseBrowser().auth.getSession();
  if (!data.session) throw new NotificationApiError(401);
  const response = await fetch('/api/notifications'+query, { method, cache: 'no-store', signal,
    headers: { Authorization: 'Bearer '+data.session.access_token, 'Content-Type':'application/json' },
    ...(method === 'PATCH' ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw new NotificationApiError(response.status);
  return (await response.json()).data;
}
export async function fetchNotifications(filter: 'all'|'unread'|'action', cursor: string | null, signal: AbortSignal): Promise<NotificationPage> {
  const q=new URLSearchParams({ limit:'20', unread:String(filter==='unread'),action:String(filter==='action') });if(cursor)q.set('cursor',cursor);
  const data=await request('GET','?'+q,signal);
  // Reconstruct fixed labels/routes, even if a response is malformed. No raw href reaches Link.
  if(!data || !Array.isArray(data.rows) || !(data.next_cursor === null || typeof data.next_cursor === 'string'))throw new NotificationApiError(503);
  const uuid='([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
  const raw=data.rows.map((r:any)=>{
    const pattern=r.kind==='project_message'?new RegExp('^/app/messages/'+uuid+'$','i')
      :['rfi_question','rfi_clarification'].includes(r.kind)?new RegExp('^/app/messages\\?onglet=rfi&question='+uuid+'$','i')
      :r.kind==='invitation_accepted'?new RegExp('^/app/projects/'+uuid+'$','i')
      :new RegExp('^/app/projects/'+uuid+'/review$','i');
    const target=r.kind==='bid_result'&&r.href==='/app/artisan/offers'?r.id:['invitation_received','invitation_expiring'].includes(r.kind)&&r.href==='/app/invitations'?r.id:typeof r.href==='string'?r.href.match(pattern)?.[1]:null;
    return {...r,target_id:target};
  });
  const clean=notificationPage({...data,rows:raw,has_more:data.next_cursor!==null},20);
  if(clean.next_cursor!==data.next_cursor)throw new NotificationApiError(503);
  return clean;
}
/** Only the unread count is needed by the global bell; no event text is fetched. */
export async function fetchUnreadNotificationCount(signal: AbortSignal): Promise<number> {
  const data = await request('GET', '?limit=1&unread=true', signal);
  if (!data || !Number.isSafeInteger(data.unread_count) || data.unread_count < 0
      || !['client', 'contractor', 'staff'].includes(data.workspace)) throw new NotificationApiError(503);
  return data.unread_count;
}
export async function markNotificationRead(id: string, signal: AbortSignal) {
  const data=await request('PATCH','',signal,{id});
  if(data?.acknowledged!==true)throw new NotificationApiError(503);
  notifyUnreadChanged();
}
export async function markAllNotificationsRead(signal:AbortSignal){const data=await request('PATCH','',signal,{action:'mark_all_read'});notifyUnreadChanged();return data;}
export async function fetchNotificationPreferences(signal:AbortSignal){return request('GET','?view=preferences',signal);}
export async function updateNotificationPreferences(enabled:boolean,signal:AbortSignal){return request('PATCH','',signal,{action:'update_preferences',invitation_expiring:enabled});}
