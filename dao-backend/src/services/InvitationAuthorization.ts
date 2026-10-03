import { DomainError } from '../lib/errors.js';

export type InvitationRole = 'client' | 'contractor';
export type InvitationMetadata = {
  id: string; project_id: string; created_by: string; expected_role: InvitationRole;
  recipient_email: string | null; principal_request_id: string | null; status: string; expires_at: string;
  accepted_at: string | null; revoked_at: string | null; declined_at: string | null;
};
export const invitationMetadataColumns = 'id,project_id,created_by,expected_role,recipient_email,principal_request_id,status,expires_at,accepted_at,revoked_at,declined_at';

export function invitationRole(value: unknown): InvitationRole {
  if (value !== 'client' && value !== 'contractor') throw new DomainError('Type de participant invalide', 'BAD_REQUEST');
  return value;
}

// Shared API preflight for issuance, revocation and email. Authority comes from
// the existing JWT-scoped project_team RPC, which evaluates owner() and
// can_prepare_project(). Do not infer those permissions from browser identities.
// The unchanged SQL commands remain the atomic boundary for every mutation.
export class InvitationAuthorization {
  constructor(private readonly db: any) {}

  private async context(projectId: string) {
    const { data: team, error: teamError } = await this.db.rpc('project_team', { p_project_id: projectId });
    if (teamError || !team) throw new DomainError('Invitation indisponible.', 'FORBIDDEN');
    const { data: project, error } = await this.db.from('projects')
      .select('id,status,client_id,initiator_id,project_origin').eq('id', projectId).maybeSingle();
    if (error || !project || project.id !== projectId) throw new DomainError('Invitation indisponible.', 'FORBIDDEN');
    return { team, project };
  }

  async visibleInvitation(id: string): Promise<InvitationMetadata> {
    const { data, error } = await this.db.from('project_invitations')
      .select(invitationMetadataColumns).eq('id', id).maybeSingle();
    if (error || !data || data.id !== id) throw new DomainError('Invitation indisponible.', 'FORBIDDEN');
    return data;
  }

  async issuance(actorId: string, projectId: string, role: InvitationRole) {
    const { team, project } = await this.context(projectId);
    if (!actorId || team.can_prepare !== true) throw new DomainError('Invitation indisponible.', 'FORBIDDEN');
    // Same role-specific rules as issue_project_invitation: the confirmed client
    // invites contractors; only the contractor initiator invites a pending client.
    if (role === 'client') {
      if (team.is_client || project.client_id !== null || project.initiator_id !== actorId || project.project_origin !== 'contractor_existing_client') {
        throw new DomainError('Invitation indisponible.', 'FORBIDDEN');
      }
    } else if (team.is_client !== true) throw new DomainError('Invitation indisponible.', 'FORBIDDEN');
    if (project.status === 'archived') throw new DomainError('Invitation indisponible.', 'INVITATION_UNAVAILABLE');
  }

  async management(actorId: string, invitation: InvitationMetadata) {
    const { team, project } = await this.context(invitation.project_id);
    // Same management rule as revoke_project_invitation. In particular, staff
    // visibility and an invited contractor membership do not grant management.
    if (!actorId || team.can_prepare !== true || (team.is_client !== true && invitation.created_by !== actorId)) {
      throw new DomainError('Invitation indisponible.', 'FORBIDDEN');
    }
    return { team, project };
  }

  async emailDetails(projectId: string, token: string) {
    const { data, error } = await this.db.rpc('preview_project_invitation', { p_token: token });
    if (error || !data || data.project_id !== projectId || typeof data.title !== 'string' || typeof data.inviter_name !== 'string') {
      throw new DomainError('Invitation indisponible.', 'INVITATION_UNAVAILABLE');
    }
    const principalLot = Array.isArray(data.lots) && data.lots.length === 1 && typeof data.lots[0]?.title === 'string' ? data.lots[0].title.trim() : null;
    return {
      title: data.title,
      inviterName: data.inviter_name,
      location: typeof data.location === 'string' && data.location.trim() ? data.location.trim() : null,
      principalLot: principalLot || null,
    };
  }
}
