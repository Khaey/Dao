import { DomainError } from '../lib/errors.js';
import { SiteWorkSituationService } from '../services/SiteWorkSituationService.js';

const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
export function createNativeWorkSituationHandler(
  service: SiteWorkSituationService,
  resolveActor: (authorization: string | null) => Promise<{ id: string } | null>,
) {
  const fail = (status: number, code: string, error: string, extra: Record<string, string> = {}) =>
    Response.json({ error, code }, { status, headers: { ...headers, ...extra } });
  const rpcFailure = (error: any) => {
    if (error instanceof DomainError || error?.code === '22023' || error?.code === '22P02' || error?.code === '23514' || error?.code === '23503') {
      return fail(400, 'BAD_REQUEST', 'Commande de situation invalide.');
    }
    if (error?.code === '42501') return fail(403, 'FORBIDDEN', 'Action non autorisée.');
    if (error?.code === '40001' || error?.code === '23505') return fail(409, 'CONFLICT', 'La situation a changé. Rechargez-la.');
    return fail(503, 'UNAVAILABLE', 'Situations de travaux temporairement indisponibles.');
  };
  return async (request: Request) => {
    try {
      if (!await resolveActor(request.headers.get('authorization'))) return fail(401, 'UNAUTHENTICATED', 'Authentification requise.');
      if (request.method === 'GET') {
        const query = new URL(request.url).searchParams;
        if (query.has('situation_id') && query.has('before')) return fail(400, 'BAD_REQUEST', 'Pagination non admise sur le détail.');
        const data = await service.snapshot(query.get('project_id'), query.get('situation_id'), query.get('before'), Number(query.get('limit') ?? 30));
        return Response.json({ data }, { headers });
      }
      if (request.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'Méthode refusée.', { Allow: 'GET, POST' });
      const raw = await request.text();
      if (raw.length > 131_072) return fail(413, 'PAYLOAD_TOO_LARGE', 'Commande trop volumineuse.');
      let input: any;
      try { input = JSON.parse(raw); } catch { return fail(400, 'BAD_REQUEST', 'Corps JSON invalide.'); }
      if (!input || Array.isArray(input) || typeof input !== 'object') return fail(400, 'BAD_REQUEST', 'Commande invalide.');
      return Response.json({ data: await service.command(input) }, { headers });
    } catch (error) {
      return rpcFailure(error);
    }
  };
}

export function createNativeWorkSituationEventsHandler(
  service: SiteWorkSituationService,
  resolveActor: (authorization: string | null) => Promise<{ id: string } | null>,
) {
  return async (request: Request) => {
    const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
    if (!await resolveActor(request.headers.get('authorization'))) return Response.json({ error: 'Authentification requise.', code: 'UNAUTHENTICATED' }, { status: 401, headers });
    if (request.method !== 'GET') return Response.json({ error: 'Méthode refusée.', code: 'METHOD_NOT_ALLOWED' }, { status: 405, headers: { ...headers, Allow: 'GET' } });
    try {
      const query = new URL(request.url).searchParams;
      const data = await service.events(query.get('situation_id'), query.get('before'), Number(query.get('limit') ?? 30));
      return Response.json({ data }, { headers });
    } catch (error: any) {
      const denied = error?.code === '42501';
      const bad = error instanceof DomainError || ['22023','22P02'].includes(error?.code);
      return Response.json({ error: denied ? 'Action non autorisée.' : bad ? 'Référence de situation invalide.' : 'Historique temporairement indisponible.', code: denied ? 'FORBIDDEN' : bad ? 'BAD_REQUEST' : 'UNAVAILABLE' }, { status: denied ? 403 : bad ? 400 : 503, headers });
    }
  };
}
