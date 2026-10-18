import { NotificationService } from '../services/NotificationService.js';
import { NotificationContractError } from '../notifications/contract.js';

/** No privileged client, raw SQL message, payload logging or cross-user input. */
export function createNotificationHandler(service: NotificationService, resolveActor: (header: string | null) => Promise<{ id: string } | null>) {
  const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
  return async (request: Request) => {
    try {
      if (!await resolveActor(request.headers.get('authorization')))
        return Response.json({ error: 'Authentification requise.', code: 'UNAUTHENTICATED' }, { status: 401, headers });
      if (request.method === 'GET') return Response.json({ data: await service.list(new URL(request.url).searchParams) }, { headers });
      if (request.method !== 'PATCH') return Response.json({ error: 'Méthode refusée.', code: 'METHOD_NOT_ALLOWED' }, { status: 405, headers: { ...headers, Allow: 'GET, PATCH' } });
      const body = await request.json();
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'id'))
        throw new NotificationContractError('BAD_REQUEST');
      return Response.json({ data: await service.markRead(body.id) }, { headers });
    } catch (error: any) {
      const invalid = error instanceof SyntaxError || error?.code === 'BAD_REQUEST' || error?.code === '22023' || error?.code === '22P02';
      const forbidden = error?.code === '42501';
      return Response.json({ error: invalid ? 'Paramètres de notifications invalides.' : forbidden ? 'Accès aux notifications refusé.' : 'Notifications temporairement indisponibles.',
        code: invalid ? 'BAD_REQUEST' : forbidden ? 'FORBIDDEN' : 'UNAVAILABLE' }, { status: invalid ? 400 : forbidden ? 403 : 503, headers });
    }
  };
}
