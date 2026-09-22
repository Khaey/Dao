import { requireActor, type AuthenticatedActor } from './auth.js';
import { ProjectService } from '../services/ProjectService.js';
import { PublicationService } from '../services/PublicationService.js';
import { BidService } from '../services/BidService.js';
import { AwardService } from '../services/AwardService.js';
import { DocumentService } from '../services/DocumentService.js';
import { ProfileService } from '../services/ProfileService.js';
import { AIService } from '../services/AIService.js';

export type BackendServices = {
  projects: ProjectService;
  publications: PublicationService;
  bids: BidService;
  awards: AwardService;
  documents: DocumentService;
  profiles: ProfileService;
  ai: AIService;
};

export async function createProject(s: BackendServices, actor: AuthenticatedActor, input: Record<string, unknown>) {
  requireActor(actor);
  const { client_id: _clientId, user_id: _userId, contractor_id: _contractorId, ...safeInput } = input;
  return s.projects.create(safeInput);
}
export async function updateProjectDraft(s: BackendServices, actor: AuthenticatedActor, input: Record<string, unknown>) {
  requireActor(actor);
  return s.projects.updateDraft(input);
}
export async function addProjectRequest(s: BackendServices, actor: AuthenticatedActor, input: Record<string, unknown>) {
  requireActor(actor);
  return s.projects.addRequest(input);
}
export async function updateProjectRequest(s: BackendServices, actor: AuthenticatedActor, input: Record<string, unknown>) {
  requireActor(actor);
  return s.projects.updateRequest(input);
}
export async function withdrawProjectRequest(s: BackendServices, actor: AuthenticatedActor, requestId: string) {
  requireActor(actor);
  return s.projects.withdrawRequest(requestId);
}
export async function submitProjectForReview(s: BackendServices, actor: AuthenticatedActor, id: string) {
  requireActor(actor);
  return s.projects.submitForReview(id);
}
export async function reviewProject(s: BackendServices, actor: AuthenticatedActor, input: Record<string, unknown>) {
  requireActor(actor);
  return s.projects.review(String(input.project_id), Boolean(input.approve), input.comment as string | undefined);
}
export async function createProjectCorrection(s: BackendServices, actor: AuthenticatedActor, id: string) {
  requireActor(actor);
  return s.projects.createCorrection(id);
}
export async function archiveProject(s: BackendServices, actor: AuthenticatedActor, id: string) {
  requireActor(actor);
  return s.projects.archive(id);
}
export async function upsertProjectPrivateDetails(s: BackendServices, actor: AuthenticatedActor, input: Record<string, unknown>) {
  requireActor(actor);
  return s.projects.upsertPrivateDetails(input);
}
export async function publishProject(s: BackendServices, actor: AuthenticatedActor, input: Record<string, unknown>) {
  requireActor(actor);
  return s.publications.publish(input);
}
export async function createBid(s: BackendServices, actor: AuthenticatedActor, input: Record<string, unknown>) {
  requireActor(actor);
  return s.bids.createDraft({ publication_id: input.publication_id });
}
export async function addBidItem(s: BackendServices, actor: AuthenticatedActor, input: Record<string, unknown>) {
  requireActor(actor);
  return s.bids.addItem(input);
}
export async function submitBid(s: BackendServices, actor: AuthenticatedActor, versionId: string) {
  requireActor(actor);
  return s.bids.submitForActor(versionId);
}
export async function awardRequest(s: BackendServices, actor: AuthenticatedActor, input: Record<string, unknown>) {
  requireActor(actor);
  return s.awards.award(input);
}
export async function signedUpload(s: BackendServices, actor: AuthenticatedActor, input: { bidVersionId: string; path: string; mimeType: string; sizeBytes: number }) {
  requireActor(actor);
  return s.documents.signedUploadForActor(actor.id, input);
}
export async function signedDownload(s: BackendServices, actor: AuthenticatedActor, id: string, expiresIn?: number) {
  requireActor(actor);
  return s.documents.signedDownloadForActor(actor.id, id, expiresIn);
}
export async function listProjectDocuments(s: BackendServices, actor: AuthenticatedActor, projectId: string) {
  requireActor(actor);
  return s.documents.listProjectDocuments(projectId);
}
export async function signedProjectUpload(s: BackendServices, actor: AuthenticatedActor, input: Record<string, unknown>) {
  requireActor(actor);
  return s.documents.signedProjectUpload({
    projectId: String(input.project_id),
    originalName: String(input.original_name),
    mimeType: String(input.mime_type),
    sizeBytes: Number(input.size_bytes),
  });
}
export async function signedProjectDownload(s: BackendServices, actor: AuthenticatedActor, documentId: string, expiresIn?: number) {
  requireActor(actor);
  return s.documents.signedProjectDownload(documentId, expiresIn);
}
export async function deleteProjectDocument(s: BackendServices, actor: AuthenticatedActor, documentId: string) {
  requireActor(actor);
  return s.documents.deleteProjectDocument(documentId);
}
export async function initializeProfile(s: BackendServices, actor: AuthenticatedActor, input: Record<string, unknown> = {}) {
  requireActor(actor);
  return s.profiles.initialize(input);
}
export async function updateProfile(s: BackendServices, actor: AuthenticatedActor, input: Record<string, unknown>) {
  requireActor(actor);
  return s.profiles.update(input);
}
export async function generateAiProposal(s: BackendServices, actor: AuthenticatedActor, input: Record<string, unknown>) {
  requireActor(actor);
  return s.ai.generate(input);
}
export async function acceptAiProposal(s: BackendServices, actor: AuthenticatedActor, proposalId: string) {
  requireActor(actor);
  return s.ai.accept(proposalId);
}
export async function rejectAiProposal(s: BackendServices, actor: AuthenticatedActor, proposalId: string) {
  requireActor(actor);
  return s.ai.reject(proposalId);
}
