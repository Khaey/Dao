import { createClient } from '@supabase/supabase-js';
import { ProjectService, PublicationService, BidService, AwardService, DocumentService } from '../services/index.js';
import { createDaoApi } from './nextHandlers.js';

function env(name: string) { const value = process.env[name]; if (!value) throw new Error(`Missing environment variable: ${name}`); return value; }

export function createRequestApi(request: Request) {
  const url = env('NEXT_PUBLIC_SUPABASE_URL');
  const key = env('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  const secret = env('DAO_SUPABASE_SECRET_KEY');
  const authorization = request.headers.get('authorization');
  const db = createClient(url, key, { global: { headers: authorization ? { authorization } : {} } });
  // db is JWT-scoped. storageAdmin is server-only and is used only after
  // authorization has succeeded through db/RLS.
  const storageAdmin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } }).storage;
  const services = {
    projects: new ProjectService(db), publications: new PublicationService(db), bids: new BidService(db),
    awards: new AwardService(db), documents: new DocumentService(db, storageAdmin)
  };
  return createDaoApi(services, async (header) => {
    if (!header?.startsWith('Bearer ')) return null;
    const token = header.slice(7);
    const authClient = createClient(url, key, { global: { headers: { authorization: header } } });
    const { data, error } = await authClient.auth.getUser(token);
    if (error || !data.user) return null;
    return { id: data.user.id };
  });
}
