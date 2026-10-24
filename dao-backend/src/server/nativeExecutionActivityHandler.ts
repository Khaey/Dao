const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idempotencyKey = /^[A-Za-z0-9._:-]{8,128}$/;
const date = (value: unknown) => value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value);

type RpcDb = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: any }> };

export function createNativeExecutionActivityHandler(
  db: RpcDb,
  resolveActor: (authorization: string | null) => Promise<{ id: string } | null>,
) {
  const fail = (status: number, code: string, error: string, extra: Record<string, string> = {}) =>
    Response.json({ error, code }, { status, headers: { ...headers, ...extra } });
  const rpcError = (error: any) => {
    if (error?.code === '42501') return fail(403, 'FORBIDDEN', 'Action non autorisée.');
    if (error?.code === '40001' || error?.code === '23505') return fail(409, 'CONFLICT', 'La version a changé. Rechargez le suivi.');
    if (error?.code === '22023' || error?.code === '23503' || error?.code === '23514') return fail(400, 'BAD_REQUEST', 'Commande invalide.');
    return fail(503, 'UNAVAILABLE', 'Suivi du projet temporairement indisponible.');
  };

  return async (request: Request) => {
    try {
      if (!await resolveActor(request.headers.get('authorization'))) return fail(401, 'UNAUTHENTICATED', 'Authentification requise.');
      if (request.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'Méthode refusée.', { Allow: 'POST' });
      const raw = await request.text();
      if (raw.length > 16_384) return fail(413, 'PAYLOAD_TOO_LARGE', 'Commande trop volumineuse.');
      let body: any;
      try { body = JSON.parse(raw); } catch { return fail(400, 'BAD_REQUEST', 'Corps JSON invalide.'); }
      if (!body || Array.isArray(body) || typeof body !== 'object') return fail(400, 'BAD_REQUEST', 'Commande invalide.');

      let rpc: string;
      let args: Record<string, unknown>;
      if (body.mode === 'write') {
        const allowed = ['mode', 'awardItemId', 'activityId', 'action', 'parentActivityId', 'kind', 'title', 'scope', 'position', 'plannedStart', 'plannedEnd', 'durationDays', 'expectedRevision', 'idempotencyKey'];
        if (Object.keys(body).some(k => !allowed.includes(k)) || !UUID.test(body.awardItemId ?? '')
          || !['create', 'update', 'retire'].includes(body.action) || (body.activityId != null && !UUID.test(body.activityId))
          || (body.parentActivityId != null && !UUID.test(body.parentActivityId)) || !['sub_lot', 'activity'].includes(body.kind)
          || typeof body.title !== 'string' || body.title.trim().length > 180 || typeof body.scope !== 'string' && body.scope !== null
          || (typeof body.scope === 'string' && body.scope.length > 4000)
          || !Number.isInteger(body.position) || body.position < 0 || body.position > 10000
          || !date(body.plannedStart) || !date(body.plannedEnd)
          || (body.durationDays !== null && (!Number.isInteger(body.durationDays) || body.durationDays < 0 || body.durationDays > 36500))
          || (body.expectedRevision !== null && (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 1))
          || !idempotencyKey.test(body.idempotencyKey ?? '')) return fail(400, 'BAD_REQUEST', 'Commande invalide.');
        rpc = 'native_execution_activity_write';
        args = {
          p_award_item_id: body.awardItemId.toLowerCase(), p_activity_id: body.activityId?.toLowerCase() ?? null,
          p_action: body.action, p_parent_activity_id: body.parentActivityId?.toLowerCase() ?? null,
          p_kind: body.kind, p_title: body.title.trim(), p_scope: body.scope,
          p_position: body.position, p_planned_start: body.plannedStart, p_planned_end: body.plannedEnd,
          p_duration_days: body.durationDays, p_expected_revision: body.expectedRevision,
          p_idempotency_key: body.idempotencyKey,
        };
      } else if (body.mode === 'prepare') {
        const allowed = ['mode', 'awardItemId', 'activityId', 'action', 'parentActivityId', 'kind', 'title', 'scope', 'position', 'plannedStart', 'plannedEnd', 'durationDays', 'expectedRevision', 'idempotencyKey'];
        if (Object.keys(body).some(k => !allowed.includes(k)) || !UUID.test(body.awardItemId ?? '')
          || !['create', 'update', 'retire'].includes(body.action) || (body.activityId != null && !UUID.test(body.activityId))
          || (body.parentActivityId != null && !UUID.test(body.parentActivityId)) || !['sub_lot', 'activity'].includes(body.kind)
          || typeof body.title !== 'string' && body.action !== 'retire' || (typeof body.title === 'string' && body.title.trim().length > 180)
          || typeof body.scope !== 'string' && body.scope !== null || (typeof body.scope === 'string' && body.scope.length > 4000)
          || !Number.isInteger(body.position) || body.position < 0 || body.position > 10000
          || !date(body.plannedStart) || !date(body.plannedEnd)
          || (body.durationDays !== null && (!Number.isInteger(body.durationDays) || body.durationDays < 0 || body.durationDays > 36500))
          || (body.expectedRevision !== null && (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 1))
          || !idempotencyKey.test(body.idempotencyKey ?? '')) return fail(400, 'BAD_REQUEST', 'Proposition invalide.');
        rpc = 'native_execution_prepare_activity_change';
        args = {
          p_award_item_id: body.awardItemId.toLowerCase(), p_action: body.action,
          p_activity_id: body.activityId?.toLowerCase() ?? null, p_parent_activity_id: body.parentActivityId?.toLowerCase() ?? null,
          p_kind: body.kind, p_title: body.title?.trim() ?? null, p_scope: body.scope,
          p_position: body.position, p_planned_start: body.plannedStart, p_planned_end: body.plannedEnd,
          p_duration_days: body.durationDays, p_expected_revision: body.expectedRevision, p_idempotency_key: body.idempotencyKey,
        };
      } else if (body.mode === 'respond') {
        if (Object.keys(body).some(k => !['mode', 'proposalId', 'decision', 'idempotencyKey'].includes(k))
          || !UUID.test(body.proposalId ?? '') || !['accepted', 'rejected'].includes(body.decision)
          || !idempotencyKey.test(body.idempotencyKey ?? '')) return fail(400, 'BAD_REQUEST', 'Décision invalide.');
        rpc = 'native_execution_accept_activity_change';
        args = { p_proposal_id: body.proposalId.toLowerCase(), p_decision: body.decision, p_idempotency_key: body.idempotencyKey };
      } else return fail(400, 'BAD_REQUEST', 'Type de commande invalide.');

      const { data, error } = await db.rpc(rpc, args);
      if (error) return rpcError(error);
      if (!data) return fail(503, 'UNAVAILABLE', 'Commande du suivi indisponible.');
      return Response.json({ data }, { headers });
    } catch {
      return fail(503, 'UNAVAILABLE', 'Suivi du projet temporairement indisponible.');
    }
  };
}
