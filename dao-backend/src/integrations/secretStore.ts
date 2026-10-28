/**
 * #515 V1 — server-side credential boundary.
 *
 * The provider registry deliberately never accepts credential values.  This
 * interface is the only boundary through which an authenticated server route
 * may rotate or revoke a provider secret.  Implementations must be backed by
 * a real secret manager (Supabase Vault, KMS, etc.); plaintext database rows,
 * frontend storage and GitHub Actions variables are explicitly not valid.
 */

export type SecretPresence = Readonly<{
  key: string;
  present: boolean;
  rotatedAt: string | null;
}>;

export type SecretStore = Readonly<{
  put(connectionId: string, key: string, value: string): Promise<SecretPresence>;
  revoke(connectionId: string, key: string): Promise<SecretPresence>;
  presence(connectionId: string, key: string): Promise<SecretPresence>;
}>;

export class SecretStoreError extends Error {
  constructor(readonly code: 'vault_unavailable' | 'invalid_secret' | 'secret_not_found') {
    super(code);
    this.name = 'SecretStoreError';
  }
}

const CONNECTION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET_KEY = /^[a-z][a-z0-9_]{1,63}$/;

export function validateSecretInput(connectionId: string, key: string, value?: string): void {
  if (!CONNECTION_ID.test(connectionId) || !SECRET_KEY.test(key)) {
    throw new SecretStoreError('invalid_secret');
  }
  if (value !== undefined && (value.length < 1 || value.length > 16_384 || /[\u0000\r\n]/.test(value))) {
    throw new SecretStoreError('invalid_secret');
  }
}

/** Fail closed until a real server-side vault adapter is configured. */
export const unavailableSecretStore: SecretStore = Object.freeze({
  async put() { throw new SecretStoreError('vault_unavailable'); },
  async revoke() { throw new SecretStoreError('vault_unavailable'); },
  async presence() { throw new SecretStoreError('vault_unavailable'); },
});

export function assertAdminSecretMutation(role: string | null | undefined): void {
  if (role !== 'dao_admin') throw new Error('forbidden');
}
