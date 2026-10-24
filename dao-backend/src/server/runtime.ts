import { createBackofficeHandler, authAdministration } from './backofficeHandler.js';
import { createClient } from '@supabase/supabase-js';
import { ProjectService, PublicationService, BidService, AwardService, DocumentService, ProfileService, AIService, MessageService, ContractReadService, ContractConfigurationService, PrecontractAgreementService, SiteExecutionService, QuotePdfService } from '../services/index.js';
import { createDaoApi } from './nextHandlers.js';
import { InvitationAuthorization } from '../services/InvitationAuthorization.js';
import { ProjectInvitationEmailService, invitationSecretColumns } from '../services/ProjectInvitationEmailService.js';
import { emailConfiguration, ResendEmailTransport } from '../services/ResendEmailTransport.js';
import { createInvitationEmailHandler } from './invitationEmailHandler.js';
import { createProfessionalHandler } from './professionalHandler.js';
import { NotificationService } from '../services/NotificationService.js';
import { createNotificationHandler } from './notificationHandler.js';
import { createOcePlanningHandler } from './ocePlanningHandler.js';
import { createOceGateway } from '../oce/gatewayClient.js';
import { createOceLotPlanHandler } from './oceLotPlanHandler.js';
import { LotPlanSynchronizer } from '../oce/lotPlanSync.js';
import { ProjectPlanSynchronizer } from '../oce/projectPlanSync.js';
import { createOceProjectPlanHandler } from './oceProjectPlanHandler.js';
import { OceOrchestrator } from '../oce/orchestrator.js';
import { SupabaseOceSyncStore } from '../oce/oceSyncStore.js';
import { SupportService } from '../services/SupportService.js';
import { createSupportHandler } from './supportHandler.js';
import { RfiService } from '../services/RfiService.js';
import { createRfiHandler } from './rfiHandler.js';
import { RfiDocumentService } from '../services/RfiDocumentService.js';
import { createNativeExecutionPlanHandler } from './nativeExecutionPlanHandler.js';
import { createNativeExecutionScopeHandler } from './nativeExecutionScopeHandler.js';
import { createNativeExecutionActivityHandler } from './nativeExecutionActivityHandler.js';

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

export function createNotificationApi(request: Request) {
  const { db, resolveActor } = requestScope(request);
  return createNotificationHandler(new NotificationService(db), resolveActor);
}

export function createSupportApi(request: Request) {
  const { db, resolveActor } = requestScope(request);
  return createSupportHandler(new SupportService(db), resolveActor);
}

export function createRfiApi(request: Request) {
  const { url, db, resolveActor } = requestScope(request);
  const storage=createClient(url,env('DAO_SUPABASE_SECRET_KEY'),{auth:{persistSession:false,autoRefreshToken:false}}).storage;
  return createRfiHandler(new RfiService(db),new RfiDocumentService(db,storage), resolveActor);
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
    profiles: new ProfileService(db), ai: new AIService(db), messages: new MessageService(db),
    contracts: new ContractReadService(db), contractConfiguration: new ContractConfigurationService(db), precontractAgreements: new PrecontractAgreementService(db),
    siteExecution: new SiteExecutionService(db), quotePdf: new QuotePdfService(db)
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

export function createBackofficeApi(request: Request) {
  const { url, db, resolveActor } = requestScope(request);
  return createBackofficeHandler(db, resolveActor, () => authAdministration(url, env('DAO_SUPABASE_SECRET_KEY')));
}

export function createProfessionalApi(request:Request) {
  const {url,db,resolveActor}=requestScope(request);
  return createProfessionalHandler(db,resolveActor,()=>createClient(url,env('DAO_SUPABASE_SECRET_KEY'),{auth:{persistSession:false,autoRefreshToken:false}}));
}

let oceGateway: ReturnType<typeof createOceGateway> | undefined;
/** Read-only OCE technical summary. The gateway client is disabled unless DAO_OCE_ENABLED=1 (no credential here). */
export function createOcePlanningApi(request: Request) {
  const { db, resolveActor } = requestScope(request);
  // One client per process so the circuit breaker keeps its state across requests.
  oceGateway ??= createOceGateway(process.env);
  return createOcePlanningHandler(db, resolveActor, oceGateway);
}

let lotPlanSynchronizer: LotPlanSynchronizer | undefined;
/** Server-side synchroniser: uses the service client ONLY for the closed sync tables and the ready-plan read, after the user-scoped RPC authorized the call. */
function oceSynchronizer() {
  if (lotPlanSynchronizer) return lotPlanSynchronizer;
  oceGateway ??= createOceGateway(process.env);
  const service = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('DAO_SUPABASE_SECRET_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
  lotPlanSynchronizer = new LotPlanSynchronizer(
    async ref => { const { data, error } = await service.rpc('oce_lot_plan_for_sync', { p_project_id: ref.dao_project_id, p_request_id: ref.dao_lot_id }); if (error) throw new Error('oce_plan_read'); return data; },
    new OceOrchestrator(oceGateway, new SupabaseOceSyncStore(service)),
  );
  return lotPlanSynchronizer;
}

/**
 * Modifier / retirer / ajouter un lien (#325) : actif par défaut, car la passerelle déployée sait retirer (remove-dependency / remove-activity)
 * et, intégration éteinte, rien n'est à retirer d'OCE. Interrupteur de repli : DAO_OCE_REMOVAL=0 (un lien effectif redevient définitif).
 */
const removalEnabled = () => process.env.DAO_OCE_REMOVAL !== '0';

let projectPlanSynchronizer: ProjectPlanSynchronizer | undefined;
/** Global project plan (#325): one OCE graph for all lots, keyed by the project's planning context. Same service-client discipline as the lot synchroniser. */
function projectSynchronizer() {
  if (projectPlanSynchronizer) return projectPlanSynchronizer;
  oceGateway ??= createOceGateway(process.env);
  const service = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('DAO_SUPABASE_SECRET_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
  projectPlanSynchronizer = new ProjectPlanSynchronizer(
    async projectId => { const { data, error } = await service.rpc('oce_project_plan_for_sync', { p_project_id: projectId }); if (error) throw new Error('oce_project_plan_read'); return data; },
    new OceOrchestrator(oceGateway, new SupabaseOceSyncStore(service), { removal: removalEnabled() }),
    async (projectId, revision, planning, errorCode) => {
      const { error } = await service.rpc('oce_record_project_plan_result', { p_project_id: projectId, p_revision: revision, p_duration: planning?.duration ?? null, p_critical: planning?.critical ?? [], p_error: errorCode });
      if (error) throw new Error('oce_project_plan_record');
    },
  );
  return projectPlanSynchronizer;
}

/** Lot planning input and synchronisation supervision. Saving a ready plan synchronises with OCE automatically (#301), then refreshes the project's global plan (#325). */
export function createOceLotPlanApi(request: Request) {
  const { db, resolveActor } = requestScope(request);
  return createOceLotPlanHandler(db, resolveActor, async ref => { const outcome = await oceSynchronizer().run(ref); await projectSynchronizer().run(ref.dao_project_id); return outcome; });
}

/** Global project planning screen API (#325). */
export function createOceProjectPlanApi(request: Request) {
  const { db, resolveActor } = requestScope(request);
  return createOceProjectPlanHandler(db, resolveActor, projectId => projectSynchronizer().run(projectId), undefined, { linkEditing: removalEnabled() });
}

/** Native tracking table read model (#411). This path is JWT-scoped and never invokes OCE. */
export function createNativeExecutionPlanApi(request: Request) {
  const { db, resolveActor } = requestScope(request);
  return createNativeExecutionPlanHandler(db, resolveActor);
}

/** Native post-award activity commands use the caller JWT and database authorization. */
export function createNativeExecutionActivityApi(request: Request) {
  const { db, resolveActor } = requestScope(request);
  return createNativeExecutionActivityHandler(db, resolveActor);
}

/** Bilateral references from an agreement installment to an execution scope. */
export function createNativeExecutionScopeApi(request: Request) {
  const { db, resolveActor } = requestScope(request);
  return createNativeExecutionScopeHandler(db, resolveActor);
}
