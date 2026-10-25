const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const date = (value: unknown) => value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value);
type RpcDb = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: any; error: any }> };

/** DAO lot dates reuse oce_lot_plans but never invoke or enqueue OCE synchronization. */
export function createNativeLotDatesHandler(
  db: RpcDb,
  resolveActor: (authorization: string | null) => Promise<{ id: string } | null>,
) {
  const fail = (status: number, code: string, error: string, extra: Record<string, string> = {}) =>
    Response.json({ error, code }, { status, headers: { ...headers, ...extra } });
  const rpcError = (error: any) => error?.code === '42501' ? fail(403, 'FORBIDDEN', 'Accès au planning du lot refusé.')
    : error?.code === '22023' ? fail(422, 'UNPROCESSABLE', 'Dates de lot invalides.')
    : error?.code === 'P0002' ? fail(404, 'NOT_FOUND', 'Lot introuvable.')
    : fail(503, 'UNAVAILABLE', 'Dates de lot temporairement indisponibles.');
  return async (request: Request) => {
    try {
      if (!await resolveActor(request.headers.get('authorization'))) return fail(401, 'UNAUTHENTICATED', 'Authentification requise.');
      let input: any;
      if (request.method === 'GET') {
        const query = new URL(request.url).searchParams;
        if ([...query.keys()].sort().join(',') !== 'lot_id,project_id'
          || query.getAll('lot_id').length !== 1 || query.getAll('project_id').length !== 1) return fail(400, 'BAD_REQUEST', 'Paramètres invalides.');
        input = { projectId: query.get('project_id'), lotId: query.get('lot_id') };
      } else if (request.method === 'PUT') {
        const raw = await request.text();
        if (raw.length > 4096) return fail(413, 'PAYLOAD_TOO_LARGE', 'Commande trop volumineuse.');
        try { input = JSON.parse(raw); } catch { return fail(400, 'BAD_REQUEST', 'Corps JSON invalide.'); }
        if (!input || Array.isArray(input) || typeof input !== 'object'
          || Object.keys(input).sort().join(',') !== 'lotId,plannedEnd,plannedStart,projectId') return fail(400, 'BAD_REQUEST', 'Commande invalide.');
      } else return fail(405, 'METHOD_NOT_ALLOWED', 'Méthode refusée.', { Allow: 'GET, PUT' });

      if (!UUID.test(input.projectId ?? '') || !UUID.test(input.lotId ?? '')) return fail(400, 'BAD_REQUEST', 'Identifiant de lot invalide.');
      const projectId = input.projectId.toLowerCase(), requestId = input.lotId.toLowerCase();
      if (request.method === 'GET') {
        const { data, error } = await db.rpc('oce_get_lot_plan', { p_project_id: projectId, p_request_id: requestId });
        return error ? rpcError(error) : data ? Response.json({ data }, { headers }) : fail(503, 'UNAVAILABLE', 'Dates de lot temporairement indisponibles.');
      }
      const start = input.plannedStart, end = input.plannedEnd;
      if (!date(start) || !date(end) || (start === null) !== (end === null)
        || start !== null && end < start) return fail(422, 'UNPROCESSABLE', 'Saisissez les deux dates dans un ordre valide, ou effacez-les.');
      const { data, error } = await db.rpc('oce_save_lot_plan', {
        p_project_id: projectId, p_request_id: requestId, p_start: start, p_end: end, p_ready: false,
      });
      if (error) return rpcError(error);
      return data ? Response.json({ data: { ...data, source: 'dao_plan', synchronization: 'not_requested' } }, { headers })
        : fail(503, 'UNAVAILABLE', 'Dates de lot temporairement indisponibles.');
    } catch {
      return fail(503, 'UNAVAILABLE', 'Dates de lot temporairement indisponibles.');
    }
  };
}
