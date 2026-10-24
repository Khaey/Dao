const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9._:-]{8,128}$/;
const date = (value: unknown) => value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value);
const requiredDate = (value: unknown) => typeof value === 'string' && date(value);

export function createNativeExecutionScopeHandler(
  db: { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: any }> },
  resolveActor: (authorization: string | null) => Promise<{ id: string } | null>,
) {
  const fail = (status: number, code: string, error: string, extra: Record<string, string> = {}) =>
    Response.json({ error, code }, { status, headers: { ...headers, ...extra } });
  return async (request: Request) => {
    try {
      if (!await resolveActor(request.headers.get('authorization'))) return fail(401, 'UNAUTHENTICATED', 'Authentification requise.');
      if (request.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'Méthode refusée.', { Allow: 'POST' });
      const raw = await request.text();
      if (raw.length > 8192) return fail(413, 'PAYLOAD_TOO_LARGE', 'Commande trop volumineuse.');
      let body: any;
      try { body = JSON.parse(raw); } catch { return fail(400, 'BAD_REQUEST', 'Corps JSON invalide.'); }
      if (!body || Array.isArray(body) || typeof body !== 'object') return fail(400, 'BAD_REQUEST', 'Commande invalide.');
      let rpc: string;
      let args: Record<string, unknown>;
      if (body.mode === 'prepare') {
        const allowed = ['mode','agreementVersionId','installmentNo','scopeType','awardItemId','subLotId','milestoneKey','periodStart','periodEnd','idempotencyKey'];
        const optionalId = (value: unknown) => value == null || UUID.test(String(value));
        const type = body.scopeType;
        const idsValid = optionalId(body.awardItemId) && optionalId(body.subLotId) && optionalId(body.milestoneKey);
        const shapeValid = (type === 'lot' && UUID.test(body.awardItemId ?? '') && body.subLotId == null && body.milestoneKey == null && body.periodStart == null && body.periodEnd == null)
          || (type === 'sub_lot' && UUID.test(body.awardItemId ?? '') && UUID.test(body.subLotId ?? '') && body.milestoneKey == null && body.periodStart == null && body.periodEnd == null)
          || (type === 'milestone' && UUID.test(body.awardItemId ?? '') && body.subLotId == null && UUID.test(body.milestoneKey ?? '') && body.periodStart == null && body.periodEnd == null)
          || (type === 'period' && body.awardItemId == null && body.subLotId == null && body.milestoneKey == null && requiredDate(body.periodStart) && requiredDate(body.periodEnd) && body.periodStart <= body.periodEnd)
          || (type === 'project_end' && body.awardItemId == null && body.subLotId == null && body.milestoneKey == null && body.periodStart == null && body.periodEnd == null);
        if (Object.keys(body).some(k => !allowed.includes(k)) || !UUID.test(body.agreementVersionId ?? '') || !idsValid
          || !Number.isInteger(body.installmentNo) || body.installmentNo < 1 || body.installmentNo > 100 || !shapeValid
          || !KEY.test(body.idempotencyKey ?? '')) return fail(400, 'BAD_REQUEST', 'Référence d’échéance invalide.');
        rpc = 'native_execution_prepare_installment_scope';
        args = {
          p_agreement_version_id: body.agreementVersionId.toLowerCase(), p_installment_no: body.installmentNo,
          p_scope_type: type, p_award_item_id: body.awardItemId?.toLowerCase() ?? null,
          p_sub_lot_id: body.subLotId?.toLowerCase() ?? null, p_milestone_key: body.milestoneKey?.toLowerCase() ?? null,
          p_period_start: body.periodStart ?? null, p_period_end: body.periodEnd ?? null, p_idempotency_key: body.idempotencyKey,
        };
      } else if (body.mode === 'respond') {
        if (Object.keys(body).some(k => !['mode','proposalId','decision','idempotencyKey'].includes(k))
          || !UUID.test(body.proposalId ?? '') || !['accepted','rejected'].includes(body.decision) || !KEY.test(body.idempotencyKey ?? '')) {
          return fail(400, 'BAD_REQUEST', 'Décision invalide.');
        }
        rpc = 'native_execution_accept_installment_scope';
        args = { p_proposal_id: body.proposalId.toLowerCase(), p_decision: body.decision, p_idempotency_key: body.idempotencyKey };
      } else return fail(400, 'BAD_REQUEST', 'Type de commande invalide.');
      const { data, error } = await db.rpc(rpc, args);
      if (error) {
        if (error.code === '42501') return fail(403, 'FORBIDDEN', 'Action non autorisée.');
        if (error.code === '40001' || error.code === '23505') return fail(409, 'CONFLICT', 'La version a changé. Rechargez les conditions.');
        if (error.code === '22023' || error.code === '23503' || error.code === '23514') return fail(400, 'BAD_REQUEST', 'Commande invalide.');
        return fail(503, 'UNAVAILABLE', 'Conditions temporairement indisponibles.');
      }
      if (!data) return fail(503, 'UNAVAILABLE', 'Référence des conditions indisponible.');
      return Response.json({ data }, { headers });
    } catch {
      return fail(503, 'UNAVAILABLE', 'Conditions temporairement indisponibles.');
    }
  };
}
