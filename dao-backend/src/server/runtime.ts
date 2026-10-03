import { createClient } from '@supabase/supabase-js';
import { ProjectService, PublicationService, BidService, AwardService, DocumentService, ProfileService, AIService } from '../services/index.js';
import { createDaoApi } from './nextHandlers.js';
import { InvitationAuthorization } from '../services/InvitationAuthorization.js';
import { ProjectInvitationEmailService, invitationSecretColumns } from '../services/ProjectInvitationEmailService.js';
import { emailConfiguration, ResendEmailTransport } from '../services/ResendEmailTransport.js';
import { createInvitationEmailHandler } from './invitationEmailHandler.js';

function env(name: string) { const value = process.env[name]; if (!value) throw new Error(`Missing environment variable: ${name}`); return value; }

function requestScope(request: Request) {
  const url = env('NEXT_PUBLIC_SUPABASE_URL');
  const key = env('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  const authorization = request.headers.get('authorization');
  const db = createClient(url, key, { global: { headers: authorization ? { Authorization: authorization } : {} }, auth: { persistSession: false, autoRefreshToken: false } });
  const resolveActor = async (header: string | null) => {
    if (!header?.startsWith('Bearer ')) return null;
    const token = header.slice(7);
    const authClient = createClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await authClient.auth.getUser();
    if (error || !data.user) return null;
    return { id: data.user.id };
  };
  return { url, db, resolveActor };
}

export function createRequestApi(request: Request) {
  const { url, db, resolveActor } = requestScope(request);
  const secret = env('DAO_SUPABASE_SECRET_KEY');
  // db is JWT-scoped. storageAdmin is server-only and is used only after
  // authorization has succeeded through db/RLS.
  const storageAdmin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } }).storage;
  const services = {
    projects: new ProjectService(db), publications: new PublicationService(db), bids: new BidService(db),
    awards: new AwardService(db), documents: new DocumentService(db, storageAdmin),
    profiles: new ProfileService(db), ai: new AIService(db)
  };
  return createDaoApi(services, resolveActor);
}

export function createInvitationEmailApi(request: Request) {
  const { url, db, resolveActor } = requestScope(request);
  const service = new ProjectInvitationEmailService(
    new InvitationAuthorization(db),
    async id => {
      // Invoked only AFTER JWT authentication, RLS-visible metadata and the
      // shared invitation-management preflight. No privileged writes/RPCs.
      const admin = createClient(url, env('DAO_SUPABASE_SECRET_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await admin.from('project_invitations').select(invitationSecretColumns).eq('id', id).maybeSingle();
      if (error) throw new Error('Invitation lookup failed');
      return data;
    },
    new ResendEmailTransport(),
    () => emailConfiguration(),
  );
  return createInvitationEmailHandler(service, resolveActor);
}
