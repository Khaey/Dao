import { requireActor, type AuthenticatedActor } from './auth.js';
import { ProjectService } from '../services/ProjectService.js';
import { PublicationService } from '../services/PublicationService.js';
import { BidService } from '../services/BidService.js';
import { AwardService } from '../services/AwardService.js';
import { DocumentService } from '../services/DocumentService.js';

export type BackendServices = { projects: ProjectService; publications: PublicationService; bids: BidService; awards: AwardService; documents: DocumentService };

export async function createProject(s: BackendServices, actor: AuthenticatedActor, input: Record<string, unknown>) {
  requireActor(actor);
  return s.projects.create({ ...input, client_id: actor.id });
}
export async function addProjectRequest(s: BackendServices, actor: AuthenticatedActor, input: Record<string, unknown>) { requireActor(actor); return s.projects.addRequest(input); }
export async function updateProjectRequest(s: BackendServices, actor: AuthenticatedActor, input: Record<string, unknown>) { requireActor(actor); return s.projects.updateRequest(input); }
export async function withdrawProjectRequest(s: BackendServices, actor: AuthenticatedActor, requestId: string) { requireActor(actor); return s.projects.withdrawRequest(requestId); }
export async function confirmProject(s: BackendServices, actor: AuthenticatedActor, id: string) { requireActor(actor); return s.projects.confirmClient(id, actor.id); }
export async function submitForDaoReview(s: BackendServices, actor: AuthenticatedActor, id: string) { requireActor(actor); return s.projects.submitForDaoReview(id, actor.id); }
export async function publishProject(s: BackendServices, actor: AuthenticatedActor, input: Record<string, unknown>) { requireActor(actor); return s.publications.publish({ ...input, actor_id: actor.id }); }
export async function createBid(s: BackendServices, actor: AuthenticatedActor, input: Record<string, unknown>) { requireActor(actor); return s.bids.createDraft({ ...input, contractor_user_id: actor.id }); }
export async function submitBid(s: BackendServices, actor: AuthenticatedActor, versionId: string) { requireActor(actor); return s.bids.submitForActor(versionId, actor.id); }
export async function awardRequest(s: BackendServices, actor: AuthenticatedActor, input: Record<string, unknown>) { requireActor(actor); return s.awards.award({ ...input, actor_id: actor.id }); }
export async function signedUpload(s: BackendServices, actor: AuthenticatedActor, input: { bidVersionId: string; path: string; mimeType: string; sizeBytes: number }) { requireActor(actor); return s.documents.signedUploadForActor(actor.id, input); }
export async function signedDownload(s: BackendServices, actor: AuthenticatedActor, id: string, expiresIn?: number) { requireActor(actor); return s.documents.signedDownloadForActor(actor.id, id, expiresIn); }
