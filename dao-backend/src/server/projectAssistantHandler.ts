import { DomainError } from '../lib/errors.js';
import { isProjectKind, type ProjectAssistantService } from '../assistant/service.js';

const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ITEM = /^[A-Za-z0-9:_-]{1,80}$/;
const KEYS: Record<string, string[]> = {
  analyze: ['action', 'description', 'projectType', 'governorateId'],
  edit: ['action', 'draftId', 'expectedRevision', 'command', 'toggle', 'projectType', 'governorateId', 'answer'],
  abandon: ['action', 'draftId'],
  create: ['action', 'draftId', 'creationKey'],
};
const text = (value: unknown, min: number, max: number) => typeof value === 'string' && value.trim().length >= min && value.trim().length <= max;

/** API de l'assistant BTP : GET reprend le brouillon ouvert, POST exécute une action typée. */
export function createProjectAssistantHandler(
  service: Pick<ProjectAssistantService, 'resume' | 'analyze' | 'edit' | 'abandon' | 'create'>,
  resolveActor: (authorization: string | null) => Promise<{ id: string } | null>,
) {
  const fail = (status: number, code: string, error: string, extra: Record<string, string> = {}) =>
    Response.json({ error, code }, { status, headers: { ...headers, ...extra } });
  const failure = (error: any) => {
    if (error instanceof DomainError) {
      const status = { BAD_REQUEST: 400, NOT_FOUND: 404, CONFLICT: 409, UNAVAILABLE: 503 }[error.code] ?? 400;
      return fail(status, error.code, error.message);
    }
    if (error?.code === '42501') return fail(403, 'FORBIDDEN', 'Action non autorisée.');
    if (error?.code === 'P0002') return fail(404, 'NOT_FOUND', 'Brouillon introuvable.');
    if (error?.code === '40001' || error?.code === '23505') return fail(409, 'CONFLICT', 'Le brouillon a changé dans un autre onglet. Rechargez la page.');
    if (error?.code === '23514' && /governorate/.test(error?.message ?? '')) return fail(400, 'BAD_REQUEST', 'Indiquez le gouvernorat du chantier.');
    if (error?.code === '22023' || error?.code === '23503' || error?.code === '23514') return fail(400, 'BAD_REQUEST', 'Demande invalide ou brouillon clos.');
    return fail(503, 'UNAVAILABLE', 'Assistant temporairement indisponible. Votre brouillon est conservé.');
  };

  return async (request: Request) => {
    try {
      const actor = await resolveActor(request.headers.get('authorization'));
      if (!actor) return fail(401, 'UNAUTHENTICATED', 'Authentification requise.');
      if (request.method === 'GET') return Response.json({ data: await service.resume(actor.id) }, { headers });
      if (request.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'Méthode refusée.', { Allow: 'GET, POST' });
      const raw = await request.text();
      if (raw.length > 16_000) return fail(413, 'PAYLOAD_TOO_LARGE', 'Demande trop volumineuse.');
      let body: any;
      try { body = JSON.parse(raw); } catch { return fail(400, 'BAD_REQUEST', 'Corps JSON invalide.'); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || !KEYS[body.action]
        || Object.keys(body).some(key => !KEYS[body.action].includes(key))) return fail(400, 'BAD_REQUEST', 'Action inconnue ou champ inattendu.');
      const optionalType = body.projectType == null ? null : isProjectKind(body.projectType) ? body.projectType : undefined;
      const optionalGovernorate = body.governorateId == null ? null : typeof body.governorateId === 'string' && UUID.test(body.governorateId) ? body.governorateId.toLowerCase() : undefined;
      if (optionalType === undefined) return fail(400, 'BAD_REQUEST', 'Type de projet invalide.');
      if (optionalGovernorate === undefined) return fail(400, 'BAD_REQUEST', 'Gouvernorat invalide.');
      if (body.action !== 'analyze' && (typeof body.draftId !== 'string' || !UUID.test(body.draftId))) return fail(400, 'BAD_REQUEST', 'Brouillon invalide.');
      const draftId = body.draftId?.toLowerCase();

      if (body.action === 'analyze') {
        if (!text(body.description, 3, 4000)) return fail(400, 'BAD_REQUEST', 'Décrivez votre projet en quelques mots (4 000 caractères au plus).');
        return Response.json({ data: await service.analyze(actor.id, { description: body.description.trim(), projectType: optionalType, governorateId: optionalGovernorate }) }, { headers });
      }
      if (body.action === 'edit') {
        if (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 1) return fail(400, 'BAD_REQUEST', 'Révision invalide.');
        if (body.command != null && !text(body.command, 2, 500)) return fail(400, 'BAD_REQUEST', 'Votre demande doit faire entre 2 et 500 caractères.');
        if (body.answer != null && !text(body.answer, 1, 500)) return fail(400, 'BAD_REQUEST', 'Votre réponse doit faire entre 1 et 500 caractères.');
        if (body.toggle != null && (typeof body.toggle !== 'object' || Array.isArray(body.toggle)
          || Object.keys(body.toggle).some(key => !['itemId', 'selected'].includes(key))
          || typeof body.toggle.itemId !== 'string' || !ITEM.test(body.toggle.itemId) || typeof body.toggle.selected !== 'boolean')) {
          return fail(400, 'BAD_REQUEST', 'Élément invalide.');
        }
        return Response.json({ data: await service.edit(actor.id, {
          draftId, expectedRevision: body.expectedRevision, command: body.command?.trim() ?? null, toggle: body.toggle ?? null,
          projectType: optionalType, governorateId: optionalGovernorate, answer: body.answer?.trim() ?? null,
        }) }, { headers });
      }
      if (body.action === 'abandon') return Response.json({ data: await service.abandon(actor.id, draftId) }, { headers });
      if (typeof body.creationKey !== 'string' || !/^[A-Za-z0-9_-]{8,120}$/.test(body.creationKey)) return fail(400, 'BAD_REQUEST', 'Clé de création invalide.');
      return Response.json({ data: await service.create(actor.id, draftId, body.creationKey) }, { headers });
    } catch (error) {
      return failure(error);
    }
  };
}
