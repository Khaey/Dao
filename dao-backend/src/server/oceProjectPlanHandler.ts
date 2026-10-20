const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };

/**
 * Planning global du projet (#325). GET = graphe commun (lots, sous-lots retenus, liens et états) + résultat OCE ;
 * POST {project_id, link_id, decision} = le Client / la gestion confirme ou rejette un lien ; POST {project_id} = relance.
 * L'autorisation est décidée par la base avec le JWT de l'appelant ; personne ne se connecte à OCE.
 */
export function createOceProjectPlanHandler(
  db: { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: any; error: any }> },
  resolveActor: (header: string | null) => Promise<{ id: string } | null>,
  synchronize: (projectId: string) => Promise<unknown>,
  schedule: (task: Promise<unknown>) => void = task => { void task; },
) {
  const fail = (status: number, code: string, error: string, extra: Record<string, string> = {}) =>
    Response.json({ error, code }, { status, headers: { ...headers, ...extra } });
  const trigger = (projectId: string) => schedule(Promise.resolve().then(() => synchronize(projectId)).catch(() => undefined));
  const rpcError = (error: any) => error?.code === '42501' ? fail(403, 'FORBIDDEN', 'Accès au planning du projet refusé.')
    : error?.message === 'dependency_cycle' ? fail(422, 'DEPENDENCY_CYCLE', 'Ce lien créerait une boucle dans le planning.')
    : error?.code === '22023' ? fail(422, 'UNPROCESSABLE', 'Lien non confirmable pour le moment.') : fail(503, 'UNAVAILABLE', 'Planning du projet temporairement indisponible.');
  return async (request: Request) => {
    try {
      if (!await resolveActor(request.headers.get('authorization'))) return fail(401, 'UNAUTHENTICATED', 'Authentification requise.');
      if (!['GET', 'POST'].includes(request.method)) return fail(405, 'METHOD_NOT_ALLOWED', 'Méthode refusée.', { Allow: 'GET, POST' });
      if (request.method === 'GET') {
        const params = new URL(request.url).searchParams;
        const project = params.get('project_id') ?? '';
        if ([...params.keys()].join(',') !== 'project_id' || !UUID.test(project)) return fail(400, 'BAD_REQUEST', 'Paramètres invalides.');
        const { data, error } = await db.rpc('get_project_plan', { p_project_id: project.toLowerCase() });
        if (error) return rpcError(error);
        if (data?.sync?.state === 'pending') trigger(project.toLowerCase());
        return Response.json({ data }, { headers });
      }
      let input: Record<string, unknown>;
      try { input = await request.json(); } catch { return fail(400, 'BAD_REQUEST', 'Corps invalide.'); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) return fail(400, 'BAD_REQUEST', 'Corps invalide.');
      const project = String(input.project_id ?? '').toLowerCase();
      if (!UUID.test(project)) return fail(400, 'BAD_REQUEST', 'Paramètres invalides.');
      const keys = Object.keys(input).sort().join(',');
      if (keys === 'project_id') {
        const { error } = await db.rpc('get_project_plan', { p_project_id: project });
        if (error) return rpcError(error);
        trigger(project);
        return Response.json({ data: { sync: { state: 'pending' } } }, { status: 202, headers });
      }
      const link = String(input.link_id ?? '').toLowerCase();
      if (keys !== 'decision,link_id,project_id' || !UUID.test(link) || !['confirmed', 'rejected'].includes(String(input.decision))) return fail(400, 'BAD_REQUEST', 'Corps invalide.');
      const { data, error } = await db.rpc('decide_plan_link', { p_project_id: project, p_link_id: link, p_decision: input.decision });
      if (error) return rpcError(error);
      trigger(project);
      return Response.json({ data }, { headers });
    } catch {
      return fail(503, 'UNAVAILABLE', 'Planning du projet temporairement indisponible.');
    }
  };
}
