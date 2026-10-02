import { requireActor, AuthenticatedActor } from './auth.js';
import type { ProjectInvitationEmailService } from '../services/ProjectInvitationEmailService.js';
import { DomainError } from '../lib/errors.js';
import { invitationEmailFailure } from '../services/ResendEmailTransport.js';

export function createInvitationEmailHandler(service: ProjectInvitationEmailService, resolveActor: (header: string | null) => Promise<AuthenticatedActor | null>) {
  return async (request: Request, id: string) => {
    try {
      const actor = requireActor(await resolveActor(request.headers.get('authorization')));
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw new DomainError('Invitation indisponible.', 'BAD_REQUEST');
      let input: any;
      try { input = await request.json(); } catch { throw new DomainError('Invitation indisponible.', 'BAD_REQUEST'); }
      if (!input || Array.isArray(input) || Object.keys(input).length !== 1 || typeof input.token !== 'string' || !/^[a-f0-9]{64}$/.test(input.token)) throw new DomainError('Invitation indisponible.', 'BAD_REQUEST');
      const result = await service.send(actor.id, id, input.token);
      return Response.json({ data: result }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error: any) {
      const status = error?.code === 'UNAUTHENTICATED' ? 401 : error?.code === 'FORBIDDEN' ? 403 : error?.code === 'BAD_REQUEST' ? 400 : error?.code === 'INVITATION_UNAVAILABLE' || error?.code === 'INVITATION_NO_EMAIL' ? 409 : error?.code === 'EMAIL_CONFIGURATION' ? 503 : 502;
      const message = status === 401 ? 'Reconnectez-vous pour envoyer l’invitation.' : status === 503 ? 'L’envoi par e-mail est momentanément indisponible. Vous pouvez copier le lien.' : status === 502 ? invitationEmailFailure : 'Invitation indisponible.';
      // This route deliberately does not use the generic raw-error serializer.
      return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
    }
  };
}
