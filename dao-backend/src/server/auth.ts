import { DomainError } from '../lib/errors.js';

export type AuthenticatedActor = { id: string; roles?: readonly string[] };

export function requireActor(actor: AuthenticatedActor | null | undefined): AuthenticatedActor {
  if (!actor?.id) throw new DomainError('Authentication required', 'UNAUTHENTICATED');
  return actor;
}

export function ownedInput<T extends Record<string, unknown>>(actor: AuthenticatedActor, input: T, ownerKey: string) {
  requireActor(actor);
  const copy = { ...input };
  delete copy.user_id;
  delete copy.client_id;
  delete copy.contractor_id;
  if (ownerKey) (copy as Record<string, unknown>)[ownerKey] = actor.id;
  return copy;
}
