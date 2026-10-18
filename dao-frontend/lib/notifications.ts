'use client';

import { notificationPage, type NotificationPage } from '../../dao-backend/src/notifications/contract';
import { supabaseBrowser } from './supabase-browser';
export type { NotificationItem, NotificationPage } from '../../dao-backend/src/notifications/contract';

export class NotificationApiError extends Error {
  constructor(public readonly status: number) {
    super(status === 401 ? 'Session expirée. Reconnectez-vous.' : status === 403 ? 'Votre compte ne permet pas de consulter ces notifications.'
      : 'Impossible de charger vos notifications. Vérifiez votre connexion et réessayez.');
  }
}
async function request(method: 'GET' | 'PATCH', query: string, signal: AbortSignal, id?: string) {
  const { data } = await supabaseBrowser().auth.getSession();
  if (!data.session) throw new NotificationApiError(401);
  const response = await fetch('/api/notifications'+query, { method, cache: 'no-store', signal,
    headers: { Authorization: 'Bearer '+data.session.access_token, 'Content-Type':'application/json' },
    ...(method === 'PATCH' ? { body: JSON.stringify({ id }) } : {}) });
  if (!response.ok) throw new NotificationApiError(response.status);
  return (await response.json()).data;
}
export async function fetchNotifications(unread: boolean, cursor: string | null, signal: AbortSignal): Promise<NotificationPage> {
  const q=new URLSearchParams({ limit:'20', unread:String(unread) });if(cursor)q.set('cursor',cursor);
  const data=await request('GET','?'+q,signal);
  // Reconstruct fixed labels/routes, even if a response is malformed. No raw href reaches Link.
  if(!data || !Array.isArray(data.rows) || !(data.next_cursor === null || typeof data.next_cursor === 'string'))throw new NotificationApiError(503);
  const uuid='([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
  const raw=data.rows.map((r:any)=>{
    const pattern=r.kind==='project_message'?new RegExp('^/app/messages/'+uuid+'$','i')
      :r.kind==='invitation_accepted'?new RegExp('^/app/projects/'+uuid+'$','i')
      :new RegExp('^/app/projects/'+uuid+'/review$','i');
    const target=r.kind==='invitation_received'&&r.href==='/app/invitations'?r.id:typeof r.href==='string'?r.href.match(pattern)?.[1]:null;
    return {...r,target_id:target};
  });
  const clean=notificationPage({...data,rows:raw,has_more:data.next_cursor!==null},20);
  if(clean.next_cursor!==data.next_cursor)throw new NotificationApiError(503);
  return clean;
}
export async function markNotificationRead(id: string, signal: AbortSignal) {
  const data=await request('PATCH','',signal,id);
  if(data?.acknowledged!==true)throw new NotificationApiError(503);
}
