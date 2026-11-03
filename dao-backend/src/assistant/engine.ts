import { DomainError } from '../lib/errors.js';
import type { AssistantDraftInput, CatalogItem, ExtractedFact, ProjectType } from './contract.js';

const strip = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const clean = (value: unknown, max = 8000) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const has = (text: string, expression: RegExp) => expression.test(strip(text));

export function parseInput(input: AssistantDraftInput) {
  const description = clean(input.description);
  const command = clean(input.command, 500);
  const projectType = clean(input.project_type) as ProjectType;
  if (!['construction', 'renovation', 'extension', 'other'].includes(projectType)) {
    throw new DomainError('Choisissez le type de projet.', 'BAD_REQUEST');
  }
  if (!description && !command) throw new DomainError('Décrivez votre projet en quelques mots.', 'BAD_REQUEST');
  if (description && description.length < 3) throw new DomainError('La description est trop courte.', 'BAD_REQUEST');
  return { description, command, projectType, governorateId: clean(input.governorate_id, 80) || null };
}

function baseSelected(item: CatalogItem, projectType: ProjectType) {
  if (!item.project_types.includes(projectType)) return false;
  if (projectType === 'construction') return item.relevance === 'usual' || item.code === 'btp_lot_studies';
  if (projectType === 'renovation') return ['btp_lot_plumbing','btp_lot_electrical','btp_lot_finishes','btp_sub_sanitary','btp_sub_electrical_installation','btp_sub_floor_wall_finishes','btp_work_water_network','btp_work_electrical_network','btp_work_painting'].includes(item.code);
  if (projectType === 'extension') return item.relevance === 'usual' || ['btp_lot_studies','btp_lot_demolition','btp_sub_existing_interface','btp_work_selective_demolition'].includes(item.code);
  return false;
}

function mentions(item: CatalogItem, text: string) {
  const normalized = strip(text);
  return [item.label_fr, ...item.aliases].some(alias => normalized.includes(strip(alias)));
}

function ancestors(id: string, byId: Map<string,CatalogItem>) {
  const result: string[] = []; let current = byId.get(id);
  while (current?.parent_id) { result.push(current.parent_id); current = byId.get(current.parent_id); }
  return result;
}

function descendants(id: string, items: CatalogItem[]) {
  const result = new Set<string>(); let changed = true;
  while (changed) { changed = false; for (const item of items) if (item.parent_id && (item.parent_id === id || result.has(item.parent_id)) && !result.has(item.id)) { result.add(item.id); changed = true; } }
  return result;
}

export function selectCatalog(items: CatalogItem[], projectType: ProjectType, description: string, previous: string[] = [], removed: string[] = [], command = '') {
  const byId = new Map(items.map(item => [item.id,item]));
  const selected = new Set(previous.length ? previous : items.filter(item => baseSelected(item, projectType)).map(item => item.id));
  const explicitlyRemoved = new Set(removed);
  const source = `${description} ${command}`;

  for (const item of items) if (mentions(item, source)) selected.add(item.id);
  if (has(source,/\b(villa|maison|r\+\d|construction neuve)\b/)) {
    for (const item of items) if (item.project_types.includes('construction') && item.relevance === 'usual') selected.add(item.id);
  }
  if (has(source,/\bcuisine\b/)) for (const item of items) if (item.code.startsWith('btp_lot_kitchen') || item.code.startsWith('btp_sub_kitchen') || item.code.startsWith('btp_work_kitchen')) selected.add(item.id);
  if (has(source,/\b(terrasse|jardin|garage|piscine)\b/)) for (const item of items) if (mentions(item, source)) selected.add(item.id);

  const negativeText = strip(source);
  for (const item of items) {
    const aliases = [item.label_fr,...item.aliases].map(strip);
    const negated = aliases.some(alias => negativeText.includes(`sans ${alias}`) || negativeText.includes(`retire ${alias}`) || negativeText.includes(`retirer ${alias}`) || negativeText.includes(`supprime ${alias}`));
    if (negated) { explicitlyRemoved.add(item.id); selected.delete(item.id); for (const child of descendants(item.id,items)) { explicitlyRemoved.add(child); selected.delete(child); } }
  }

  for (const id of [...selected]) for (const parent of ancestors(id,byId)) if (!explicitlyRemoved.has(parent)) selected.add(parent);
  for (const id of explicitlyRemoved) selected.delete(id);
  return { selected: [...selected], removed: [...explicitlyRemoved] };
}

export function extractFacts(description: string, projectType: ProjectType): ExtractedFact[] {
  const facts: ExtractedFact[] = [{ key:'project_type',label:'Type de projet',value:({construction:'Construction',renovation:'Rénovation',extension:'Extension',other:'Autre'})[projectType],confidence:'known' }];
  const total = description.match(/(\d{2,4})\s*m(?:2|²)/i);
  if (total) facts.push({key:'surface',label:'Surface mentionnée',value:`${total[1]} m² (usage exact à confirmer)`,confidence:'to_confirm'});
  const floors = description.match(/\b(r\s*\+\s*\d+)\b/i);
  if (floors) facts.push({key:'levels',label:'Configuration',value:floors[1].replace(/\s/g,'').toUpperCase(),confidence:'known'});
  const city = description.match(/\b(sousse|tunis|sfax|nabeul|monastir|ariana|ben arous|bizerte)\b/i);
  if (city) facts.push({key:'location',label:'Région mentionnée',value:city[1],confidence:'known'});
  if (has(description,/\b(plans? (?:et )?etudes? (?:pas|non)|sans plans?|plans? absents?)\b/)) facts.push({key:'studies',label:'Plans et études',value:'Non réalisés',confidence:'known'});
  if (has(description,/\bbudget (?:inconnu|non defini|a definir)\b/)) facts.push({key:'budget',label:'Budget',value:'Non défini',confidence:'known'});
  return facts;
}

export function proposalTitle(description: string, projectType: ProjectType) {
  const city = description.match(/\b(Sousse|Tunis|Sfax|Nabeul|Monastir|Ariana|Ben Arous|Bizerte)\b/i)?.[1];
  const noun = has(description,/\bvilla\b/) ? 'Villa' : has(description,/\bappartement\b/) ? 'Appartement' : 'Chantier';
  return `${({construction:'Construction',renovation:'Rénovation',extension:'Extension',other:'Projet'})[projectType]} ${noun}${city ? ` à ${city}` : ''}`.slice(0,200);
}

export function usefulQuestion(description: string, projectType: ProjectType, governorateId: string | null) {
  if (!governorateId && !has(description,/\b(sousse|tunis|sfax|nabeul|monastir|ariana|ben arous|bizerte)\b/)) return 'Dans quel gouvernorat se situe le chantier ?';
  if (projectType === 'other') return 'S’agit-il surtout d’une construction, d’une rénovation ou d’une extension ?';
  if (description.length < 35) return 'Quelles sont les pièces ou zones principalement concernées ?';
  return null;
}
