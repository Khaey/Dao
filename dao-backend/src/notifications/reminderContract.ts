export type ReminderWorkspace = 'client' | 'contractor';
export type ReminderSeverity = 'action_required';
export type ReminderKind = 'invitation_expiring';

export type InvitationReminderInput = {
  invitation_id: string;
  project_id: string;
  expected_role: ReminderWorkspace;
  status: 'pending' | 'accepted' | 'declined' | 'revoked';
  expires_at: string;
  project_archived: boolean;
  recipient_active: boolean;
  recipient_has_role: boolean;
  sender_active_member: boolean;
  enabled: boolean;
};

export type InvitationReminder = {
  kind: ReminderKind;
  severity: ReminderSeverity;
  workspace: ReminderWorkspace;
  invitation_id: string;
  project_id: string;
  expires_at: string;
  event_key: string;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const INVITATION_REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;

function instant(value: string): number | null {
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Pure S2 eligibility contract. The database command must re-check the same
 * facts atomically before insert; a dry-run result never grants visibility.
 */
export function invitationExpiryReminder(input: InvitationReminderInput, now: string): InvitationReminder | null {
  const current = instant(now);
  const expiry = instant(input.expires_at);
  if (current === null || expiry === null || !uuid.test(input.invitation_id) || !uuid.test(input.project_id)) return null;
  if (!input.enabled || input.status !== 'pending' || input.project_archived || !input.recipient_active
      || !input.recipient_has_role || !input.sender_active_member) return null;
  const remaining = expiry - current;
  if (remaining <= 0 || remaining > INVITATION_REMINDER_WINDOW_MS) return null;
  return {
    kind: 'invitation_expiring',
    severity: 'action_required',
    workspace: input.expected_role,
    invitation_id: input.invitation_id,
    project_id: input.project_id,
    expires_at: input.expires_at,
    event_key: `invitation_expiring:${input.invitation_id}:24h`,
  };
}
