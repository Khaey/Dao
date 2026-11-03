import { DomainError } from '../lib/errors.js';
import { PROJECT_KINDS, validateReferentialSnapshot, type BtpReferentialPort, type ProjectKind, type ReferentialSnapshot } from './referential/contract.js';
import { applyDecision, buildProposal, initialState, interpretCommand, type AssistantState, type LastCommand, type Proposal } from './engine.js';
import { fold } from './text.js';

type Result<T> = PromiseLike<{ data: T; error: any }>;
type Query = { select(columns: string): any };
export type AssistantDb = { from(table: string): Query; rpc(name: string, args: Record<string, unknown>): Result<any> };

export type DraftView = {
  draftId: string; revision: number; status: 'draft' | 'created' | 'abandoned'; projectType: ProjectKind;
  title: string; description: string; governorateId: string | null; createdProjectId: string | null; updatedAt: string;
  proposal: Proposal;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS = 'id,revision,status,project_type,title,description,governorate_id,created_project_id,updated_at,proposal';

export class ProjectAssistantService {
  private governorates: Array<{ id: string; name_fr: string }> | null = null;
  constructor(private readonly db: AssistantDb, private readonly referential: BtpReferentialPort) {}

  private async snapshot(): Promise<ReferentialSnapshot> {
    let snapshot: ReferentialSnapshot;
    try { snapshot = await this.referential.snapshot({ countryCode: 'TN' }); }
    catch { throw new DomainError('Le référentiel BTP est indisponible. Aucune proposition ne sera inventée : réessayez plus tard.', 'UNAVAILABLE'); }
    if (!snapshot?.items?.length || validateReferentialSnapshot(snapshot).length) {
      throw new DomainError('Le référentiel BTP est indisponible ou incomplet. Aucune proposition ne sera inventée : réessayez plus tard.', 'UNAVAILABLE');
    }
    return snapshot;
  }

  private async governorateList() {
    if (this.governorates) return this.governorates;
    const { data, error } = await this.db.from('governorates').select('id,name_fr');
    if (error) throw error;
    this.governorates = data ?? [];
    return this.governorates!;
  }
  private async governorateIdByName(name: string | null) {
    if (!name) return null;
    return (await this.governorateList()).find(g => fold(g.name_fr) === fold(name))?.id ?? null;
  }
  private async governorateNameById(id: string) {
    const found = (await this.governorateList()).find(g => g.id === id);
    if (!found) throw new DomainError('Gouvernorat inconnu.', 'BAD_REQUEST');
    return found.name_fr;
  }

  private view(row: any): DraftView {
    return { draftId: row.id, revision: row.revision, status: row.status, projectType: row.project_type, title: row.title,
      description: row.description, governorateId: row.governorate_id, createdProjectId: row.created_project_id,
      updatedAt: row.updated_at, proposal: row.proposal };
  }

  private async load(actorId: string, draftId: string) {
    if (!UUID.test(draftId)) throw new DomainError('Brouillon invalide.', 'BAD_REQUEST');
    const { data, error } = await this.db.from('project_assistant_drafts').select(COLUMNS).eq('id', draftId).eq('owner_id', actorId).maybeSingle();
    if (error) throw error;
    if (!data) throw new DomainError('Brouillon introuvable.', 'NOT_FOUND');
    return data;
  }

  private async save(draftId: string | null, expectedRevision: number | null, kind: 'analyze' | 'edit', command: string | null,
    state: AssistantState, proposal: Proposal, governorateId: string | null, snapshot: ReferentialSnapshot) {
    const { data, error } = await this.db.rpc('save_project_assistant_draft_v1', {
      p_draft_id: draftId, p_expected_revision: expectedRevision, p_kind: kind, p_command: command,
      p_draft: { projectType: state.projectType, description: state.description, title: proposal.title, governorateId,
        proposal, referential: { provider: snapshot.provider, catalogVersion: snapshot.catalogVersion, completeness: snapshot.completeness, contractVersion: snapshot.contractVersion },
        engineMode: proposal.engine.mode },
    });
    if (error) throw error;
    return this.view(data);
  }

  async resume(actorId: string): Promise<DraftView | null> {
    const { data, error } = await this.db.from('project_assistant_drafts').select(COLUMNS).eq('owner_id', actorId).eq('status', 'draft')
      .order('updated_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return data ? this.view(data) : null;
  }

  async analyze(_actorId: string, input: { description: string; projectType: ProjectKind | null; governorateId: string | null }) {
    const snapshot = await this.snapshot();
    let state = initialState(input.description, input.projectType);
    let governorateId: string | null = null;
    if (input.governorateId) {
      state = { ...state, governorateName: await this.governorateNameById(input.governorateId), governorateStatus: 'known' };
      governorateId = input.governorateId;
    } else {
      governorateId = await this.governorateIdByName(state.governorateName);
      if (!governorateId) state = { ...state, governorateName: null, governorateStatus: 'missing' };
    }
    return this.save(null, null, 'analyze', null, state, buildProposal(snapshot, state), governorateId, snapshot);
  }

  async edit(actorId: string, input: { draftId: string; expectedRevision: number; command: string | null; toggle: { itemId: string; selected: boolean } | null;
    projectType: ProjectKind | null; governorateId: string | null; answer: string | null }) {
    const row = await this.load(actorId, input.draftId);
    if (row.status !== 'draft') throw new DomainError('Ce brouillon est clos.', 'CONFLICT');
    const snapshot = await this.snapshot();
    const previous: Proposal = row.proposal;
    let state: AssistantState = {
      projectType: row.project_type, projectTypeStatus: previous.projectTypeStatus ?? 'known', description: row.description,
      governorateName: row.governorate_id ? previous.detectedGovernorate : null,
      governorateStatus: row.governorate_id ? previous.governorateStatus : 'missing', decisions: previous.decisions ?? [],
    };
    let governorateId: string | null = row.governorate_id;
    let lastCommand: LastCommand | null = null;
    const audit: string[] = [];
    if (input.projectType) { state = { ...state, projectType: input.projectType, projectTypeStatus: 'known' }; audit.push(`type:${input.projectType}`); }
    if (input.governorateId) { state = { ...state, governorateName: await this.governorateNameById(input.governorateId), governorateStatus: 'known' }; governorateId = input.governorateId; audit.push('gouvernorat'); }
    if (input.answer) { state = { ...state, description: `${state.description}\n${input.answer}`.slice(0, 4000) }; audit.push(`réponse:${input.answer}`); }
    if (input.toggle) {
      if (!snapshot.items.some(item => item.id === input.toggle!.itemId && item.status === 'published')) throw new DomainError('Élément absent du référentiel.', 'BAD_REQUEST');
      state = { ...state, decisions: applyDecision(state.decisions, { id: input.toggle.itemId, action: input.toggle.selected ? 'add' : 'remove' }, snapshot.items) };
      audit.push(`${input.toggle.selected ? 'coche' : 'décoche'}:${input.toggle.itemId}`);
    }
    if (input.command) {
      const before = state.governorateName;
      const interpreted = interpretCommand(snapshot, state, input.command);
      state = interpreted.state; lastCommand = interpreted.lastCommand;
      if (state.governorateName && state.governorateName !== before) {
        const found = await this.governorateIdByName(state.governorateName);
        if (found) governorateId = found; else state = { ...state, governorateName: before };
      }
      audit.push(input.command);
    }
    if (!audit.length) throw new DomainError('Aucune modification demandée.', 'BAD_REQUEST');
    return this.save(row.id, input.expectedRevision, 'edit', audit.join(' | ').slice(0, 500), state, buildProposal(snapshot, state, lastCommand), governorateId, snapshot);
  }

  async abandon(actorId: string, draftId: string) {
    await this.load(actorId, draftId);
    const { data, error } = await this.db.rpc('abandon_project_assistant_draft_v1', { p_draft_id: draftId });
    if (error) throw error;
    return this.view(data);
  }

  async create(actorId: string, draftId: string, creationKey: string) {
    const row = await this.load(actorId, draftId);
    if (row.status === 'draft') {
      const snapshot = await this.snapshot();
      const known = new Set(snapshot.items.filter(item => item.status === 'published').map(item => item.id));
      const selected = (row.proposal as Proposal).items.filter(item => item.selected);
      if (!selected.some(item => item.kind === 'lot')) throw new DomainError('Gardez au moins un lot avant de créer le chantier.', 'BAD_REQUEST');
      if (selected.some(item => !known.has(item.id))) throw new DomainError('Le référentiel a changé depuis la proposition. Relancez la proposition avant de créer le chantier.', 'CONFLICT');
      if (!row.governorate_id) throw new DomainError('Indiquez le gouvernorat du chantier.', 'BAD_REQUEST');
    }
    const { data, error } = await this.db.rpc('create_project_from_assistant_draft_v1', { p_draft_id: draftId, p_creation_key: creationKey });
    if (error) throw error;
    return data as { projectId: string; created: boolean; lots: number };
  }
}

export const isProjectKind = (value: unknown): value is ProjectKind => typeof value === 'string' && (PROJECT_KINDS as readonly string[]).includes(value);
