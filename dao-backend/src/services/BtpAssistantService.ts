import { DomainError } from '../lib/errors.js';
import { extractFacts, parseInput, proposalTitle, selectCatalog, usefulQuestion } from '../assistant/engine.js';
import type { AssistantDraftInput, AssistantProposal, CatalogItem } from '../assistant/contract.js';

const projection = 'id,code,parent_id,item_kind,trade_id,label_fr,description_fr,unit_code,relevance,project_types,aliases,source';

export class BtpAssistantService {
  constructor(private readonly db: any) {}

  async analyze(actorId: string, input: AssistantDraftInput): Promise<AssistantProposal> {
    const parsed = parseInput(input);
    const draftId = typeof input.draft_id === 'string' ? input.draft_id : '';
    let previous: any = null;
    if (draftId) {
      const result = await this.db.from('btp_assistant_drafts').select('*').eq('id',draftId).maybeSingle();
      if (result.error) throw result.error; previous = result.data;
      if (!previous) throw new DomainError('Brouillon assistant introuvable.', 'NOT_FOUND');
    }
    const catalogResult = await this.db.from('btp_catalog_items').select(projection).eq('active',true).order('code');
    if (catalogResult.error) throw catalogResult.error;
    const catalog = (catalogResult.data ?? []) as CatalogItem[];
    if (!catalog.length) throw new DomainError('Le référentiel BTP est indisponible. Aucune suggestion libre ne sera fabriquée.', 'NOT_FOUND');
    const description = parsed.description || previous?.source_description || '';
    const projectType = parsed.projectType || previous?.project_type;
    const selection = selectCatalog(catalog,projectType,description,previous?.selected_item_ids,previous?.removed_item_ids,parsed.command);
    const governorateId = parsed.governorateId ?? previous?.governorate_id ?? null;
    const title = proposalTitle(description,projectType);
    const question = usefulQuestion(description,projectType,governorateId);
    const structured = { facts:extractFacts(description,projectType), summary:description.slice(0,1000), limitations:['Aucun prix disponible sans source tarifaire vérifiée.','Aucun métré ni délai calculé sans données techniques suffisantes.','La constructibilité et la conformité réglementaire restent à vérifier.'] };
    const payload = { owner_id:actorId,project_type:projectType,source_description:description,title,governorate_id:governorateId,structured,
      selected_item_ids:selection.selected,removed_item_ids:selection.removed,question,engine_mode:'deterministic',revision:(previous?.revision ?? 0)+1,updated_at:new Date().toISOString() };
    const saved = previous
      ? await this.db.from('btp_assistant_drafts').update(payload).eq('id',previous.id).select('*').single()
      : await this.db.from('btp_assistant_drafts').insert(payload).select('*').single();
    if (saved.error) throw saved.error;
    const selected = new Set(selection.selected);
    return { draftId:saved.data.id,revision:saved.data.revision,projectType,title,summary:description,facts:structured.facts,
      items:catalog.filter(item=>selected.has(item.id)).map(item=>({...item,selected:true})),question,engineMode:'deterministic',limitations:structured.limitations,governorateId };
  }

  async resume() {
    const result = await this.db.from('btp_assistant_drafts').select('*').is('created_project_id',null).order('updated_at',{ascending:false}).limit(1).maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) return null;
    const catalogResult = await this.db.from('btp_catalog_items').select(projection).in('id',result.data.selected_item_ids ?? []).order('code');
    if (catalogResult.error) throw catalogResult.error;
    return { draftId:result.data.id,revision:result.data.revision,projectType:result.data.project_type,title:result.data.title,
      summary:result.data.source_description,facts:result.data.structured?.facts ?? [],items:(catalogResult.data ?? []).map((item:any)=>({...item,selected:true})),
      question:result.data.question,engineMode:result.data.engine_mode,limitations:result.data.structured?.limitations ?? [],governorateId:result.data.governorate_id };
  }

  async create(draftId: string, creationKey: string) {
    if (!draftId || !creationKey) throw new DomainError('Brouillon et clé de création requis.', 'BAD_REQUEST');
    const result = await this.db.rpc('create_project_from_btp_assistant',{p_draft_id:draftId,p_creation_key:creationKey});
    if (result.error) throw result.error;
    return { project_id:result.data };
  }
}
