const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TARGET = /^(lot|node|activity):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };

type RpcDb = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: any; error: any }> };

/** DAO-owned dependency edits reuse the validated graph RPCs and never invoke OCE synchronization. */
export function createNativeExecutionDependencyHandler(
  db: RpcDb,
  resolveActor: (authorization: string | null) => Promise<{ id: string } | null>,
) {
  const fail = (status: number, code: string, error: string) => Response.json({ error, code }, { status, headers });
  const rpcError = (error: any) => error?.code === '42501' ? fail(403, 'FORBIDDEN', 'Accès au planning refusé.')
    : error?.code === '23514' || error?.message === 'dependency_cycle' ? fail(422, 'DEPENDENCY_CYCLE', 'Ce lien créerait une boucle dans le planning.')
    : error?.message === 'link_duplicate' ? fail(409, 'CONFLICT', 'Cette dépendance existe déjà.')
    : error?.code === '22023' ? fail(422, 'UNPROCESSABLE', 'Dépendance invalide ou cible non attribuée.')
    : fail(503, 'UNAVAILABLE', 'Dépendances du planning temporairement indisponibles.');
  return async (request: Request) => {
    try {
      if (!await resolveActor(request.headers.get('authorization'))) return fail(401, 'UNAUTHENTICATED', 'Authentification requise.');
      if (request.method !== 'POST') return Response.json({ error: 'Méthode refusée.', code: 'METHOD_NOT_ALLOWED' }, { status: 405, headers: { ...headers, Allow: 'POST' } });
      const raw = await request.text();
      if (raw.length > 8_000) return fail(413, 'PAYLOAD_TOO_LARGE', 'Commande trop volumineuse.');
      let body: any;
      try { body = JSON.parse(raw); } catch { return fail(400, 'BAD_REQUEST', 'Corps JSON invalide.'); }
      if (!body || Array.isArray(body) || typeof body !== 'object' || !UUID.test(body.projectId ?? '')) return fail(400, 'BAD_REQUEST', 'Commande invalide.');
      const projectId = body.projectId.toLowerCase();
      if (body.action === 'add') {
        if (Object.keys(body).sort().join(',') !== 'action,predTarget,projectId,succTarget') return fail(400, 'BAD_REQUEST', 'Commande invalide.');
        const from = typeof body.predTarget === 'string' && TARGET.exec(body.predTarget);
        const to = typeof body.succTarget === 'string' && TARGET.exec(body.succTarget);
        if (!from || !to || body.predTarget.toLowerCase() === body.succTarget.toLowerCase()) return fail(400, 'BAD_REQUEST', 'Cibles de dépendance invalides.');
        const { data, error } = await db.rpc('add_plan_link', {
          p_project_id: projectId, p_pred: `${from[1].toLowerCase()}:${from[2].toLowerCase()}`,
          p_succ: `${to[1].toLowerCase()}:${to[2].toLowerCase()}`,
        });
        if (error) return rpcError(error);
        return Response.json({ data, synchronization: 'not_requested' }, { headers });
      }
      if (body.action === 'remove') {
        if (Object.keys(body).sort().join(',') !== 'action,linkId,projectId' || !UUID.test(body.linkId ?? '')) return fail(400, 'BAD_REQUEST', 'Commande invalide.');
        const { data, error } = await db.rpc('remove_plan_link', { p_project_id: projectId, p_link_id: body.linkId.toLowerCase() });
        if (error) return rpcError(error);
        return Response.json({ data, synchronization: 'not_requested' }, { headers });
      }
      return fail(400, 'BAD_REQUEST', 'Action invalide.');
    } catch {
      return fail(503, 'UNAVAILABLE', 'Dépendances du planning temporairement indisponibles.');
    }
  };
}
