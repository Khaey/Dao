// #577 — API JWT des ouvrages du chantier (occurrences Lot → Sous-lot facultatif → Ouvrage).
// Toute règle (droits, verrou après publication, version du référentiel) est appliquée en base ;
// ce handler ne fait que valider la forme et traduire les erreurs en messages lisibles.
type RpcDb = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: any }> };

const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9._:-]{8,100}$/;
const ACTIONS = ['add', 'update', 'remove', 'link_takeoff'] as const;
type Action = typeof ACTIONS[number];

const LOCK_MESSAGES: Record<string, string> = {
  published: 'Ce lot a déjà été publié : ses ouvrages sont figés dans la version envoyée aux Artisans. Une correction passe par la revue D.A.O.',
  awarded: 'Ce lot est attribué : ses ouvrages ne sont plus modifiables.',
  project_in_review: 'Le dossier est en revue D.A.O. : les ouvrages redeviennent modifiables si des corrections sont demandées.',
  project_not_draft: 'Le chantier n’est plus en préparation : les ouvrages ne sont plus modifiables.',
  request_closed: 'Ce lot n’est plus ouvert : ses ouvrages ne sont plus modifiables.',
};

export function workItemErrorMessage(error: any): { status: number; code: string; message: string } {
  const hint = String(error?.hint ?? '');
  if (error?.code === '42501') return { status: 403, code: 'FORBIDDEN', message: 'Seul le Client propriétaire du chantier peut modifier ses ouvrages.' };
  if (error?.code === 'P0002') return { status: 404, code: 'NOT_FOUND', message: 'Ouvrage, lot ou métré introuvable.' };
  if (error?.code === '40001') return { status: 409, code: 'CONFLICT', message: 'Cet ouvrage a été modifié entre-temps. La liste a été rechargée.' };
  if (error?.code === '23505') return { status: 409, code: 'CONFLICT', message: 'Un métré porte déjà ce nom sur cet ouvrage.' };
  if (hint.startsWith('work_items_locked:')) return { status: 409, code: 'LOCKED', message: LOCK_MESSAGES[hint.slice(18)] ?? 'Ce lot n’est plus modifiable.' };
  if (hint === 'work_item_has_takeoffs') return { status: 409, code: 'HAS_TAKEOFFS', message: 'Cet ouvrage a déjà des métrés : il reste dans le lot pour conserver leur historique.' };
  if (['22023', '22P02', '23503', '23514'].includes(error?.code)) return { status: 400, code: 'BAD_REQUEST', message: 'Demande refusée : ouvrage, sous-lot ou libellé invalide.' };
  return { status: 503, code: 'UNAVAILABLE', message: 'Ouvrages du chantier temporairement indisponibles.' };
}

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const uuidOrNull = (value: unknown) => value === null || value === undefined || value === '' || (typeof value === 'string' && UUID.test(value));

/** Valide la forme d'une commande et renvoie l'entrée normalisée (identifiants en minuscules). */
export function normalizeWorkItemCommand(body: unknown): { action: Action; input: Record<string, unknown>; key: string } | null {
  if (!isObject(body)) return null;
  const { action: rawAction, idempotencyKey, ...input } = body;
  if (!ACTIONS.includes(rawAction as Action) || typeof idempotencyKey !== 'string' || !KEY.test(idempotencyKey)) return null;
  const action = rawAction as Action;
  const lower = (value: unknown) => typeof value === 'string' && value ? value.toLowerCase() : null;
  if (action === 'add') {
    if (Object.keys(input).some(key => !['requestId', 'items'].includes(key)) || typeof input.requestId !== 'string' || !UUID.test(input.requestId)
      || !Array.isArray(input.items) || input.items.length < 1 || input.items.length > 50) return null;
    const items: Record<string, unknown>[] = [];
    for (const item of input.items) {
      if (!isObject(item) || Object.keys(item).some(key => !['subLotId', 'workId', 'label', 'confirmation'].includes(key))) return null;
      if (!uuidOrNull(item.subLotId) || !uuidOrNull(item.workId)) return null;
      if (item.confirmation != null && item.confirmation !== 'selected' && item.confirmation !== 'to_confirm') return null;
      if (item.workId) { if (item.label != null) return null; }
      else if (typeof item.label !== 'string' || item.label.trim().length < 2 || item.label.trim().length > 200) return null;
      items.push({ subLotId: lower(item.subLotId), ...(item.workId ? { workId: lower(item.workId) } : { label: String(item.label).trim() }),
        confirmation: item.confirmation ?? 'selected' });
    }
    return { action, key: idempotencyKey, input: { requestId: input.requestId.toLowerCase(), items } };
  }
  if (action === 'link_takeoff') {
    if (Object.keys(input).some(key => !['takeoffId', 'itemId'].includes(key))
      || typeof input.takeoffId !== 'string' || !UUID.test(input.takeoffId) || typeof input.itemId !== 'string' || !UUID.test(input.itemId)) return null;
    return { action, key: idempotencyKey, input: { takeoffId: input.takeoffId.toLowerCase(), itemId: input.itemId.toLowerCase() } };
  }
  const allowed = action === 'remove' ? ['itemId', 'expectedRevision'] : ['itemId', 'expectedRevision', 'subLotId', 'confirmation', 'label'];
  if (Object.keys(input).some(key => !allowed.includes(key)) || typeof input.itemId !== 'string' || !UUID.test(input.itemId)
    || !Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 1) return null;
  const out: Record<string, unknown> = { itemId: input.itemId.toLowerCase(), expectedRevision: input.expectedRevision };
  if (action === 'update') {
    if ('subLotId' in input) { if (!uuidOrNull(input.subLotId)) return null; out.subLotId = lower(input.subLotId); }
    if ('confirmation' in input) { if (input.confirmation !== 'selected' && input.confirmation !== 'to_confirm') return null; out.confirmation = input.confirmation; }
    if ('label' in input) { if (typeof input.label !== 'string' || input.label.trim().length < 2 || input.label.trim().length > 200) return null; out.label = input.label.trim(); }
    if (Object.keys(out).length === 2) return null;
  }
  return { action, key: idempotencyKey, input: out };
}

export function createProjectWorkItemsHandler(db: RpcDb, resolveActor: (authorization: string | null) => Promise<{ id: string } | null>) {
  const fail = (status: number, code: string, error: string, extra: Record<string, string> = {}) =>
    Response.json({ error, code }, { status, headers: { ...headers, ...extra } });
  const rpcError = (error: any) => { const mapped = workItemErrorMessage(error); return fail(mapped.status, mapped.code, mapped.message); };

  return async (request: Request) => {
    try {
      if (!await resolveActor(request.headers.get('authorization'))) return fail(401, 'UNAUTHENTICATED', 'Authentification requise.');
      const url = new URL(request.url);
      if (request.method === 'GET') {
        const keys = [...url.searchParams.keys()];
        if (keys.some(key => !['project_id', 'item_id'].includes(key)) || url.searchParams.getAll('project_id').length + url.searchParams.getAll('item_id').length !== 1) {
          return fail(400, 'BAD_REQUEST', 'Paramètres invalides.');
        }
        const itemId = url.searchParams.get('item_id'); const projectId = url.searchParams.get('project_id');
        const target = itemId ?? projectId ?? '';
        if (!UUID.test(target)) return fail(400, 'BAD_REQUEST', 'Identifiant invalide.');
        const { data, error } = itemId
          ? await db.rpc('project_work_item_history_v1', { p_item_id: target.toLowerCase() })
          : await db.rpc('project_work_items_snapshot_v1', { p_project_id: target.toLowerCase() });
        if (error) return rpcError(error);
        if (!data) return fail(503, 'UNAVAILABLE', 'Ouvrages du chantier temporairement indisponibles.');
        return Response.json({ data }, { headers });
      }
      if (request.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'Méthode refusée.', { Allow: 'GET, POST' });
      const raw = await request.text();
      if (raw.length > 32_000) return fail(413, 'PAYLOAD_TOO_LARGE', 'Commande trop volumineuse.');
      let body: unknown;
      try { body = JSON.parse(raw); } catch { return fail(400, 'BAD_REQUEST', 'Corps JSON invalide.'); }
      const command = normalizeWorkItemCommand(body);
      if (!command) return fail(400, 'BAD_REQUEST', 'Commande d’ouvrage invalide.');
      const { data, error } = await db.rpc('project_work_item_command_v1', { p_action: command.action, p_input: command.input, p_idempotency_key: command.key });
      if (error) return rpcError(error);
      if (!data) return fail(503, 'UNAVAILABLE', 'Ouvrages du chantier temporairement indisponibles.');
      return Response.json({ data }, { headers });
    } catch {
      return fail(503, 'UNAVAILABLE', 'Ouvrages du chantier temporairement indisponibles.');
    }
  };
}
