import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.0';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET_KEY = /^[a-z][a-z0-9_]{1,63}$/;
const MAX_SECRET_LENGTH = 16_384;
const allowedOrigin = Deno.env.get('DAO_FRONTEND_ORIGIN') ?? 'https://dao-dev.logiclab.fr';
const cors = { 'access-control-allow-origin': allowedOrigin, 'access-control-allow-headers': 'authorization, content-type, apikey', 'access-control-allow-methods': 'POST, OPTIONS', 'vary': 'Origin' };
const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...cors } });

function vaultName(connectionId: string, key: string): string {
  return `dao-provider/${connectionId}/${key}`;
}

/** Admin-only credential boundary. Values are written to Supabase Vault only. */
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const authorization = request.headers.get('authorization');
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!authorization?.startsWith('Bearer ') || !url || !anonKey || !serviceKey) return json({ error: 'unauthorized' }, 401);

  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return json({ error: 'unauthorized' }, 401);

  const adminClient = createClient(url, serviceKey);
  const { data: roleRows, error: roleError } = await adminClient.from('user_roles').select('role').eq('user_id', user.id).eq('role', 'dao_admin').limit(1);
  if (roleError || !roleRows?.length) return json({ error: 'forbidden' }, 403);

  let input: { action?: unknown; connection_id?: unknown; key?: unknown; value?: unknown; reason?: unknown };
  try { input = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }
  const connectionId = typeof input.connection_id === 'string' ? input.connection_id : '';
  const key = typeof input.key === 'string' ? input.key : '';
  const action = input.action ?? (input.value === undefined ? 'revoke' : 'put');
  if (!UUID.test(connectionId) || !SECRET_KEY.test(key) || !['put', 'revoke'].includes(String(action))) return json({ error: 'invalid_request' }, 400);
  if (typeof input.reason !== 'string' || input.reason.trim().length < 5 || input.reason.length > 500) return json({ error: 'invalid_reason' }, 400);
  if (action === 'put' && (typeof input.value !== 'string' || input.value.length < 1 || input.value.length > MAX_SECRET_LENGTH || /[\u0000\r\n]/.test(input.value))) return json({ error: 'invalid_secret' }, 400);

  const { data: allowed, error: allowError } = await adminClient.rpc('provider_secret_connection_allowed', { p_connection_id: connectionId, p_key: key });
  if (allowError || allowed !== true) return json({ error: 'invalid_request' }, 400);

  const name = vaultName(connectionId, key);
  try {
    if (action === 'put') {
      const { error } = await adminClient.rpc('provider_secret_put', { p_name: name, p_value: input.value });
      if (error) return json({ error: 'vault_unavailable' }, 503);
      const { error: auditError } = await adminClient.rpc('provider_secret_audit', { p_actor: user.id, p_connection_id: connectionId, p_action: 'put_secret', p_reason: input.reason });
      if (auditError) return json({ error: 'vault_unavailable' }, 503);
      return json({ present: true, rotated_at: new Date().toISOString() });
    }
    const { error: revokeError } = await adminClient.rpc('provider_secret_revoke', { p_name: name });
    if (revokeError) return json({ error: 'vault_unavailable' }, 503);
    const { error: auditError } = await adminClient.rpc('provider_secret_audit', { p_actor: user.id, p_connection_id: connectionId, p_action: 'revoke_secret', p_reason: input.reason });
    if (auditError) return json({ error: 'vault_unavailable' }, 503);
    return json({ present: false, rotated_at: null });
  } catch {
    return json({ error: 'vault_unavailable' }, 503);
  }
});
