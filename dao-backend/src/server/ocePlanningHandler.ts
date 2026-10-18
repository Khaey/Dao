import { OceGatewayError, type OceGateway } from '../oce/gatewayContract.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };

/**
 * Read-only technical planning summary of one lot (#58). Authorization is decided by the database with the caller's
 * JWT (oce_summary_access); only then does the server ask the private gateway. Unauthorized, unknown, archived,
 * withdrawn and not-admitted lots all get the same 403. No privileged client, no body/URL/OCE id in logs or answers,
 * and a gateway failure never affects other D.A.O functions.
 */
export function createOcePlanningHandler(
  db: { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: any; error: any }> },
  resolveActor: (header: string | null) => Promise<{ id: string } | null>,
  gateway: OceGateway,
) {
  const fail = (status: number, code: string, error: string, extra: Record<string, string> = {}) =>
    Response.json({ error, code }, { status, headers: { ...headers, ...extra } });
  return async (request: Request) => {
    try {
      if (!await resolveActor(request.headers.get('authorization'))) return fail(401, 'UNAUTHENTICATED', 'Authentification requise.');
      if (request.method !== 'GET') return fail(405, 'METHOD_NOT_ALLOWED', 'Méthode refusée.', { Allow: 'GET' });
      const params = new URL(request.url).searchParams;
      const keys = [...params.keys()].sort().join(',');
      const project = params.get('project_id') ?? '', lot = params.get('lot_id') ?? '';
      if (keys !== 'lot_id,project_id' || !UUID.test(project) || !UUID.test(lot)) return fail(400, 'BAD_REQUEST', 'Paramètres invalides.');
      const { data, error } = await db.rpc('oce_summary_access', { p_project_id: project.toLowerCase(), p_request_id: lot.toLowerCase() });
      if (error) return fail(503, 'UNAVAILABLE', 'Résumé technique temporairement indisponible.');
      if (data !== true) return fail(403, 'FORBIDDEN', 'Accès au résumé technique refusé.');
      const summary = await gateway.planningSummary({ dao_project_id: project.toLowerCase(), dao_lot_id: lot.toLowerCase() });
      return Response.json({ data: summary }, { headers });
    } catch (error: any) {
      if (error instanceof OceGatewayError) {
        if (error.kind === 'disabled') return fail(503, 'OCE_DISABLED', 'Le moteur de planning n’est pas activé.');
        if (error.kind === 'not_authorized') return fail(403, 'FORBIDDEN', 'Accès au résumé technique refusé.');
      }
      return fail(503, 'UNAVAILABLE', 'Résumé technique temporairement indisponible.');
    }
  };
}
