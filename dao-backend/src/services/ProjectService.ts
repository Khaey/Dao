import { DomainError } from '../lib/errors.js';
import { InvitationAuthorization, invitationRole } from './InvitationAuthorization.js';

function optionalNumber(value: unknown) {
  return value === null || value === undefined || value === '' ? null : Number(value);
}

function optionalDate(value: unknown) {
  return value === null || value === undefined || value === '' ? null : String(value);
}

export class ProjectService {
  constructor(private readonly db: any) {}

  async create(input: Record<string, unknown>) {
    if (input.project_origin != null && input.project_origin !== 'client_marketplace') {
      if (input.project_origin !== 'client_existing_team' && input.project_origin !== 'contractor_existing_client') {
        throw new DomainError('Origine du chantier invalide', 'BAD_REQUEST');
      }
      if (input.project_origin === 'client_existing_team' && Array.isArray(input.team)) {
        if (input.team.length < 1) throw new DomainError('Ajoutez au moins un artisan et son lot principal.', 'BAD_REQUEST');
        return this.command('create_client_existing_team_project', {
          p_title: String(input.title ?? ''),
          p_description: String(input.description ?? ''),
          p_governorate_id: input.governorate_id,
          p_delegation_id: input.delegation_id ?? null,
          p_locality_id: input.locality_id ?? null,
          p_stage: input.project_stage ?? 'not_started',
          p_payment_status: input.payment_status ?? 'not_set',
          p_team: input.team,
        });
      }
      return this.command('create_collaborative_project', {
        p_origin: input.project_origin,
        p_title: String(input.title ?? ''),
        p_description: String(input.description ?? ''),
        p_governorate_id: input.governorate_id,
        p_delegation_id: input.delegation_id ?? null,
        p_locality_id: input.locality_id ?? null,
        p_stage: input.project_stage ?? 'not_started',
        p_payment_status: input.payment_status ?? 'not_set',
      });
    }
    const { data, error } = await this.db.rpc('create_project_draft', {
      p_project_type: String(input.project_type ?? 'other'),
      p_surface_m2: optionalNumber(input.surface_m2),
      p_desired_start_date: optionalDate(input.desired_start_date),
      p_desired_end_date: optionalDate(input.desired_end_date),
      p_indicative_budget_millimes: optionalNumber(input.indicative_budget_millimes),
      p_governorate_id: input.governorate_id,
      p_delegation_id: input.delegation_id ?? null,
      p_locality_id: input.locality_id ?? null,
    });
    if (error) throw error;
    return data;
  }

  async updateDraft(input: Record<string, unknown>) {
    if (!input.project_id) throw new DomainError('Project is required', 'BAD_REQUEST');

    const projectId = String(input.project_id);
    let governorateId = input.governorate_id;
    let delegationId = input.delegation_id;
    let localityId = input.locality_id;

    // The project details screen edits general fields without resending location.
    // Preserve the current version's location instead of omitting the required
    // governorate RPC argument or clearing delegation/locality to null.
    if (governorateId === undefined || delegationId === undefined || localityId === undefined) {
      const { data: currentVersion, error: currentVersionError } = await this.db
        .from('project_versions')
        .select('governorate_id,delegation_id,locality_id')
        .eq('project_id', projectId)
        .order('version_no', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (currentVersionError) throw currentVersionError;

      if (governorateId === undefined) governorateId = currentVersion?.governorate_id ?? null;
      if (delegationId === undefined) delegationId = currentVersion?.delegation_id ?? null;
      if (localityId === undefined) localityId = currentVersion?.locality_id ?? null;
    }

    const { data, error } = await this.db.rpc('update_project_draft', {
      p_project_id: projectId,
      p_title: String(input.title ?? ''),
      p_description: String(input.description ?? ''),
      p_project_type: String(input.project_type ?? 'other'),
      p_surface_m2: optionalNumber(input.surface_m2),
      p_desired_start_date: optionalDate(input.desired_start_date),
      p_desired_end_date: optionalDate(input.desired_end_date),
      p_indicative_budget_millimes: optionalNumber(input.indicative_budget_millimes),
      p_governorate_id: governorateId,
      p_delegation_id: delegationId ?? null,
      p_locality_id: localityId ?? null,
    });
    if (error) throw error;
    return data;
  }

  async addRequest(input: Record<string, unknown>) {
    const { data, error } = await this.db.rpc('add_project_request', {
      p_project_id: input.project_id,
      p_trade_id: input.trade_id,
      p_title: input.title,
      p_scope: input.scope,
      p_budget_millimes: optionalNumber(input.budget_millimes),
    });
    if (error) throw error;
    return data;
  }

  async updateRequest(input: Record<string, unknown>) {
    const { data, error } = await this.db.rpc('update_project_request', {
      p_request_id: input.request_id,
      p_trade_id: input.trade_id,
      p_title: input.title,
      p_scope: input.scope,
      p_budget_millimes: optionalNumber(input.budget_millimes),
    });
    if (error) throw error;
    return data;
  }

  async submitForReview(projectId: string) {
    const { data, error } = await this.db.rpc('submit_project_for_review', { p_project_id: projectId });
    if (error) throw error;
    return data;
  }

  async review(projectId: string, approve: boolean, comment?: string) {
    const { data, error } = await this.db.rpc('review_project', {
      p_project_id: projectId,
      p_approve: approve,
      p_comment: comment ?? null,
    });
    if (error) throw error;
    return data;
  }

  async createCorrection(projectId: string) {
    const { data, error } = await this.db.rpc('create_project_correction', { p_project_id: projectId });
    if (error) throw error;
    return data;
  }

  async archive(projectId: string) {
    const { data, error } = await this.db.rpc('archive_project', { p_project_id: projectId });
    if (error) throw error;
    return data;
  }

  async upsertPrivateDetails(input: Record<string, unknown>) {
    const { data, error } = await this.db.rpc('upsert_project_private_details', {
      p_project_id: input.project_id,
      p_exact_address: input.exact_address ?? null,
      p_access_instructions: input.access_instructions ?? null,
      p_contact_phone: input.contact_phone ?? null,
      p_contact_email: input.contact_email ?? null,
    });
    if (error) throw error;
    return data;
  }

  async withdrawRequest(requestId: string) {
    const { data, error } = await this.db.rpc('withdraw_project_request', { p_request_id: requestId });
    if (error) throw error;
    return data;
  }

  async get(id: string) {
    const { data, error } = await this.db.from('projects').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
  }

  private async command(name: string, input: Record<string, unknown>) {
    const { data, error } = await this.db.rpc(name, input);
    if (error) throw error;
    return data;
  }

  async issueInvitation(input: Record<string, unknown>, actorId: string) {
    const role = invitationRole(input.expected_role);
    await new InvitationAuthorization(this.db).issuance(actorId, String(input.project_id ?? ''), role);
    return this.command('issue_project_invitation', {
      p_project_id: input.project_id,
      p_expected_role: role,
      p_recipient_email: input.recipient_email ?? null,
      p_recipient_name: input.recipient_name ?? null,
      p_principal_request_id: input.request_id ?? null,
      p_can_view_private_details: input.can_view_private_details === true,
    });
  }

  async previewInvitation(token: string) {
    return this.command('preview_project_invitation', { p_token: token });
  }

  async invitationRegistrationContext(token: string) {
    return this.command('project_invitation_registration_context', { p_token: token });
  }

  async respondInvitation(input: Record<string, unknown>) {
    if (typeof input.accept !== 'boolean') throw new DomainError('Réponse explicite obligatoire', 'BAD_REQUEST');
    return this.command('respond_project_invitation', { p_token: input.token, p_accept: input.accept });
  }

  async revokeInvitation(id: string, actorId: string) {
    const authorization = new InvitationAuthorization(this.db);
    await authorization.management(actorId, await authorization.visibleInvitation(id));
    return this.command('revoke_project_invitation', { p_invitation_id: id });
  }

  async updateMember(input: Record<string, unknown>) {
    return this.command('update_project_member', {
      p_member_id: input.member_id,
      p_revoke: input.revoke === true,
      p_can_view_private_details: typeof input.can_view_private_details === 'boolean' ? input.can_view_private_details : null,
    });
  }

  async team(projectId: string) {
    return this.command('project_team', { p_project_id: projectId });
  }

  async tracking(input: Record<string, unknown>) {
    return this.command('update_project_tracking', {
      p_project_id: input.project_id, p_stage: input.project_stage, p_payment_status: input.payment_status,
    });
  }

  async assignMember(input: Record<string, unknown>) {
    return this.command('assign_project_request_member', { p_request_id: input.request_id, p_member_id: input.member_id ?? null });
  }

  // Kept for read-only compatibility with older server callers.  All writes
  // use the guarded RPC commands above.
  async update(_id: string, patch: Record<string, unknown>) {
    if ('client_id' in patch) throw new DomainError('client_id is immutable');
    throw new DomainError('Direct project writes are disabled; use updateDraft', 'BAD_REQUEST');
  }

  async confirmClient(id: string) {
    return this.submitForReview(id);
  }

  async submitForDaoReview(id: string) {
    return this.submitForReview(id);
  }
}
