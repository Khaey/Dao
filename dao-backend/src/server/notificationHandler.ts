import { NotificationService } from '../services/NotificationService.js';
import { NotificationContractError } from '../notifications/contract.js';

type NotificationObservation = { category: 'OK'|'UNAUTHENTICATED'|'METHOD_NOT_ALLOWED'|'BAD_REQUEST'|'FORBIDDEN'|'UNAVAILABLE'; page_size?: number };
const totals = { requests: 0, errors: 0 };
function recordObservation(event: NotificationObservation) {
  totals.requests++;
  if (event.category !== 'OK') totals.errors++;
  if (event.category === 'UNAVAILABLE') console.warn(JSON.stringify({ event: 'notifications_error', category: event.category, total_errors: totals.errors }));
}
/** No privileged client, raw SQL message, payload logging or cross-user input. */
export function createNotificationHandler(service: NotificationService, resolveActor: (header: string | null) => Promise<{ id: string } | null>, observe: (event: NotificationObservation) => void = recordObservation) {
  const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
  function report(event: NotificationObservation) { try { observe(event); } catch { /* Metrics never change business results. */ } }
  return async (request: Request) => {
    try {
      if (!await resolveActor(request.headers.get('authorization'))) {
        report({ category: 'UNAUTHENTICATED' });
        return Response.json({ error: 'Authentification requise.', code: 'UNAUTHENTICATED' }, { status: 401, headers });
      }
      if (request.method === 'GET') {
        const data = await service.list(new URL(request.url).searchParams);report({ category: 'OK', page_size: data.rows.length });
        return Response.json({ data }, { headers });
      }
      if (request.method !== 'PATCH') {
        report({ category: 'METHOD_NOT_ALLOWED' });
        return Response.json({ error: 'Méthode refusée.', code: 'METHOD_NOT_ALLOWED' }, { status: 405, headers: { ...headers, Allow: 'GET, PATCH' } });
      }
      const body = await request.json();
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'id'))
        throw new NotificationContractError('BAD_REQUEST');
      const data = await service.markRead(body.id);report({ category: 'OK' });
      return Response.json({ data }, { headers });
    } catch (error: any) {
      const invalid = error instanceof SyntaxError || error?.code === 'BAD_REQUEST' || error?.code === '22023' || error?.code === '22P02';
      const forbidden = error?.code === '42501';
      report({ category: invalid ? 'BAD_REQUEST' : forbidden ? 'FORBIDDEN' : 'UNAVAILABLE' });
      return Response.json({ error: invalid ? 'Paramètres de notifications invalides.' : forbidden ? 'Accès aux notifications refusé.' : 'Notifications temporairement indisponibles.',
        code: invalid ? 'BAD_REQUEST' : forbidden ? 'FORBIDDEN' : 'UNAVAILABLE' }, { status: invalid ? 400 : forbidden ? 403 : 503, headers });
    }
  };
}
