import { DomainError } from '../lib/errors.js';
import type { BtpEstimateService } from '../services/BtpEstimateService.js';

const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
const KEY = /^[A-Za-z0-9._:-]{8,100}$/;

function fail(status: number, code: string, error: string) {
  return Response.json({ error, code }, { status, headers });
}
function failure(error: any) {
  if (error instanceof DomainError) return fail(error.code === 'NOT_FOUND' ? 404 : 400, error.code, error.message);
  const code = error?.code;
  if (code === '42501') return fail(403, 'FORBIDDEN', 'Action non autorisée pour ce chantier ou ce tarif.');
  if (code === 'P0002') return fail(404, 'NOT_FOUND', 'Élément introuvable.');
  if (code === '40001') return fail(409, 'CONFLICT', 'Une version plus récente existe. Rechargez la page.');
  if (['22023', '23514', '22P02', '23503', '23505', '22007', '22008', '22003', '23502'].includes(code))
    return fail(400, 'BAD_REQUEST', error?.message ? `Demande refusée : ${error.message}` : 'Demande invalide.');
  return fail(503, 'UNAVAILABLE', 'Service d’estimation temporairement indisponible.');
}
async function readBody(request: Request) {
  const raw = await request.text();
  if (raw.length > 64_000) throw new DomainError('Demande trop volumineuse', 'BAD_REQUEST');
  let body: any;
  try { body = JSON.parse(raw); } catch { throw new DomainError('Corps JSON invalide', 'BAD_REQUEST'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DomainError('Corps JSON invalide', 'BAD_REQUEST');
  const { action, idempotencyKey, ...input } = body;
  if (typeof action !== 'string') throw new DomainError('Action requise', 'BAD_REQUEST');
  if (idempotencyKey != null && (typeof idempotencyKey !== 'string' || !KEY.test(idempotencyKey))) throw new DomainError('Clé idempotente invalide', 'BAD_REQUEST');
  return { action, key: (idempotencyKey as string | undefined) ?? null, input };
}
function onlyParams(url: URL, allowed: string[]) {
  for (const key of url.searchParams.keys()) if (!allowed.includes(key)) throw new DomainError('Paramètre non autorisé', 'BAD_REQUEST');
  for (const key of allowed) if (url.searchParams.getAll(key).length > 1) throw new DomainError('Paramètre dupliqué', 'BAD_REQUEST');
}

type Resolve = (authorization: string | null) => Promise<{ id: string } | null>;

/** `/api/btp/prices` : GET liste (filtrée par droits), POST commande tarifaire typée. */
export function createBtpPriceHandler(service: Pick<BtpEstimateService, 'prices' | 'priceCommand'>, resolveActor: Resolve) {
  return async (request: Request) => {
    try {
      if (!await resolveActor(request.headers.get('authorization'))) return fail(401, 'UNAUTHENTICATED', 'Authentification requise.');
      if (request.method === 'GET') {
        const url = new URL(request.url); onlyParams(url, ['project_id']);
        return Response.json({ data: await service.prices(url.searchParams.get('project_id')) }, { headers });
      }
      if (request.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'Méthode refusée.');
      const { action, key, input } = await readBody(request);
      if (!key) return fail(400, 'BAD_REQUEST', 'Clé idempotente requise.');
      return Response.json({ data: await service.priceCommand(action, input, key) }, { headers });
    } catch (error) { return failure(error); }
  };
}

/** `/api/btp/estimates` : GET dossier d'estimation du chantier, POST preview/calculate/approve. */
export function createBtpEstimateHandler(service: Pick<BtpEstimateService, 'snapshot' | 'estimateCommand'>, resolveActor: Resolve) {
  return async (request: Request) => {
    try {
      if (!await resolveActor(request.headers.get('authorization'))) return fail(401, 'UNAUTHENTICATED', 'Authentification requise.');
      if (request.method === 'GET') {
        const url = new URL(request.url); onlyParams(url, ['project_id']);
        const projectId = url.searchParams.get('project_id');
        if (!projectId) return fail(400, 'BAD_REQUEST', 'Chantier requis.');
        return Response.json({ data: await service.snapshot(projectId) }, { headers });
      }
      if (request.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'Méthode refusée.');
      const { action, key, input } = await readBody(request);
      return Response.json({ data: await service.estimateCommand(action, input, key) }, { headers });
    } catch (error) { return failure(error); }
  };
}
