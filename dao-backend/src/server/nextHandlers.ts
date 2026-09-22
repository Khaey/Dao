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
    async awardRequest(request: Request) {
      return run(() => actor(request).then(a => json(request).then(i => actions.awardRequest(services, a, i))));
    },
    async signedUpload(request: Request) {
      return run(() => actor(request).then(a => json(request).then(i => actions.signedUpload(services, a, i as never))));
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
    else if (code === 'BAD_REQUEST' || code === 'INVALID_MIME' || code === 'INVALID_SIZE' || code === 'INVALID_PATH') status = 400;
    else if (['23505', '23514', 'P0001', 'BID_DRAFT_METADATA_UNSUPPORTED'].includes(code)) status = 409;
    return Response.json({ error: error?.message ?? 'Request failed', code }, { status });
  }
}
