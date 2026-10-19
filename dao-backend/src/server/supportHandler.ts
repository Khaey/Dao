import { SupportContractError } from '../support/contract.js';
import type { SupportService } from '../services/SupportService.js';

type Actor = { id: string };
const privateHeaders = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };

export function createSupportHandler(service: SupportService, resolveActor: (header: string | null) => Promise<Actor | null>) {
  async function run(request: Request, operation: () => Promise<unknown>) {
    try {
      if (!await resolveActor(request.headers.get('authorization'))) return failure('unauthenticated', 401);
      return Response.json({ data: await operation() }, { headers: privateHeaders });
    } catch (error: any) {
      const raw = error instanceof SupportContractError ? error.code : error?.code;
      if (raw === 'invalid' || raw === '22023' || raw === '22P02' || error instanceof SyntaxError)
        return failure(error?.message === 'Ticket fermé' ? 'ticket_closed' : 'invalid', 400);
      if (raw === 'P0001') return failure('rate_limited', 429);
      if (raw === '42501' || raw === 'forbidden') return failure('forbidden', 403);
      return failure('unavailable', 503);
    }
  }
  const body = async (request: Request) => await request.json() as unknown;
  return {
    summary: (request: Request) => run(request, () => service.summary()),
    list: (request: Request) => run(request, () => service.list(new URL(request.url).searchParams)),
    create: (request: Request) => run(request, async () => service.create(await body(request))),
    detail: (request: Request, id: string) => run(request, () => service.detail(id)),
    reply: (request: Request, id: string) => run(request, async () => service.reply(id, await body(request))),
    markRead: (request: Request, id: string) => run(request, () => service.markRead(id)),
    queue: (request: Request) => run(request, () => service.list(new URL(request.url).searchParams, true)),
    assign: (request: Request, id: string) => run(request, async () => service.assign(id, await body(request))),
    setStatus: (request: Request, id: string) => run(request, async () => service.setStatus(id, await body(request))),
  };
}

function failure(code: string, status: number) {
  const labels: Record<string, string> = {
    unauthenticated: 'Authentification requise.', forbidden: 'Accès refusé.', not_found: 'Ticket introuvable.',
    ticket_closed: 'Ce ticket est fermé.', invalid: 'Paramètres invalides.', rate_limited: 'Trop de demandes.',
    unavailable: 'Assistance temporairement indisponible.',
  };
  return Response.json({ error: labels[code], code }, { status, headers: privateHeaders });
}
