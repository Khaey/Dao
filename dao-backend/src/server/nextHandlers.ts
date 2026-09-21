import type { BackendServices } from './actions.js';
import * as actions from './actions.js';
import type { AuthenticatedActor } from './auth.js';

/** Adapter used from Next.js App Router route.ts files. The caller supplies a
 * server-side JWT resolver (typically supabase.auth.getUser(token)). */
export function createDaoApi(services: BackendServices, resolveActor: (authorization: string | null) => Promise<AuthenticatedActor | null>) {
  async function actor(request: Request) { return resolveActor(request.headers.get('authorization')); }
  async function json(request: Request) { return await request.json() as Record<string, unknown>; }
  return {
    async createProject(request: Request) { return run(() => actor(request).then(a => json(request).then(i => actions.createProject(services, a, i)))); },
    async addProjectRequest(request: Request) { return run(() => actor(request).then(a => json(request).then(i => actions.addProjectRequest(services, a, i)))); },
    async submitBid(request: Request) { const i=await json(request); return run(() => actor(request).then(a => actions.submitBid(services,a,String(i.versionId)))); },
    async awardRequest(request: Request) { return run(() => actor(request).then(a => json(request).then(i => actions.awardRequest(services,a,i)))); },
    async signedUpload(request: Request) { return run(() => actor(request).then(a => json(request).then(i => actions.signedUpload(services,a,i as never)))); },
    async signedDownload(request: Request) { const i=await json(request); return run(() => actor(request).then(a => actions.signedDownload(services,a,String(i.documentId),Number(i.expiresIn)||300))); }
  };
}

async function run(operation: () => Promise<unknown>) {
  try { return Response.json({ data: await operation() }); }
  catch (error: any) { const status = error?.code === 'UNAUTHENTICATED' ? 401 : error?.code === 'FORBIDDEN' ? 403 : 400; return Response.json({ error: error?.message ?? 'Request failed', code: error?.code }, { status }); }
}
