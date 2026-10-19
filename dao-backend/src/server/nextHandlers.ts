import type { BackendServices } from './actions.js';
import * as actions from './actions.js';
import { requireActor, type AuthenticatedActor } from './auth.js';

export function createDaoApi(
  services: BackendServices,
  resolveActor: (authorization: string | null) => Promise<AuthenticatedActor | null>,
) {
  async function actor(request: Request): Promise<AuthenticatedActor> {
    return requireActor(await resolveActor(request.headers.get('authorization')));
  }
  async function json(request: Request) {
    return await request.json() as Record<string, unknown>;
  }

  return {
    async exportBidQuote(request: Request) {
      try { await actor(request); const versionId=new URL(request.url).searchParams.get('version_id')??''; const pdf=await services.quotePdf.export(versionId); return new Response(pdf.bytes as BodyInit,{headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${pdf.filename}"`,'Cache-Control':'private, no-store'}}); }
      catch(error:any){return Response.json({error:error?.message??'Request failed',code:error?.code},{status:error?.code==='UNAUTHENTICATED'?401:error?.code==='NOT_FOUND'?404:403});}
    },
    async listContracts(request: Request) {
      return run(() => actor(request).then(() => services.contracts.list()));
    },
    async contractDetail(request: Request, contractId: string) {
      return run(() => actor(request).then(() => services.contracts.detail(contractId)));
    },
    async listConversations(request: Request) {
      return run(() => actor(request).then(() => services.messages.listConversations()));
    },
    async openConversation(request: Request) {
      return run(() => actor(request).then(() => json(request).then(i => services.messages.open(String(i.project_id ?? ''), String(i.contractor_id ?? ''), String(i.member_id ?? '')))));
    },
    async listMessages(request: Request) {
      return run(() => actor(request).then(() => { const q=new URL(request.url).searchParams; return services.messages.listMessages(q.get('conversation_id') ?? '',q.get('before'),Number(q.get('limit') ?? 30)); }));
    },
    async sendMessage(request: Request) {
      return run(() => actor(request).then(() => json(request).then(i => services.messages.send(String(i.conversation_id ?? ''),String(i.body ?? ''),String(i.idempotency_key ?? '')))));
    },
    async markConversationRead(request: Request) {
      return run(() => actor(request).then(() => json(request).then(i => services.messages.markRead(String(i.conversation_id ?? '')))));
    },
    async issueProjectInvitation(request: Request) {
      return run(() => actor(request).then(a => json(request).then(i => services.projects.issueInvitation(i, a.id))));
    },
    async previewProjectInvitation(request: Request) {
      return run(() => json(request).then(i => services.projects.previewInvitation(String(i.token ?? ''))));
    },
    async projectInvitationRegistrationContext(request: Request) {
      return run(() => json(request).then(i => services.projects.invitationRegistrationContext(String(i.token ?? ''))));
    },
    async respondProjectInvitation(request: Request) {
      return run(() => actor(request).then(() => json(request).then(i => services.projects.respondInvitation(i))));
    },
    async revokeProjectInvitation(request: Request) {
      return run(() => actor(request).then(a => json(request).then(i => services.projects.revokeInvitation(String(i.invitation_id ?? ''), a.id))));
    },
    async updateProjectMember(request: Request) {
      return run(() => actor(request).then(() => json(request).then(i => services.projects.updateMember(i))));
    },
    async projectTeam(request: Request) {
      return run(() => actor(request).then(() => services.projects.team(new URL(request.url).searchParams.get('project_id') ?? '')));
    },
    async updateProjectTracking(request: Request) {
      return run(() => actor(request).then(() => json(request).then(i => services.projects.tracking(i))));
    },
    async siteExecutionSnapshot(request: Request) {
      return run(() => actor(request).then(() => {
        const query = new URL(request.url).searchParams;
        return services.siteExecution.snapshot(query.get('project_id') ?? '', query.get('before'), Number(query.get('limit') ?? 30));
      }));
    },
    async recordSiteExecution(request: Request) {
      return run(() => actor(request).then(() => json(request).then(input => {
        if (input.kind === 'progress') return services.siteExecution.progress(input);
        if (input.kind === 'intervention') return services.siteExecution.intervention(input);
        if (input.kind === 'milestone') return services.siteExecution.createMilestone(input);
        throw Object.assign(new Error('Invalid site execution kind'), { code: 'BAD_REQUEST' });
      })));
    },
    async updateSiteMilestone(request: Request) {
      return run(() => actor(request).then(() => json(request).then(input => services.siteExecution.updateMilestone(input))));
    },
    async recordSiteObservation(request: Request) {
      return run(() => actor(request).then(() => json(request).then(input => services.siteExecution.observation(input))));
    },
    async assignProjectMember(request: Request) {
      return run(() => actor(request).then(() => json(request).then(i => services.projects.assignMember(i))));
    },
    async shareProjectDocument(request: Request) {
      return run(() => actor(request).then(() => json(request).then(i => services.documents.setProjectSharing(String(i.document_id ?? ''), String(i.share_scope ?? '')))));
    },
    async createProject(request: Request) {
      return run(() => actor(request).then(a => json(request).then(i => actions.createProject(services, a, i))));
    },
    async updateProjectDraft(request: Request) {
      return run(() => actor(request).then(a => json(request).then(i => actions.updateProjectDraft(services, a, i))));
    },
    async createProjectCorrection(request: Request) {
      return run(() => actor(request).then(a => json(request).then(i => actions.createProjectCorrection(services, a, String(i.project_id)))));
    },
    async archiveProject(request: Request) {
      return run(() => actor(request).then(a => json(request).then(i => actions.archiveProject(services, a, String(i.project_id)))));
    },
    async upsertProjectPrivateDetails(request: Request) {
      return run(() => actor(request).then(a => json(request).then(i => actions.upsertProjectPrivateDetails(services, a, i))));
    },
    async submitProjectForReview(request: Request) {
      return run(() => actor(request).then(a => json(request).then(i => actions.submitProjectForReview(services, a, String(i.project_id)))));
    },
    async reviewProject(request: Request) {
      return run(() => actor(request).then(a => json(request).then(i => actions.reviewProject(services, a, i))));
    },
    async addProjectRequest(request: Request) {
      return run(() => actor(request).then(a => json(request).then(i => actions.addProjectRequest(services, a, i))));
    },
    async updateProjectRequest(request: Request) {
      return run(() => actor(request).then(a => json(request).then(i => actions.updateProjectRequest(services, a, i))));
    },
    async withdrawProjectRequest(request: Request) {
      return run(() => actor(request).then(a => json(request).then(i => actions.withdrawProjectRequest(services, a, String(i.request_id)))));
    },
    async publishProject(request: Request) {
      return run(() => actor(request).then(a => json(request).then(i => actions.publishProject(services, a, i))));
    },
    async createBidDraft(request: Request) {
      return run(() => actor(request).then(a => json(request).then(i => actions.createBid(services, a, i))));
    },
    async addBidItem(request: Request) {
      return run(() => actor(request).then(a => json(request).then(i => actions.addBidItem(services, a, i))));
    },
    async submitBid(request: Request) {
      return run(() => actor(request).then(a => json(request).then(i => actions.submitBid(services, a, String(i.version_id ?? i.versionId ?? '')))));
    },
    async withdrawBid(request: Request) {
      return run(() => actor(request).then(a => json(request).then(i => actions.withdrawBid(services, a, String(i.version_id ?? i.versionId ?? '')))));
    },
    async cancelAward(request: Request) {
      return run(() => actor(request).then(a => json(request).then(i => actions.cancelAward(services, a, i))));
    },
    async configureBidPackage(request: Request) {
      return run(() => actor(request).then(a => json(request).then(i => actions.configureBidPackage(services, a, i))));
    },
    async awardRequest(request: Request) {
      return run(() => actor(request).then(a => json(request).then(i => actions.awardRequest(services, a, i))));
    },
    async signedUpload(request: Request) {
      return run(() => actor(request).then(a => json(request).then(i => actions.signedUpload(services, a, i as never))));
    },
    async completeBidQuoteUpload(request: Request) {
      return run(() => actor(request).then(a => json(request).then(i => actions.completeBidQuoteUpload(services, a, String(i.document_id ?? '')))));
    },
    async deleteBidQuote(request: Request) {
      return run(() => actor(request).then(a => json(request).then(i => actions.deleteBidQuote(services, a, String(i.document_id ?? '')))));
    },
    async updateBidQuoteMetadata(request: Request) {
      return run(() => actor(request).then(a => json(request).then(i => actions.updateBidQuoteMetadata(services, a, i))));
    },
    async replaceBidQuoteLines(request: Request) {
      return run(() => actor(request).then(a => json(request).then(i => actions.replaceBidQuoteLines(services, a, i))));
    },
    async signedDownload(request: Request) {
      return run(() => actor(request).then(a => json(request).then(i => actions.signedDownload(services, a, String(i.documentId ?? i.document_id), Number(i.expiresIn) || 300))));
    },
    async listProjectDocuments(request: Request) {
      return run(() => actor(request).then(a => {
        const projectId = new URL(request.url).searchParams.get('project_id') ?? '';
        return actions.listProjectDocuments(services, a, projectId);
      }));
    },
    async signedProjectUpload(request: Request) {
      return run(() => actor(request).then(a => json(request).then(i => actions.signedProjectUpload(services, a, i))));
    },
    async signedProjectDownload(request: Request) {
      return run(() => actor(request).then(a => json(request).then(i => actions.signedProjectDownload(services, a, String(i.document_id ?? i.documentId), Number(i.expires_in ?? i.expiresIn) || 300))));
    },
    async deleteProjectDocument(request: Request) {
      return run(() => actor(request).then(a => json(request).then(i => actions.deleteProjectDocument(services, a, String(i.document_id ?? i.documentId)))));
    },
    async initializeProfile(request: Request) {
      return run(() => actor(request).then(a => json(request).then(i => actions.initializeProfile(services, a, i))));
    },
    async updateProfile(request: Request) {
      return run(() => actor(request).then(a => json(request).then(i => actions.updateProfile(services, a, i))));
    },
    async generateAiProposal(request: Request) {
      return run(() => actor(request).then(a => json(request).then(i => actions.generateAiProposal(services, a, i))));
    },
    async acceptAiProposal(request: Request) {
      return run(() => actor(request).then(a => json(request).then(i => actions.acceptAiProposal(services, a, String(i.proposal_id ?? i.proposalId)))));
    },
    async rejectAiProposal(request: Request) {
      return run(() => actor(request).then(a => json(request).then(i => actions.rejectAiProposal(services, a, String(i.proposal_id ?? i.proposalId)))));
    },
  };
}

async function run(operation: () => Promise<unknown>) {
  try {
    return Response.json({ data: await operation() });
  } catch (error: any) {
    const code = error?.code;
    let status = 500;
    if (code === 'UNAUTHENTICATED') status = 401;
    else if (code === 'FORBIDDEN' || code === '42501' || code === 'PGRST116') status = 403;
    else if (code === 'NOT_FOUND') status = 404;
    else if (code === 'BAD_REQUEST' || code === '22023' || code === 'INVALID_MIME' || code === 'INVALID_SIZE' || code === 'INVALID_PATH' || code === 'INVALID_PDF') status = 400;
    else if (['23505', '23514', 'P0001', 'BID_DRAFT_METADATA_UNSUPPORTED'].includes(code)) status = 409;
    return Response.json({ error: error?.message ?? 'Request failed', code }, { status });
  }
}
