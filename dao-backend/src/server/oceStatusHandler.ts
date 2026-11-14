import { createOceGateway, disabledGateway } from '../oce/gatewayClient.js';

/**
 * OCE is optional: the native D.A.O. tracking never depends on it. The interface asks this route once before showing
 * any OpenConstructionERP planning block, so that no OCE planning call (and no refused-access error) happens while the
 * integration is switched off. Exposes a single boolean, no project data and no configuration value.
 */
export function oceIntegrationEnabled(env: Record<string, string | undefined> = process.env) {
  return createOceGateway(env) !== disabledGateway;
}

export function createOceStatusHandler(env: Record<string, string | undefined> = process.env) {
  return async (request: Request) => {
    if (request.method !== 'GET') return Response.json({ error: 'Méthode refusée.', code: 'METHOD_NOT_ALLOWED' }, { status: 405, headers: { Allow: 'GET' } });
    return Response.json({ data: { enabled: oceIntegrationEnabled(env) } }, { headers: { 'Cache-Control': 'no-store' } });
  };
}
