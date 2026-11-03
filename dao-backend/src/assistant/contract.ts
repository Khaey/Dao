export type ProjectType = 'construction' | 'renovation' | 'extension' | 'other';
export type Relevance = 'usual' | 'conditional' | 'optional' | 'verify';
export type ItemKind = 'lot' | 'sub_lot' | 'work';

export type CatalogItem = {
  id: string;
  code: string;
  parent_id: string | null;
  item_kind: ItemKind;
  trade_id: string | null;
  label_fr: string;
  description_fr: string;
  unit_code: string | null;
  relevance: Relevance;
  project_types: ProjectType[];
  aliases: string[];
  source: { label: string; version?: string; verified_on?: string; scope?: string };
};

export type ExtractedFact = {
  key: string;
  label: string;
  value: string;
  confidence: 'known' | 'proposed' | 'to_confirm';
};

export type ProposalItem = Pick<CatalogItem, 'id' | 'code' | 'parent_id' | 'item_kind' | 'label_fr' | 'relevance' | 'source'> & {
  selected: boolean;
};

export type AssistantProposal = {
  draftId: string;
  revision: number;
  projectType: ProjectType;
  title: string;
  summary: string;
  facts: ExtractedFact[];
  items: ProposalItem[];
  question: string | null;
  engineMode: 'deterministic' | 'llm_validated';
  limitations: string[];
  governorateId: string | null;
};

export type AssistantDraftInput = {
  draft_id?: unknown;
  project_type?: unknown;
  description?: unknown;
  governorate_id?: unknown;
  command?: unknown;
};
