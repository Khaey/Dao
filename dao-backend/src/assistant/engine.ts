import type { ProjectKind, ReferentialItem, ReferentialSnapshot, Relevance } from './referential/contract.js';
import { buildKeywordIndex, detectGovernorate, detectProjectKind, extractFacts, findMentions, proposalTitle, usefulQuestion, type Fact } from './understanding.js';
import { clauses, fold, tokens } from './text.js';

export const ASSISTANT_ENGINE = { mode: 'rules' as const, version: 'assistant-rules-1' };

export type Decision = { id: string; action: 'add' | 'remove' };
export type ItemOrigin = 'usual' | 'mentioned' | 'related' | 'client' | 'structure';
export type ProposalItem = {
  id: string; code: string; kind: ReferentialItem['kind']; parentId: string | null; label: string;
  tradeCode: string | null; unit: string | null;
  /** Pertinence pour ce type de projet ; `unusual` si le client l'a voulu hors applicabilité. */
  relevance: Relevance | 'unusual';
  selected: boolean; origin: ItemOrigin | null; tentative: boolean;
  provenance: { source: string; version: string };
};
export type AssistantState = {
  projectType: ProjectKind; projectTypeStatus: 'known' | 'proposed' | 'unknown';
  description: string; governorateName: string | null; governorateStatus: 'known' | 'proposed' | 'missing';
  decisions: Decision[];
};
export type LastCommand = { text: string; applied: Array<{ label: string; action: 'add' | 'remove' }>; notFound: string[]; message: string };
export type Proposal = {
  title: string; summary: string; facts: Fact[]; question: { key: string; text: string } | null;
  items: ProposalItem[]; decisions: Decision[];
  projectTypeStatus: AssistantState['projectTypeStatus']; governorateStatus: AssistantState['governorateStatus'];
  detectedGovernorate: string | null;
  lastCommand: LastCommand | null; limitations: string[];
  referential: { provider: string; catalogVersion: string; completeness: ReferentialSnapshot['completeness']; contractVersion: string };
  engine: typeof ASSISTANT_ENGINE;
};

const LIMITATIONS = [
  'Aucun prix ni budget n’est calculé : aucune base de prix vérifiée n’est disponible.',
  'Aucune quantité ni métré n’est calculé ; les unités affichées préparent seulement les métrés futurs.',
  'Aucune durée ni planning n’est proposé.',
  'La constructibilité et la conformité réglementaire ne sont pas vérifiées par l’assistant.',
];

function relevanceFor(item: ReferentialItem, kind: ProjectKind): Relevance | null {
  return item.applicability.find(a => a.projectKind === kind)?.relevance ?? null;
}

function family(items: ReferentialItem[]) {
  const byId = new Map(items.map(item => [item.id, item]));
  const children = new Map<string, string[]>();
  for (const item of items) if (item.parentId) children.set(item.parentId, [...(children.get(item.parentId) ?? []), item.id]);
  const ancestors = (id: string) => { const out: string[] = []; let current = byId.get(id); while (current?.parentId) { out.push(current.parentId); current = byId.get(current.parentId); } return out; };
  const descendants = (id: string) => { const out: string[] = []; const stack = [...(children.get(id) ?? [])]; while (stack.length) { const next = stack.pop()!; out.push(next); stack.push(...(children.get(next) ?? [])); } return out; };
  return { byId, ancestors, descendants };
}

/** Ajoute une décision client en retirant celles qu'elle contredit (la plus récente gagne). */
export function applyDecision(decisions: Decision[], decision: Decision, items: ReferentialItem[]): Decision[] {
  const { ancestors, descendants } = family(items);
  const conflicts = new Set(decision.action === 'add' ? [decision.id, ...ancestors(decision.id)] : [decision.id, ...descendants(decision.id)]);
  return [...decisions.filter(d => d.id !== decision.id && !(d.action !== decision.action && conflicts.has(d.id))), decision];
}

const STUDY_TOKENS = new Set(tokens('plan plans etude etudes'));

/** Calcule la proposition complète à partir de l'état ; déterministe et sans invention. */
export function buildProposal(snapshot: ReferentialSnapshot, state: AssistantState, lastCommand: LastCommand | null = null): Proposal {
  const items = snapshot.items.filter(item => item.status === 'published');
  const { byId, ancestors, descendants } = family(items);
  const kind = state.projectType;
  const index = buildKeywordIndex(items);
  const mentions = findMentions(state.description, index);

  const origin = new Map<string, ItemOrigin>();
  const tentative = new Set<string>();
  const excluded = new Set<string>();
  for (const item of items) {
    const relevance = relevanceFor(item, kind);
    if (relevance === 'usual' || relevance === 'verify') origin.set(item.id, 'usual');
  }
  for (const mention of mentions) {
    // « sans plans / pas d'études » décrit un état (études à prévoir), pas un retrait du périmètre.
    const aboutStudies = tokens(mention.phrase).some(token => STUDY_TOKENS.has(token));
    if (mention.negative && !aboutStudies) {
      for (const id of mention.ids) { excluded.add(id); for (const child of descendants(id)) excluded.add(child); }
      continue;
    }
    if (mention.negative) continue;
    for (const id of mention.ids) {
      origin.set(id, 'mentioned');
      if (mention.tentative) tentative.add(id);
      for (const related of byId.get(id)?.relatedIds ?? []) {
        if (!origin.has(related) && relevanceFor(byId.get(related)!, kind)) origin.set(related, 'related');
      }
    }
  }
  for (const id of excluded) origin.delete(id);
  for (const decision of state.decisions) {
    if (!byId.has(decision.id)) continue;
    if (decision.action === 'add') { origin.set(decision.id, 'client'); tentative.delete(decision.id); }
    else for (const id of [decision.id, ...descendants(decision.id)]) origin.delete(id);
  }
  const removedByClient = new Set(state.decisions.filter(d => d.action === 'remove').flatMap(d => [d.id, ...descendants(d.id)]));
  const blocked = new Set([...excluded, ...removedByClient]);
  for (const decision of state.decisions) if (decision.action === 'add') blocked.delete(decision.id);
  for (const id of [...origin.keys()]) {
    const chain = ancestors(id);
    if (chain.some(parent => blocked.has(parent) && !state.decisions.some(d => d.action === 'add' && d.id === id))) { origin.delete(id); continue; }
    for (const parent of chain) if (!origin.has(parent)) origin.set(parent, 'structure');
  }

  const proposalItems: ProposalItem[] = [];
  for (const item of items) {
    const relevance = relevanceFor(item, kind);
    const selected = origin.has(item.id);
    if (!relevance && !selected) continue;
    proposalItems.push({
      id: item.id, code: item.code, kind: item.kind, parentId: item.parentId, label: item.label,
      tradeCode: item.tradeCode, unit: item.unit, relevance: relevance ?? 'unusual', selected,
      origin: origin.get(item.id) ?? null, tentative: selected && tentative.has(item.id),
      provenance: { source: item.provenance.source, version: item.provenance.version },
    });
  }

  const facts = extractFacts(state.description);
  facts.unshift({ key: 'project_type', label: 'Type de projet', value: { construction: 'Construction neuve', renovation: 'Rénovation', extension: 'Extension', other: 'À préciser' }[kind], status: state.projectTypeStatus === 'unknown' ? 'to_confirm' : state.projectTypeStatus });
  if (state.governorateName) facts.splice(1, 0, { key: 'governorate', label: 'Gouvernorat', value: state.governorateName, status: state.governorateStatus === 'known' ? 'known' : 'proposed' });
  const exclusions = items.filter(item => excluded.has(item.id) && !(item.parentId && excluded.has(item.parentId)) && !origin.has(item.id)).map(item => item.label);
  if (exclusions.length) facts.push({ key: 'exclusions', label: 'Exclu par vous', value: [...new Set(exclusions)].slice(0, 8).join(', '), status: 'known' });

  const positiveMentions = mentions.filter(m => !m.negative).length;
  const question = usefulQuestion(kind, state.projectTypeStatus !== 'unknown', state.description, positiveMentions);
  const selectedLots = proposalItems.filter(i => i.selected && i.kind === 'lot').length;
  const selectedWorks = proposalItems.filter(i => i.selected && i.kind === 'work').length;
  const toCheck = proposalItems.filter(i => i.selected && (i.relevance === 'verify' || i.relevance === 'unusual' || i.tentative)).length;
  const title = proposalTitle(state.description, kind, state.governorateName);
  const summary = selectedLots
    ? `${title} : ${selectedLots} lot${selectedLots > 1 ? 's' : ''} et ${selectedWorks} ouvrage${selectedWorks > 1 ? 's' : ''} proposés à partir du référentiel${toCheck ? `, dont ${toCheck} à vérifier` : ''}.`
    : `${title} : aucun lot n’a pu être proposé à partir de votre description. Ajoutez des lots ou précisez les travaux.`;

  return {
    title, summary, facts, question, items: proposalItems, decisions: state.decisions,
    projectTypeStatus: state.projectTypeStatus, governorateStatus: state.governorateStatus,
    detectedGovernorate: state.governorateName,
    lastCommand,
    limitations: snapshot.completeness === 'fixture'
      ? [...LIMITATIONS, 'Le référentiel utilisé est provisoire (données de démonstration) en attendant le référentiel BTP officiel.']
      : snapshot.completeness === 'partial' ? [...LIMITATIONS, 'Le référentiel BTP est encore incomplet : certains travaux peuvent manquer, ajoutez-les avec les professionnels.'] : LIMITATIONS,
    referential: { provider: snapshot.provider, catalogVersion: snapshot.catalogVersion, completeness: snapshot.completeness, contractVersion: snapshot.contractVersion },
    engine: ASSISTANT_ENGINE,
  };
}

/** État initial à partir d'une description libre et d'un type éventuellement choisi. */
export function initialState(description: string, chosenType: ProjectKind | null): AssistantState {
  const detected = detectProjectKind(description);
  const governorate = detectGovernorate(description);
  return {
    projectType: chosenType ?? detected ?? 'other',
    projectTypeStatus: chosenType ? 'known' : detected ? 'proposed' : 'unknown',
    description, governorateName: governorate?.name ?? null,
    governorateStatus: governorate ? (fold(governorate.via) === fold(governorate.name) ? 'known' : 'proposed') : 'missing',
    decisions: [],
  };
}

const TYPE_COMMANDS: Array<[ProjectKind, RegExp]> = [
  ['renovation', /\b(c est|plutot|en fait)\b.*\brenovation\b/],
  ['extension', /\b(c est|plutot|en fait)\b.*\bextension\b/],
  ['construction', /\b(c est|plutot|en fait)\b.*\bconstruction\b/],
];

/**
 * Interprète une correction en langage naturel (« ajoute une terrasse, retire le garage »).
 * Seuls des éléments existants du référentiel peuvent être ajoutés ; rien n'est inventé.
 */
export function interpretCommand(snapshot: ReferentialSnapshot, state: AssistantState, command: string): { state: AssistantState; lastCommand: LastCommand } {
  const items = snapshot.items.filter(item => item.status === 'published');
  const index = buildKeywordIndex(items);
  const { byId } = family(items);
  let next: AssistantState = { ...state, decisions: [...state.decisions] };
  const applied: LastCommand['applied'] = [];
  const notFound: string[] = [];
  const folded = fold(command);
  for (const [kind, pattern] of TYPE_COMMANDS) if (pattern.test(folded)) { next = { ...next, projectType: kind, projectTypeStatus: 'known' }; break; }
  const governorate = detectGovernorate(command);
  if (governorate) next = { ...next, governorateName: governorate.name, governorateStatus: 'known' };

  let intent: 'add' | 'remove' = 'add';
  for (const clause of clauses(command)) {
    const words = tokens(clause);
    const mentions = findMentions(clause, index, false);
    const verbRemove = /\b(retir\w*|supprim\w*|enlev\w*|sans|pas de|pas d|exclu\w*|oubli\w*|aucun\w*)\b/.test(clause);
    const verbAdd = /\b(ajout\w*|rajout\w*|avec|inclu\w*|mets|mettre|mettez|prevo\w*|gard\w*|remet\w*|veux|voudrais|souhait\w*|aussi)\b/.test(clause);
    if (verbRemove) intent = 'remove'; else if (verbAdd) intent = 'add';
    if (!mentions.length) {
      const meaningful = words.filter(word => word.length > 2 && !/^(ajout|rajout|retir|supprim|enlev|avec|sans|aussi|mets|mettre|une|des|les|pour|plu|c est|veux)/.test(word));
      if (meaningful.length && !governorate && !TYPE_COMMANDS.some(([, p]) => p.test(clause))) notFound.push(clause.slice(0, 80));
      continue;
    }
    for (const mention of mentions) {
      const candidates = mention.ids.map(id => byId.get(id)!).filter(Boolean);
      // Ajout : l'élément le plus précis (ouvrage) ; retrait : le plus large (lot entier si cité).
      const depth = (item: ReferentialItem) => item.kind === 'lot' ? 0 : item.kind === 'sub_lot' ? 1 : 2;
      const sorted = candidates.sort((a, b) => intent === 'add' ? depth(b) - depth(a) : depth(a) - depth(b));
      const chosen = sorted.filter(item => depth(item) === depth(sorted[0]));
      for (const item of chosen) {
        next.decisions = applyDecision(next.decisions, { id: item.id, action: intent }, items);
        applied.push({ label: item.label, action: intent });
      }
    }
  }
  const message = applied.length
    ? `Proposition mise à jour sans perdre vos choix précédents : ${applied.map(a => `${a.action === 'add' ? 'ajout' : 'retrait'} de « ${a.label} »`).join(', ')}.`
    : next.projectType !== state.projectType || next.governorateName !== state.governorateName
      ? 'Proposition mise à jour.'
      : 'Je n’ai reconnu aucun lot ni ouvrage du référentiel dans votre demande. Rien n’a été inventé : reformulez ou cochez les éléments dans la liste.';
  return { state: next, lastCommand: { text: command.slice(0, 500), applied, notFound, message } };
}
