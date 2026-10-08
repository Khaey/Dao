import { createClient } from '@supabase/supabase-js';
import { publicSiteUrl } from '../services/ResendEmailTransport.js';

// Business authorization and writes always use the authenticated JWT client.
// The Auth admin client is instantiated only after the database Admin preflight.
export function createBackofficeHandler(db: any, resolveActor: (header: string | null) => Promise<any>, authAdmin: () => any) {
  async function rpc(name: string, input: Record<string, unknown>) {
    const { data, error } = await db.rpc(name, input);
    if (error) throw error;
    return data;
  }
  return async (request: Request) => {
    try {
      if (!await resolveActor(request.headers.get('authorization'))) return Response.json({ error: 'Authentification requise' }, { status: 401 });
      if (request.method === 'GET') {
        const params = new URL(request.url).searchParams;
        return Response.json({ data: await rpc('backoffice_read', { p_view: params.get('view') || 'projects', p_filters: Object.fromEntries([...params].filter(([key]) => key !== 'view')) }) });
      }
      const body = await request.json();
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw { code: '22023', message: 'Commande invalide' };
      const key = String(body.idempotency_key || '');
      const input = body.input || {};
      if (body.action === 'invite_staff') {
        const prepared = await rpc('backoffice_command', { p_action: 'prepare_staff_invitation', p_input: input, p_key: key });
        if (prepared.status === 'completed') return Response.json({ data: { status: 'completed' } });
        // The server resolves an already-created Auth identity on saga retry.
        const identity = await rpc('backoffice_read', { p_view: 'users', p_filters: { q: prepared.email } });
        let target = identity.rows.find((row: any) => row.email?.toLowerCase() === prepared.email)?.id;
        if (!target) {
          const activationUrl = `${publicSiteUrl()}/auth/activate-staff`;
          const { data, error } = await authAdmin().auth.admin.inviteUserByEmail(prepared.email, { data: { display_name: prepared.display_name }, redirectTo: activationUrl });
          if (error || !data?.user?.id) throw { code: 'AUTH_INVITATION_FAILED', message: 'Invitation indisponible. La demande est conservée ; réessayez avec la même demande.' };
          target = data.user.id;
        }
        return Response.json({ data: await rpc('backoffice_command', { p_action: 'complete_staff_invitation', p_input: { invitation_id: prepared.id, user_id: target }, p_key: key + ':complete' }) });
      }
      return Response.json({ data: await rpc('backoffice_command', { p_action: body.action, p_input: input, p_key: key }) });
    } catch (error: any) {
      const code = error?.code;
      const status = code === '42501' ? 403 : ['23505','23514','P0001'].includes(code) ? 409 : ['22023','22P02'].includes(code) || error instanceof SyntaxError ? 400 : 500;
      return Response.json({ error: status === 500 ? 'Opération indisponible. Réessayez.' : error?.message || 'Opération refusée', code }, { status });
    }
  };
}

export function authAdministration(url: string, key: string) {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
