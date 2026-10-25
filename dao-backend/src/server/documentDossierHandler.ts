import { DomainError } from '../lib/errors.js';
import { DocumentDossierService } from '../services/DocumentDossierService.js';

const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
export function createDocumentDossierHandler(
  service: DocumentDossierService,
  resolveActor: (authorization: string | null) => Promise<{ id: string } | null>,
) {
  const fail = (status: number, code: string, error: string, extra: Record<string, string> = {}) =>
    Response.json({ error, code }, { status, headers: { ...headers, ...extra } });
  const rpcFailure = (error: any) => {
    if (error instanceof DomainError || ['22023', '22P02', '23503'].includes(error?.code)) return fail(400, 'BAD_REQUEST', 'Demande documentaire invalide.');
    if (error?.code === '42501') return fail(403, 'FORBIDDEN', 'Action non autorisée.');
    if (error?.code === '40001') return fail(409, 'CONFLICT', 'Le dossier a changé. Rechargez-le.');
    if (error?.code === '23505') return fail(409, 'CONFLICT', 'Ce document est déjà versionné.');
    if (error?.code === '23514') return fail(409, 'UNAVAILABLE_STATE', 'Action impossible dans l’état actuel du document.');
    return fail(503, 'UNAVAILABLE', 'Dossier documentaire temporairement indisponible.');
  };
  return async (request: Request) => {
    try {
      if (!await resolveActor(request.headers.get('authorization'))) return fail(401, 'UNAUTHENTICATED', 'Authentification requise.');
      if (request.method === 'GET') {
        const query = new URL(request.url).searchParams;
        return Response.json({ data: await service.snapshot(query.get('project_id'), query.get('request_id')) }, { headers });
      }
      if (request.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'Méthode refusée.', { Allow: 'GET, POST' });
      const raw = await request.text();
      if (raw.length > 16_384) return fail(413, 'PAYLOAD_TOO_LARGE', 'Commande trop volumineuse.');
      let input: any;
      try { input = JSON.parse(raw); } catch { return fail(400, 'BAD_REQUEST', 'Corps JSON invalide.'); }
      if (!input || Array.isArray(input) || typeof input !== 'object') return fail(400, 'BAD_REQUEST', 'Commande invalide.');
      return Response.json({ data: await service.command(input) }, { headers });
    } catch (error) {
      return rpcFailure(error);
    }
  };
}
