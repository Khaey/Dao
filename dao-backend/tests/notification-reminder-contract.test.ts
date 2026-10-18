import test from 'node:test';
import assert from 'node:assert/strict';
import { invitationExpiryReminder, INVITATION_REMINDER_WINDOW_MS } from '../src/notifications/reminderContract.js';

const invitation = '11111111-1111-4111-8111-111111111111';
const project = '22222222-2222-4222-8222-222222222222';
const now = '2026-10-18T08:00:00Z';
const base = {
  invitation_id: invitation,
  project_id: project,
  expected_role: 'contractor' as const,
  status: 'pending' as const,
  expires_at: '2026-10-19T07:59:59Z',
  project_archived: false,
  recipient_active: true,
  recipient_has_role: true,
  sender_active_member: true,
  enabled: true,
};

test('selects one bounded invitation reminder with only allowlisted context', () => {
  const result = invitationExpiryReminder(base, now);
  assert.deepEqual(result, {
    kind: 'invitation_expiring',
    severity: 'action_required',
    workspace: 'contractor',
    invitation_id: invitation,
    project_id: project,
    expires_at: base.expires_at,
    event_key: `invitation_expiring:${invitation}:24h`,
  });
  assert.ok(!JSON.stringify(result).includes('email'));
});

test('uses an exact UTC instant window with inclusive 24h boundary and no DST arithmetic', () => {
  const atBoundary = { ...base, expires_at: new Date(Date.parse(now) + INVITATION_REMINDER_WINDOW_MS).toISOString() };
  assert.ok(invitationExpiryReminder(atBoundary, now));
  assert.equal(invitationExpiryReminder({ ...atBoundary, expires_at: '2026-10-19T08:00:00.001Z' }, now), null);
  assert.ok(invitationExpiryReminder({ ...base, expires_at: '2026-10-19T09:00:00+02:00' }, now));
  assert.equal(invitationExpiryReminder({ ...base, expires_at: now }, now), null);
  assert.equal(invitationExpiryReminder({ ...base, expires_at: '2026-10-18T07:59:59Z' }, now), null);
});

test('fails closed when preference, state, role or live authorization is absent', () => {
  const changes = [
    { enabled: false },
    { status: 'accepted' as const },
    { status: 'declined' as const },
    { status: 'revoked' as const },
    { project_archived: true },
    { recipient_active: false },
    { recipient_has_role: false },
    { sender_active_member: false },
  ];
  for (const change of changes) assert.equal(invitationExpiryReminder({ ...base, ...change }, now), null);
});

test('rejects malformed identifiers and timestamps without throwing or copying arbitrary fields', () => {
  for (const change of [
    { invitation_id: 'not-a-uuid' },
    { project_id: '//evil.invalid' },
    { expires_at: 'tomorrow' },
    { expires_at: '2026-10-19T07:00:00' },
  ]) assert.equal(invitationExpiryReminder({ ...base, ...change }, now), null);
  assert.equal(invitationExpiryReminder(base, 'invalid'), null);
  const polluted = { ...base, recipient_email: 'private@example.invalid', message: 'PRIVATE', href: 'javascript:alert(1)' };
  assert.ok(!JSON.stringify(invitationExpiryReminder(polluted, now)).includes('PRIVATE'));
});

test('event key is stable across retries and differs across invitations', () => {
  const first = invitationExpiryReminder(base, now)!;
  assert.equal(invitationExpiryReminder(base, '2026-10-18T09:00:00Z')!.event_key, first.event_key);
  const other = invitationExpiryReminder({ ...base, invitation_id: '33333333-3333-4333-8333-333333333333' }, now)!;
  assert.notEqual(other.event_key, first.event_key);
});
