import type { BackendServices } from './actions.js';
import * as actions from './actions.js';
import { requireActor, type AuthenticatedActor } from './auth.js';
export function createDaoApi(services: BackendServices, resolveActor: (authorization: string | null) => Promise<AuthenticatedActor | null>) {
  async function actor(request: Request): Promise<AuthenticatedActor> { return requireActor(await resolveActor(request.headers.get('authorization'))); }
  async function json(request: Request) { return await request.json() as Record<string, unknown>; }
  return {
    async createProject(request: Request) { return run(() => actor(request).then(a => json(request).then(i => actions.createProject(services, a, i)))); },
    async updateProjectDraft(request: Request) { return run(() => actor(request).then(a => json(request).then(i => actions.updateProjectDraft(services, a, i)))); },
    async submitProjectForReview(request: Request) { const i=await json(request); return run(() => actor(request).then(a => actions.submitProjectForReview(services,a,String(i.project_id)))); },
    async reviewProject(request: Request) { return run(() => actor(request).then(a => json(request).then(i => actions.reviewProject(services,a,i)))); },
    async addProjectRequest(request: Request) { return run(() => actor(request).then(a => json(request).then(i => actions.addProjectRequest(services, a, i)))); },
    async updateProjectRequest(request: Request) { return run(() => actor(request).then(a => json(request).then(i => actions.updateProjectRequest(services, a, i)))); },
    async withdrawProjectRequest(request: Request) { const i=await json(request); return run(() => actor(request).then(a => actions.withdrawProjectRequest(services, a, String(i.request_id)))); },
    async publishProject(request: Request) { return run(() => actor(request).then(a => json(request).then(i => actions.publishProject(services,a,i)))); },
    async createBidDraft(request: Request) { return run(() => actor(request).then(a => json(request).then(i => actions.createBid(services, a, i)))); },
    async addBidItem(request: Request) { return run(() => actor(request).then(a => json(request).then(i => actions.addBidItem(services, a, i)))); },
    async submitBid(request: Request) { const i=await json(request); const versionId=i.version_id ?? i.versionId; return run(() => actor(request).then(a => actions.submitBid(services,a,String(versionId ?? '')))); },
    async awardRequest(request: Request) { return run(() => actor(request).then(a => json(request).then(i => actions.awardRequest(services,a,i)))); },
    async signedUpload(request: Request) { return run(() => actor(request).then(a => json(request).then(i => actions.signedUpload(services,a,i as never)))); },
    async signedDownload(request: Request) { const i=await json(request); return run(() => actor(request).then(a => actions.signedDownload(services,a,String(i.documentId),Number(i.expiresIn)||300))); }
  };
}
async function run(operation: () => Promise<unknown>) { try { return Response.json({ data: await operation() }); } catch (error: any) { const code=error?.code; const status = code === 'UNAUTHENTICATED' ? 401 : code === 'FORBIDDEN' || code === '42501' ? 403 : ['23505','23514','P0001'].includes(code) ? 409 : 400; return Response.json({ error: error?.message ?? 'Request failed', code }, { status }); } }
