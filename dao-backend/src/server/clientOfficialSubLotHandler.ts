const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RpcDb = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: any }> };

export function createClientOfficialSubLotHandler(
  db: RpcDb,
  resolveActor: (authorization: string | null) => Promise<{ id: string } | null>,
) {
  const fail = (status: number, code: string, error: string, extra: Record<string, string> = {}) =>
    Response.json({ error, code }, { status, headers: { ...headers, ...extra } });
  const rpcError = (error: any) => {
    if (error?.code === '42501') return fail(403, 'FORBIDDEN', 'Action non autorisée.');
    if (error?.code === 'P0002') return fail(404, 'NOT_FOUND', 'Lot introuvable.');
    if (error?.code === '40001' || error?.code === '23505') return fail(409, 'CONFLICT', 'La version a changé. Rechargez le dossier.');
    if (error?.code === '22023' || error?.code === '23503' || error?.code === '23514') return fail(400, 'BAD_REQUEST', 'Commande invalide ou lot non modifiable.');
    return fail(503, 'UNAVAILABLE', 'Sous-lots du dossier temporairement indisponibles.');
  };

  return async (request: Request) => {
    try {
      if (!await resolveActor(request.headers.get('authorization'))) return fail(401, 'UNAUTHENTICATED', 'Authentification requise.');
      const url = new URL(request.url);
      if (request.method === 'GET') {
        if ([...url.searchParams.keys()].some(key => key !== 'request_id')
          || url.searchParams.getAll('request_id').length !== 1 || !UUID.test(url.searchParams.get('request_id') ?? '')) {
          return fail(400, 'BAD_REQUEST', 'Identifiant de lot invalide.');
        }
        const { data, error } = await db.rpc('native_request_sub_lots_v1', { p_request_id: url.searchParams.get('request_id')!.toLowerCase() });
        if (error) return rpcError(error);
        if (!data) return fail(503, 'UNAVAILABLE', 'Sous-lots du dossier temporairement indisponibles.');
        return Response.json({ data }, { headers });
      }
      if (request.method !== 'PUT') return fail(405, 'METHOD_NOT_ALLOWED', 'Méthode refusée.', { Allow: 'GET, PUT' });
      const raw = await request.text();
      if (raw.length > 64_000) return fail(413, 'PAYLOAD_TOO_LARGE', 'Commande trop volumineuse.');
      let body: any;
      try { body = JSON.parse(raw); } catch { return fail(400, 'BAD_REQUEST', 'Corps JSON invalide.'); }
      if (!body || Array.isArray(body) || typeof body !== 'object'
        || Object.keys(body).some(key => !['requestId', 'expectedRequestVersionId', 'items'].includes(key))
        || !UUID.test(body.requestId ?? '') || !UUID.test(body.expectedRequestVersionId ?? '')
        || !Array.isArray(body.items) || body.items.length > 100
        || body.items.some((item: any) => !item || Array.isArray(item) || typeof item !== 'object'
          || Object.keys(item).some(key => !['id', 'title', 'scope', 'budgetMillimes'].includes(key))
          || item.id != null && !UUID.test(item.id)
          || typeof item.title !== 'string' || item.title.trim().length < 1 || item.title.trim().length > 200
          || typeof item.scope !== 'string' || item.scope.trim().length < 1 || item.scope.trim().length > 10_000
          || item.budgetMillimes != null && (typeof item.budgetMillimes !== 'string' || !/^\d{1,18}$/.test(item.budgetMillimes)))) {
        return fail(400, 'BAD_REQUEST', 'Liste de sous-lots invalide.');
      }
      const ids = body.items.filter((item: any) => item.id).map((item: any) => item.id.toLowerCase());
      if (new Set(ids).size !== ids.length) return fail(400, 'BAD_REQUEST', 'Un sous-lot est présent plusieurs fois.');
      const { data, error } = await db.rpc('replace_client_request_sub_lots_v1', {
        p_request_id: body.requestId.toLowerCase(),
        p_expected_request_version_id: body.expectedRequestVersionId.toLowerCase(),
        p_items: body.items.map((item: any) => ({
          id: item.id?.toLowerCase() ?? null, title: item.title.trim(), scope: item.scope.trim(),
          budgetMillimes: item.budgetMillimes ?? null,
        })),
      });
      if (error) return rpcError(error);
      if (!data) return fail(503, 'UNAVAILABLE', 'Sous-lots du dossier temporairement indisponibles.');
      return Response.json({ data }, { headers });
    } catch {
      return fail(503, 'UNAVAILABLE', 'Sous-lots du dossier temporairement indisponibles.');
    }
  };
}
