import type { NativeExecutionPlanDTO, NativeExecutionPlanRpcDTO } from '../native-tracking/contract.js';
import { projectNativeForecast } from '../native-tracking/forecast.js';

const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createNativeExecutionPlanHandler(
  db: { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: NativeExecutionPlanRpcDTO | null; error: any }> },
  resolveActor: (authorization: string | null) => Promise<{ id: string } | null>,
) {
  const fail = (status: number, code: string, error: string, extra: Record<string, string> = {}) =>
    Response.json({ error, code }, { status, headers: { ...headers, ...extra } });

  return async (request: Request) => {
    try {
      if (!await resolveActor(request.headers.get('authorization'))) return fail(401, 'UNAUTHENTICATED', 'Authentification requise.');
      if (request.method !== 'GET') return fail(405, 'METHOD_NOT_ALLOWED', 'Méthode refusée.', { Allow: 'GET' });
      const query = new URL(request.url).searchParams;
      if ([...query.keys()].some(key => !['project_id', 'cursor', 'limit'].includes(key))
        || ['project_id', 'cursor', 'limit'].some(key => query.getAll(key).length > 1)) {
        return fail(400, 'BAD_REQUEST', 'Paramètres invalides.');
      }
      const projectId = query.get('project_id') ?? '';
      const cursor = query.get('cursor');
      const limitText = query.get('limit');
      const limit = limitText === null ? 50 : Number(limitText);
      if (!UUID.test(projectId) || (cursor !== null && !UUID.test(cursor))
        || !Number.isInteger(limit) || limit < 1 || limit > 100 || (limitText !== null && !/^\d+$/.test(limitText))) {
        return fail(400, 'BAD_REQUEST', 'Paramètres invalides.');
      }
      const { data, error } = await db.rpc('native_execution_plan_v1', {
        p_project_id: projectId.toLowerCase(),
        p_after_request_id: cursor?.toLowerCase() ?? null,
        p_limit: limit,
      });
      if (error) {
        if (error.code === '42501') return fail(403, 'FORBIDDEN', 'Accès au suivi du projet refusé.');
        if (error.code === 'P0002') return fail(404, 'NOT_FOUND', 'Projet introuvable.');
        if (error.code === '22023') return fail(400, 'BAD_REQUEST', 'Paramètres invalides.');
        return fail(503, 'UNAVAILABLE', 'Suivi du projet temporairement indisponible.');
      }
      if (!data) return fail(503, 'UNAVAILABLE', 'Projection native indisponible.');
      // The RPC returns a project workspace only after verifying the caller's
      // JWT, active account and project/award scope. Keep record-level actions
      // governed by their existing RPC permissions.
      const capabilities = {
        canReadTracking: true,
        canReadInspections: true,
        canReadWorkSituations: true,
        canComment: ['client', 'contractor', 'dao_manager'].includes(data.viewer?.workspace),
      };
      const { data: dependencies, error: dependencyError } = await db.rpc('native_execution_dependencies_v1', {
        p_project_id: projectId.toLowerCase(),
      });
      if (dependencyError || !Array.isArray(dependencies)) {
        if (dependencyError?.code === '42501') return fail(403, 'FORBIDDEN', 'Accès au suivi du projet refusé.');
        return fail(503, 'UNAVAILABLE', 'Dépendances du planning temporairement indisponibles.');
      }
      data.dependencies = dependencies as NativeExecutionPlanDTO['dependencies'];
      let forecast = data.forecast;
      if (cursor === null && data.page.nextCursor === null) {
        forecast = projectNativeForecast([data as NativeExecutionPlanDTO]);
      } else {
        const pages: NativeExecutionPlanDTO[] = [];
        let after: string | null = null;
        let truncated = false;
        for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
          const pageResult = await db.rpc('native_execution_plan_v1', {
            p_project_id: projectId.toLowerCase(), p_after_request_id: after, p_limit: 100,
          });
          if (pageResult.error || !pageResult.data) { pages.length = 0; break; }
          pages.push(pageResult.data as NativeExecutionPlanDTO);
          after = pageResult.data.page.nextCursor;
          if (!after) break;
          if (pageNumber === 9) truncated = true;
        }
        if (pages.length) {
          pages[0].dependencies = dependencies as NativeExecutionPlanDTO['dependencies'];
          forecast = projectNativeForecast(pages, truncated);
        }
        else forecast = null;
      }
      return Response.json({ data: { ...data, ...capabilities, dependencies, forecast } }, { headers });
    } catch {
      return fail(503, 'UNAVAILABLE', 'Suivi du projet temporairement indisponible.');
    }
  };
}
