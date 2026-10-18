import test from 'node:test';
import assert from 'node:assert/strict';
import { NotificationService } from '../src/services/NotificationService.js';
import { createNotificationHandler } from '../src/server/notificationHandler.js';

const id = '11111111-1111-4111-8111-111111111111';
function request(method='GET', body?: unknown, query='') {
  return new Request('https://dao.example.invalid/api/notifications'+query, { method, headers: { Authorization: 'Bearer actor' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
test('notifications authenticate before data and keep JWT-scoped RPC inputs actor-free', async () => {
  const calls: any[] = [];
  const db = { rpc: async (name: string, args: unknown) => { calls.push({ name, args }); return { data: name==='my_notifications_s2'?{ rows: [], unread_count: 0, workspace: 'client', has_more: false }:{workspace:'client',invitation_expiring:true} }; } };
  const anonymous = createNotificationHandler(new NotificationService(db), async () => null);
  assert.equal((await anonymous(request())).status, 401); assert.equal(calls.length, 0);
  const handler = createNotificationHandler(new NotificationService(db), async (header) => { assert.equal(header,'Bearer actor'); return { id: 'real-actor' }; });
  const result = await handler(request('GET', undefined, '?limit=50&unread=true'));
  assert.equal(result.status,200); assert.equal(result.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(calls[0], { name: 'my_notifications_s2', args: { p_limit: 50, p_before: null, p_before_id: null, p_unread: true,p_action:false } });
  assert.equal((await handler(request('PATCH', { id }))).status,200);
  assert.deepEqual(calls[1], { name: 'mark_my_notification_read', args: { p_id: id } });
  assert.equal((await handler(request('GET',undefined,'?view=preferences'))).status,200);
  assert.equal((await handler(request('PATCH',{action:'mark_all_read'}))).status,200);
  assert.equal((await handler(request('PATCH',{action:'update_preferences',invitation_expiring:false}))).status,200);
});
test('invalid parameters, JSON, forged identity, bulk read and methods never reach SQL', async () => {
  let calls = 0;
  const handler = createNotificationHandler(new NotificationService({ rpc: async () => { calls++; throw Error('Unexpected SQL'); } }),async () => ({ id }));
  for (const body of [{ id, user_id: id }, {}, { all: true }, [], null, { id: 'bad' }])
    assert.equal((await handler(request('PATCH', body))).status,400);
  assert.equal((await handler(new Request('https://dao.example.invalid',{ method:'PATCH',body:'not-json',headers:{Authorization:'Bearer actor'} }))).status,400);
  assert.equal((await handler(request('GET', undefined, '?user_id='+id))).status,400);
  assert.equal((await handler(request('DELETE'))).status,405); assert.equal(calls,0);
});
test('provider/database failures and missing migration are expurgated, forbidden stays 403', async () => {
  for (const [code,status] of [['42501',403], ['PGRST202',503], ['XX000',503], ['22023',400]]) {
    const handler = createNotificationHandler(new NotificationService({ rpc: async () => ({ error:{code,message:'SECRET email@example.invalid private payload URL'} }) }),async () => ({ id }));
    const response = await handler(request()); assert.equal(response.status,status);
    assert.equal(response.headers.get('cache-control'),'private, no-store');
    assert.ok(!JSON.stringify(await response.json()).includes('SECRET'));
  }
});
test('observation contains only fixed category/count and observer failures do not affect commands', async () => {
  const seen: any[] = [];
  const service = new NotificationService({ rpc: async () => ({ error: { code:'XX000',message:'SECRET email@example.invalid' } }) });
  const handler = createNotificationHandler(service,async () => ({ id }),event => seen.push(event));
  assert.equal((await handler(request())).status,503);assert.deepEqual(seen,[{category:'UNAVAILABLE'}]);
  assert.ok(!JSON.stringify(seen).includes(id));assert.ok(!JSON.stringify(seen).includes('SECRET'));
  const ok = new NotificationService({ rpc: async () => ({ data:{rows:[],workspace:'client',unread_count:0,has_more:false} }) });
  assert.equal((await createNotificationHandler(ok,async () => ({id}),()=>{throw Error('Metrics offline');})(request())).status,200);
});
