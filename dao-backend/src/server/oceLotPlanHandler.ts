import type { MappingRef } from '../oce/gatewayContract.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
const validDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/**
 * Lot planning input + synchronisation supervision (#301). D.A.O drives OCE: saving a READY plan triggers the
 * server-side synchronisation automatically; nobody logs in to OCE. Authorization is decided by the database with the
 * caller's JWT. GET = plan + sync state, PUT = save (and auto-sync when ready), POST = relaunch (D.A.O management only).
 */
export function createOceLotPlanHandler(
  db: { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: any; error: any }> },
  resolveActor: (header: string | null) => Promise<{ id: string } | null>,
  synchronize: (ref: MappingRef) => Promise<unknown>,
  schedule: (task: Promise<unknown>) => void = task => { void task; },
) {
  const fail = (status: number, code: string, error: string, extra: Record<string, string> = {}) =>
    Response.json({ error, code }, { status, headers: { ...headers, ...extra } });
  const trigger = (ref: MappingRef) => schedule(Promise.resolve().then(() => synchronize(ref)).catch(() => undefined));
  const rpcError = (error: any) => error?.code === '42501' ? fail(403, 'FORBIDDEN', 'Accès au planning du lot refusé.')
    : error?.code === '22023' ? fail(422, 'UNPROCESSABLE', 'Planning invalide.') : fail(503, 'UNAVAILABLE', 'Planning temporairement indisponible.');
  return async (request: Request) => {
    try {
      if (!await resolveActor(request.headers.get('authorization'))) return fail(401, 'UNAUTHENTICATED', 'Authentification requise.');
      const method = request.method;
      if (!['GET', 'PUT', 'POST'].includes(method)) return fail(405, 'METHOD_NOT_ALLOWED', 'Méthode refusée.', { Allow: 'GET, PUT, POST' });
      let input: Record<string, unknown>;
      if (method === 'GET') {
        const params = new URL(request.url).searchParams;
        if ([...params.keys()].sort().join(',') !== 'lot_id,project_id') return fail(400, 'BAD_REQUEST', 'Paramètres invalides.');
        input = { project_id: params.get('project_id'), lot_id: params.get('lot_id') };
      } else {
        try { input = await request.json(); } catch { return fail(400, 'BAD_REQUEST', 'Corps invalide.'); }
        if (!input || typeof input !== 'object' || Array.isArray(input)) return fail(400, 'BAD_REQUEST', 'Corps invalide.');
      }
      const project = String(input.project_id ?? ''), lot = String(input.lot_id ?? '');
      if (!UUID.test(project) || !UUID.test(lot)) return fail(400, 'BAD_REQUEST', 'Paramètres invalides.');
      const ref = { dao_project_id: project.toLowerCase(), dao_lot_id: lot.toLowerCase() };
      const ids = { p_project_id: ref.dao_project_id, p_request_id: ref.dao_lot_id };

      if (method === 'GET') {
        const { data, error } = await db.rpc('oce_get_lot_plan', ids);
        return error ? rpcError(error) : Response.json({ data }, { headers });
      }
      if (method === 'PUT') {
        if ([...Object.keys(input)].sort().join(',') !== 'lot_id,planned_end,planned_start,project_id,ready') return fail(400, 'BAD_REQUEST', 'Corps invalide.');
        const { planned_start: start, planned_end: end, ready } = input;
        if (typeof ready !== 'boolean' || (start !== null && !validDate(start)) || (end !== null && !validDate(end))) return fail(400, 'BAD_REQUEST', 'Dates invalides.');
        const { data, error } = await db.rpc('oce_save_lot_plan', { ...ids, p_start: start, p_end: end, p_ready: ready });
        if (error) return rpcError(error);
        if (ready) trigger(ref);
        return Response.json({ data: { ...data, sync: { state: ready ? 'pending' : 'not_requested' } } }, { headers });
      }
      // POST: relaunch a failed or stale synchronisation. D.A.O management only.
      if ([...Object.keys(input)].sort().join(',') !== 'lot_id,project_id') return fail(400, 'BAD_REQUEST', 'Corps invalide.');
      const { data, error } = await db.rpc('oce_resync_access', ids);
      if (error) return rpcError(error);
      if (data !== true) return fail(403, 'FORBIDDEN', 'Relance de la synchronisation refusée.');
      trigger(ref);
      return Response.json({ data: { sync: { state: 'pending' } } }, { status: 202, headers });
    } catch {
      return fail(503, 'UNAVAILABLE', 'Planning temporairement indisponible.');
    }
  };
}
