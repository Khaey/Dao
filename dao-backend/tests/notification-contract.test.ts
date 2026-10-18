import test from 'node:test';
import assert from 'node:assert/strict';
import { notificationHref, notificationId, notificationPage, parseNotificationQuery } from '../src/notifications/contract.js';

const id = '11111111-1111-4111-8111-111111111111';
const at = '2026-10-18T00:00:00.123456+00:00';
const row = { id, created_at: at, read_at: null, kind: 'review_rejected', target_id: id, action_required:false, expires_at:null };
const page = (rows: unknown[] = [row]) => ({ rows, unread_count: 1, workspace: 'client', has_more: false });
test('notification query defaults, bound and exact microsecond composite cursor', () => {
  assert.deepEqual(parseNotificationQuery(new URLSearchParams()), { limit: 20, unread: false, action:false, before: null });
  const q = new URLSearchParams({ limit: '50', unread: 'true', action:'true', cursor: `${at}~${id}` });
  assert.deepEqual(parseNotificationQuery(q), { limit: 50, unread: true, action:true, before: { created_at: at, id } });
});
test('reject invalid limits, repeated keys, actor spoofing and malformed cursors', () => {
  for (const input of ['limit=0', 'limit=51', 'limit=1.5', 'limit=-1', 'limit=01', 'limit=Infinity', 'limit=20&limit=20',
    'user_id='+id, 'workspace=staff', 'unread=1', 'action=1', 'cursor=', 'cursor=https://example.invalid', 'cursor='+at+'~bad',
    'cursor=9999-99-99T00:00:00Z~'+id, 'cursor=2026-02-30T00:00:00Z~'+id,
    'cursor=0000-01-01T00:00:00Z~'+id, 'cursor='+at+'~'+id+'~extra'])
    assert.throws(() => parseNotificationQuery(new URLSearchParams(input)), { code: 'BAD_REQUEST' }, input);
  assert.equal(notificationId(id), id);
  for (const input of [null, {}, 'x', id+'/../../dao']) assert.throws(() => notificationId(input), { code: 'BAD_REQUEST' });
});
test('fixed copy and allowlisted routes ignore stored secrets and arbitrary URLs', () => {
  const result = notificationPage(page([{ ...row, payload: { email: 'private@example.invalid', body: 'PRIVATE', href: '//evil.invalid' },
    title: '<script>PRIVATE</script>', href: 'javascript:alert(1)', user_id: 'PRIVATE' }]), 20);
  assert.deepEqual(result.rows[0], { id, created_at: at, read_at: null, kind: 'review_rejected', title: 'Dossier à corriger', href: `/app/projects/${id}/review`,action_required:false,expires_at:null });
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  assert.equal(notificationHref('invitation_received', id), '/app/invitations');
  assert.equal(notificationHref('invitation_accepted', id), `/app/projects/${id}`);
  assert.equal(notificationHref('project_message', id), `/app/messages/${id}`);
  assert.equal(notificationHref('review_approved', id), `/app/projects/${id}/review`);
  assert.equal(notificationHref('invitation_expiring', id), '/app/invitations');
});
test('unknown kinds, external URLs, corrupted dates/counts and duplicate rows fail closed', () => {
  for (const value of [null, [], {}, { ...page(), workspace: 'admin' }, { ...page(), unread_count: -1 },
    { ...page(), unread_count: '1' }, { ...page(), has_more: true }, page([row,row]),
    page([{ ...row, id: {} }]), page([{ ...row, kind: '__proto__' }]), page([{ ...row, kind: 'payment_success' }]),
    page([{ ...row, target_id: '//evil.invalid' }]), page([{ ...row, created_at: 'invalid' }]),
    page([{ ...row, read_at: '' }]), page([{ ...row, read_at: undefined }]),page([{...row,action_required:true}]),
    page([{...row,kind:'invitation_expiring',action_required:true,expires_at:null}])])
    assert.throws(() => notificationPage(value, 20), { code: 'INVALID_NOTIFICATION_DATA' });
});
test('0/1/N pagination has a stable cursor, preserves timestamps and drops no extra payload', () => {
  assert.deepEqual(notificationPage({ rows: [], workspace: 'staff', unread_count: 0, has_more: false }, 20),
    { rows: [], workspace: 'staff', unread_count: 0, next_cursor: null });
  const result = notificationPage({ ...page(), has_more: true }, 1);
  assert.equal(result.next_cursor, `${at}~${id}`);
  assert.equal(parseNotificationQuery(new URLSearchParams({ cursor: result.next_cursor! })).before!.created_at, at);
  const rows = Array.from({ length: 50 }, (_, n) => ({ ...row, id: `${String(n).padStart(8,'0')}-1111-4111-8111-111111111111` }));
  assert.equal(notificationPage({ ...page(rows), unread_count: 125, has_more: true }, 50).rows.length, 50);
  assert.throws(() => notificationPage(page(rows), 20));
});
