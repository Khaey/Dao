// #587 — API JWT des modifications de périmètre d'un lot attribué (proposition, acceptation, refus, retrait).
// Toute règle (parties au lot, une proposition en attente, versions append-only, référentiel publié) est appliquée
// en base ; ce handler valide seulement la forme et traduit les erreurs. Aucun montant n'est accepté.
type RpcDb = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: any }> };

const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9._:-]{8,100}$/;
const ACTIONS = ['propose', 'accept', 'reject', 'withdraw'] as const;
type Action = typeof ACTIONS[number];
const UNAVAILABLE = 'Modifications de périmètre temporairement indisponibles.';

export function scopeChangeErrorMessage(error: any): { status: number; code: string; message: string } {
  const hint = String(error?.hint ?? '');
  if (hint === 'scope_change_other_party') return { status: 403, code: 'OTHER_PARTY', message: 'Votre proposition doit être validée par l’autre partie au lot.' };
  if (error?.code === '42501') return { status: 403, code: 'FORBIDDEN', message: 'Seuls le Client propriétaire et l’Artisan titulaire du lot peuvent agir sur son périmètre.' };
  if (error?.code === 'P0002') return { status: 404, code: 'NOT_FOUND', message: 'Lot attribué ou modification introuvable.' };
  if (error?.code === '40001') return { status: 409, code: 'CONFLICT', message: 'Le périmètre du lot a changé entre-temps. La liste a été rechargée.' };
  if (hint === 'scope_change_pending') return { status: 409, code: 'PENDING', message: 'Une modification de périmètre est déjà en attente sur ce lot : elle doit être acceptée, refusée ou retirée d’abord.' };
  if (hint === 'scope_change_closed') return { status: 409, code: 'CLOSED', message: 'Cette modification a déjà été traitée.' };
  if (['22023', '22P02', '23503', '23514'].includes(error?.code)) return { status: 400, code: 'BAD_REQUEST', message: 'Demande refusée : ouvrage, sous-lot ou motif invalide.' };
  return { status: 503, code: 'UNAVAILABLE', message: UNAVAILABLE };
}

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const uuidOrNull = (value: unknown) => value === null || value === undefined || value === '' || (typeof value === 'string' && UUID.test(value));
const reasonOk = (value: unknown) => typeof value === 'string' && value.trim().length >= 5 && value.trim().length <= 2000;

/** Valide la forme d'une commande ; tout champ de prix ou de quantité est refusé. */
export function normalizeScopeChangeCommand(body: unknown): { action: Action; input: Record<string, unknown>; key: string } | null {
  if (!isObject(body)) return null;
  const { action: rawAction, idempotencyKey, ...input } = body;
  if (!ACTIONS.includes(rawAction as Action) || typeof idempotencyKey !== 'string' || !KEY.test(idempotencyKey)) return null;
  const action = rawAction as Action;
  if (action === 'propose') {
    if (Object.keys(input).some(key => !['awardItemId', 'reason', 'items'].includes(key)) || typeof input.awardItemId !== 'string' || !UUID.test(input.awardItemId)
      || !reasonOk(input.reason) || !Array.isArray(input.items) || input.items.length < 1 || input.items.length > 30) return null;
    const items: Record<string, unknown>[] = [];
    for (const item of input.items) {
      if (!isObject(item) || Object.keys(item).some(key => !['subLotId', 'workId', 'label'].includes(key))) return null;
      if (!uuidOrNull(item.subLotId) || !uuidOrNull(item.workId)) return null;
      const subLotId = typeof item.subLotId === 'string' && item.subLotId ? item.subLotId.toLowerCase() : null;
      if (item.workId) { if (item.label != null) return null; items.push({ subLotId, workId: String(item.workId).toLowerCase() }); }
      else if (typeof item.label === 'string' && item.label.trim().length >= 2 && item.label.trim().length <= 200) items.push({ subLotId, label: item.label.trim() });
      else return null;
    }
    return { action, key: idempotencyKey, input: { awardItemId: input.awardItemId.toLowerCase(), reason: String(input.reason).trim(), items } };
  }
  const allowed = action === 'accept' ? ['changeId'] : ['changeId', 'reason'];
  if (Object.keys(input).some(key => !allowed.includes(key)) || typeof input.changeId !== 'string' || !UUID.test(input.changeId)) return null;
  const out: Record<string, unknown> = { changeId: input.changeId.toLowerCase() };
  if (action === 'reject') { if (!reasonOk(input.reason)) return null; out.reason = String(input.reason).trim(); }
  if (action === 'withdraw' && input.reason != null && input.reason !== '') { if (!reasonOk(input.reason)) return null; out.reason = String(input.reason).trim(); }
  return { action, key: idempotencyKey, input: out };
}

export function createLotScopeChangesHandler(db: RpcDb, resolveActor: (authorization: string | null) => Promise<{ id: string } | null>) {
  const fail = (status: number, code: string, error: string, extra: Record<string, string> = {}) =>
    Response.json({ error, code }, { status, headers: { ...headers, ...extra } });
  const rpcError = (error: any) => { const mapped = scopeChangeErrorMessage(error); return fail(mapped.status, mapped.code, mapped.message); };

  return async (request: Request) => {
    try {
      if (!await resolveActor(request.headers.get('authorization'))) return fail(401, 'UNAUTHENTICATED', 'Authentification requise.');
      if (request.method === 'GET') {
        const url = new URL(request.url);
        const keys = [...url.searchParams.keys()];
        const projectId = url.searchParams.get('project_id') ?? '';
        if (keys.length !== 1 || keys[0] !== 'project_id' || !UUID.test(projectId)) return fail(400, 'BAD_REQUEST', 'Paramètres invalides.');
        const { data, error } = await db.rpc('lot_scope_changes_snapshot_v1', { p_project_id: projectId.toLowerCase() });
        if (error) return rpcError(error);
        if (!data) return fail(503, 'UNAVAILABLE', UNAVAILABLE);
        return Response.json({ data }, { headers });
      }
      if (request.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'Méthode refusée.', { Allow: 'GET, POST' });
      const raw = await request.text();
      if (raw.length > 32_000) return fail(413, 'PAYLOAD_TOO_LARGE', 'Commande trop volumineuse.');
      let body: unknown;
      try { body = JSON.parse(raw); } catch { return fail(400, 'BAD_REQUEST', 'Corps JSON invalide.'); }
      const command = normalizeScopeChangeCommand(body);
      if (!command) return fail(400, 'BAD_REQUEST', 'Modification de périmètre invalide.');
      const { data, error } = await db.rpc('lot_scope_change_command_v1', { p_action: command.action, p_input: command.input, p_idempotency_key: command.key });
      if (error) return rpcError(error);
      if (!data) return fail(503, 'UNAVAILABLE', UNAVAILABLE);
      return Response.json({ data }, { headers });
    } catch {
      return fail(503, 'UNAVAILABLE', UNAVAILABLE);
    }
  };
}
