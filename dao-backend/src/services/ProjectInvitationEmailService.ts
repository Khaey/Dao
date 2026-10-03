import { createHash, timingSafeEqual } from 'node:crypto';
import { DomainError } from '../lib/errors.js';
import { InvitationAuthorization, InvitationMetadata, invitationMetadataColumns } from './InvitationAuthorization.js';
import type { EmailConfiguration, EmailTransport } from './ResendEmailTransport.js';

export const invitationSecretColumns = `${invitationMetadataColumns},recipient_name,token_hash`;
export type InvitationWithHash = InvitationMetadata & { recipient_name: string | null; token_hash: string };
export type InvitationHashReader = (id: string) => Promise<InvitationWithHash | null>;

function unavailable(): never { throw new DomainError('Invitation indisponible.', 'INVITATION_UNAVAILABLE'); }
export function invitationTokenMatches(token: string, hash: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(token) || !/^[a-f0-9]{64}$/.test(hash)) return false;
  // Identical to SQL encode(sha256(convert_to(token,'UTF8')),'hex').
  return timingSafeEqual(createHash('sha256').update(token, 'utf8').digest(), Buffer.from(hash, 'hex'));
}
function pending(invitation: InvitationMetadata, now: number) {
  const expiry = Date.parse(invitation.expires_at);
  if (invitation.status !== 'pending' || !Number.isFinite(expiry) || expiry <= now || invitation.accepted_at || invitation.revoked_at || invitation.declined_at || !['client', 'contractor'].includes(invitation.expected_role)) unavailable();
}
function maskEmail(email: string) { const [local, domain] = email.split('@'); return `${local.slice(0, 1)}***@${domain}`; }

export class ProjectInvitationEmailService {
  constructor(
    private readonly authorization: InvitationAuthorization,
    private readonly readHash: InvitationHashReader,
    private readonly transport: EmailTransport,
    private readonly configuration: () => EmailConfiguration,
    private readonly now: () => number = Date.now,
  ) {}

  async send(actorId: string, id: string, token: string) {
    // Everything up to readHash uses the caller's authenticated JWT and RLS.
    const visible = await this.authorization.visibleInvitation(id);
    const initial = await this.authorization.management(actorId, visible);
    if (initial.project.status === 'archived') unavailable();
    pending(visible, this.now());
    const config = this.configuration();
    const invitation = await this.readHash(id);
    if (!invitation || invitation.id !== id || invitation.project_id !== visible.project_id || invitation.created_by !== visible.created_by || invitation.expected_role !== visible.expected_role || invitation.principal_request_id !== visible.principal_request_id) unavailable();
    pending(invitation, this.now());
    if (!invitationTokenMatches(token, invitation.token_hash)) throw new DomainError('Invitation indisponible.', 'FORBIDDEN');
    const recipient = invitation.recipient_email;
    if (!recipient || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient)) throw new DomainError('Cette invitation ne comporte pas d’adresse e-mail. Copiez le lien.', 'INVITATION_NO_EMAIL');
    const details = await this.authorization.emailDetails(invitation.project_id, token);
    // Recheck current JWT authority/project lifecycle after the sensitive read.
    const current = await this.authorization.management(actorId, invitation);
    if (current.project.status === 'archived') unavailable();
    pending(invitation, this.now());
    await this.transport.sendProjectInvitationEmail({
      to: recipient,
      recipientName: invitation.recipient_name,
      inviterName: details.inviterName,
      title: details.title,
      location: details.location,
      principalLot: details.principalLot,
      expectedRole: invitation.expected_role,
      url: `${config.publicUrl}/invite/${token}`,
      expiresAt: invitation.expires_at,
      invitationId: id,
    }, config);
    return { sent: true, recipient_masked: maskEmail(recipient) };
  }
}
