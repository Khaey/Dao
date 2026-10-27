import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.0';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/i;
const SECRET_KEY = /^[a-z][a-z0-9_]{1,63}$/;
const MAX_SECRET_LENGTH = 16_384;
const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function vaultName(connectionId: string, key: string): string {
  return `dao-provider/${connectionId}/${key}`;
}

/** Admin-only credential boundary. Values are written to Supabase Vault only. */
Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const authorization = request.headers.get('authorization');
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!authorization?.startsWith('Bearer ') || !url || !anonKey || !serviceKey) {
    return json({ error: 'unauthorized' }, 401);
  }

  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return json({ error: 'unauthorized' }, 401);

  // Do not trust user_metadata or a caller-supplied role. Authorization is
  // canonicalized from public.user_roles through the authenticated RPC path.
  const adminClient = createClient(url, serviceKey);
  const { data: roleRows, error: roleError } = await adminClient
    .from('user_roles').select('role').eq('user_id', user.id).eq('role', 'dao_admin').limit(1);
  if (roleError || !roleRows?.length) return json({ error: 'forbidden' }, 403);

  let input: { action?: unknown; connection_id?: unknown; key?: unknown; value?: unknown };
  try { input = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }
  const connectionId = typeof input.connection_id === 'string' ? input.connection_id : '';
  const key = typeof input.key === 'string' ? input.key : '';
  const action = input.action;
  if (!UUID.test(connectionId) || !SECRET_KEY.test(key) || !['put', 'revoke'].includes(String(action))) {
    return json({ error: 'invalid_request' }, 400);
  }
  if (action === 'put' && (typeof input.value !== 'string' || input.value.length < 1 || input.value.length > MAX_SECRET_LENGTH || /[\u0000\r\n]/.test(input.value))) {
    return json({ error: 'invalid_secret' }, 400);
  }

  const name = vaultName(connectionId, key);
  try {
    if (action === 'put') {
      const existing = await adminClient.schema('vault').rpc('get_secret', { secret_name: name });
      const rpcName = existing.error ? 'create_secret' : 'update_secret';
      const args = rpcName === 'create_secret'
        ? { secret: input.value, name, description: 'D.A.O. provider credential' }
        : { secret_id: existing.data?.id, new_secret: input.value, new_description: 'D.A.O. provider credential' };
      const { error } = await adminClient.schema('vault').rpc(rpcName, args);
      if (error) return json({ error: 'vault_unavailable' }, 503);
      return json({ present: true, rotated_at: new Date().toISOString() });
    }
    const { data, error } = await adminClient.schema('vault').rpc('get_secret', { secret_name: name });
    if (error || !data?.id) return json({ present: false, rotated_at: null });
    const { error: revokeError } = await adminClient.schema('vault').rpc('delete_secret', { secret_id: data.id });
    if (revokeError) return json({ error: 'vault_unavailable' }, 503);
    return json({ present: false, rotated_at: null });
  } catch {
    return json({ error: 'vault_unavailable' }, 503);
  }
});
