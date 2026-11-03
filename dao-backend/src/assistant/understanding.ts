import type { ProjectKind, ReferentialItem } from './referential/contract.js';
import { ADDERS, clauses, fold, NEGATORS, TENTATIVE, tokens } from './text.js';

export type FactStatus = 'known' | 'proposed' | 'to_confirm';
export type Fact = { key: string; label: string; value: string; status: FactStatus };
export type Mention = { ids: string[]; negative: boolean; tentative: boolean; phrase: string };

type KeywordIndex = Array<{ tokens: string[]; ids: string[]; phrase: string }>;

/** Index des mots-clés du référentiel, du plus long au plus court (le plus spécifique gagne). */
export function buildKeywordIndex(items: ReferentialItem[]): KeywordIndex {
  const map = new Map<string, { tokens: string[]; ids: Set<string>; phrase: string }>();
  for (const item of items) {
    if (item.status !== 'published') continue;
    for (const phrase of [item.label, ...item.keywords]) {
      const parts = tokens(phrase);
      if (!parts.length) continue;
      const key = parts.join(' ');
      const entry = map.get(key) ?? { tokens: parts, ids: new Set<string>(), phrase };
      entry.ids.add(item.id); map.set(key, entry);
    }
  }
  return [...map.values()].map(entry => ({ tokens: entry.tokens, ids: [...entry.ids], phrase: entry.phrase }))
    .sort((a, b) => b.tokens.length - a.tokens.length || a.tokens.join(' ').localeCompare(b.tokens.join(' ')));
}

/** Repère les éléments du référentiel cités dans un texte, avec leur polarité. */
export function findMentions(text: string, index: KeywordIndex, defaultNegative = false): Mention[] {
  const result: Mention[] = [];
  for (const clause of clauses(text)) {
    const words = tokens(clause);
    const used = new Array(words.length).fill(false);
    const tentative = TENTATIVE.test(clause);
    for (const entry of index) {
      const n = entry.tokens.length;
      for (let i = 0; i + n <= words.length; i++) {
        if (used.slice(i, i + n).some(Boolean)) continue;
        if (!entry.tokens.every((token, offset) => words[i + offset] === token)) continue;
        for (let k = i; k < i + n; k++) used[k] = true;
        const before = words.slice(Math.max(0, i - 4), i);
        const negated = before.some(word => NEGATORS.has(word));
        const added = before.some(word => ADDERS.has(word));
        result.push({ ids: entry.ids, negative: negated || (defaultNegative && !added), tentative, phrase: entry.phrase });
      }
    }
  }
  return result;
}

const KIND_PATTERNS: Array<[ProjectKind, RegExp]> = [
  ['extension', /\b(extension|agrandi\w*|surelev\w*|ajouter (?:une|un|des) (?:chambre|piece|etage|niveau)|etage supplementaire|rajouter un etage)\b/],
  ['renovation', /\b(renov\w*|refaire|refection|rafraichi\w*|remise a neuf|reamenag\w*|transformer|moderniser)\b/],
  ['construction', /\b(constru\w*|batir|villa|maison neuve|immeuble|terrain|r\s*\+\s*\d|neuve?)\b/],
];

export function detectProjectKind(description: string): ProjectKind | null {
  const text = fold(description);
  for (const [kind, pattern] of KIND_PATTERNS) if (pattern.test(text)) return kind;
  return null;
}

export const GOVERNORATES = ['Ariana', 'Béja', 'Ben Arous', 'Bizerte', 'Gabès', 'Gafsa', 'Jendouba', 'Kairouan', 'Kasserine', 'Kébili', 'Le Kef', 'Mahdia', 'La Manouba', 'Médenine', 'Monastir', 'Nabeul', 'Sfax', 'Sidi Bouzid', 'Siliana', 'Sousse', 'Tataouine', 'Tozeur', 'Tunis', 'Zaghouan'];
const CITY_TO_GOVERNORATE: Record<string, string> = {
  sahloul: 'Sousse', 'hammam sousse': 'Sousse', kantaoui: 'Sousse', 'msaken': 'Sousse', 'akouda': 'Sousse',
  hammamet: 'Nabeul', kelibia: 'Nabeul', 'korba': 'Nabeul', 'la marsa': 'Tunis', marsa: 'Tunis', carthage: 'Tunis', 'le bardo': 'Tunis',
  djerba: 'Médenine', zarzis: 'Médenine', 'el menzah': 'Ariana', 'ennasr': 'Ariana', 'la soukra': 'Ariana', 'rades': 'Ben Arous', 'ezzahra': 'Ben Arous',
  'manouba': 'La Manouba', 'kef': 'Le Kef',
};

export function detectGovernorate(description: string): { name: string; via: string } | null {
  const text = ` ${fold(description).replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  for (const name of GOVERNORATES) if (text.includes(` ${fold(name)} `)) return { name, via: name };
  for (const [city, name] of Object.entries(CITY_TO_GOVERNORATE)) if (text.includes(` ${city} `)) return { name, via: city };
  return null;
}

const NUMBER_WORDS: Record<string, string> = { un: '1', une: '1', deux: '2', trois: '3', quatre: '4', cinq: '5', six: '6' };
const num = (value: string) => NUMBER_WORDS[value] ?? value;

/** Extrait seulement ce que le client a écrit ; n'invente aucune valeur. */
export function extractFacts(description: string): Fact[] {
  const text = fold(description).replace(/m²/g, 'm2').replace(/\s+/g, ' ');
  const facts: Fact[] = [];
  const push = (key: string, label: string, value: string, status: FactStatus) => { if (!facts.some(f => f.key === key)) facts.push({ key, label, value, status }); };
  const surfaces = [...text.matchAll(/(\d{1,5}(?:[.,]\d{1,2})?)\s*m2\b/g)];
  for (const match of surfaces) {
    const before = text.slice(Math.max(0, match.index! - 30), match.index!);
    const after = text.slice(match.index! + match[0].length, match.index! + match[0].length + 20);
    const last = (pattern: RegExp) => { let at = -1; for (const hit of before.matchAll(pattern)) at = hit.index!; return at; };
    const land = Math.max(last(/terrain|parcelle/g), /^\s*(?:de\s+)?(?:terrain|parcelle)/.test(after) ? 99 : -1);
    const built = Math.max(last(/constru|bati|habitable|couvert|plancher|total/g), /^\s*(?:constru|bati|habitable|couvert)/.test(after) ? 99 : -1);
    if (land >= 0 && land > built) push('land_area', 'Surface du terrain', `${match[1]} m²`, 'known');
    else if (built >= 0) push('built_area', 'Surface construite indiquée', `${match[1]} m² (répartition par niveau non calculée)`, 'known');
    else push(`area_${match[1]}`, 'Surface mentionnée', `${match[1]} m² (à quoi correspond-elle ?)`, 'to_confirm');
  }
  const levels = text.match(/\br\s*\+\s*(\d)\b/);
  if (levels) push('levels', 'Niveaux', `R+${levels[1]}`, 'known');
  else if (/plain[- ]pied/.test(text)) push('levels', 'Niveaux', 'Plain-pied', 'known');
  const bedrooms = text.match(/\b(\d|un|une|deux|trois|quatre|cinq|six)\s+chambres?\b/);
  if (bedrooms) push('bedrooms', 'Chambres', num(bedrooms[1]), 'known');
  const bathrooms = text.match(/\b(\d|un|une|deux|trois|quatre)\s+(?:salles? de bains?|salles? d.eau|sdb)\b/);
  if (bathrooms) push('bathrooms', 'Salles de bain', num(bathrooms[1]), 'known');
  const rooms = [['salon', 'salon'], ['salle a manger', 'salle à manger'], ['bureau', 'bureau'], ['cuisine separee', 'cuisine séparée'], ['cuisine ouverte', 'cuisine ouverte'], ['suite parentale', 'suite parentale'], ['buanderie', 'buanderie'], ['dressing', 'dressing']]
    .filter(([needle]) => text.includes(needle)).map(([, label]) => label);
  if (rooms.length) push('rooms', 'Pièces mentionnées', rooms.join(', '), 'known');
  const garage = text.match(/garage(?:\s+(?:pour\s+)?(\d|une|deux)\s+voitures?)?/);
  if (garage && !/sans garage|pas de garage/.test(text)) push('garage', 'Garage', garage[1] ? `${num(garage[1])} voiture(s)` : 'Mentionné', 'known');
  const finish = text.match(/\b(haut standing|standing|finition\s+(?:standard|moyenne|economique|luxe|haut de gamme))\b/);
  if (finish) push('finish', 'Niveau de finition', finish[1].replace('finition ', ''), 'known');
  const style = text.match(/\b(traditionnel(?:le)?(?: tunisien(?:ne)?)?|moderne|contemporain(?:e)?)\b/);
  if (style) push('style', 'Style', style[1], 'known');
  if (/budget\s+(?:inconnu|non defini|a definir|pas defini)|pas (?:encore )?de budget|sans budget/.test(text)) push('budget', 'Budget', 'Non défini — aucun montant ne sera estimé', 'known');
  else { const budget = text.match(/budget\D{0,15}(\d[\d\s.,]{2,})\s*(mille|k|dt|tnd|dinars?)?/); if (budget) push('budget', 'Budget indiqué par vous', `${budget[1].trim()} ${budget[2] ?? ''}`.trim() + ' (repris tel quel, non vérifié)', 'known'); }
  if (/(?:pas|sans|aucun)\s+(?:de\s+|d\s*)?(?:plans?|etudes?)|plans?(?:\s*(?:\/|et|ni)\s*etudes?)?\s+(?:absents?|non (?:faits?|realises?)|pas (?:faits?|encore))|etudes?\s+absentes?/.test(text)) push('studies', 'Plans et études', 'Non réalisés — à prévoir', 'known');
  else if (/(?:j ai|j'ai|nous avons|deja)\s+(?:les\s+)?plans|plans?\s+(?:prets?|disponibles?)|permis\s+(?:obtenu|accorde)/.test(text)) push('studies', 'Plans et études', 'Disponibles selon vous', 'known');
  return facts;
}

/** Une seule question, et seulement si elle débloque la proposition. */
export function usefulQuestion(projectKind: ProjectKind, kindKnown: boolean, description: string, mentionCount: number): { key: string; text: string } | null {
  if (!kindKnown && projectKind === 'other') return { key: 'project_type', text: 'S’agit-il d’une construction neuve, d’une rénovation ou d’une extension ?' };
  const wordCount = tokens(description).length;
  if (mentionCount === 0 && wordCount < 12) {
    if (projectKind === 'extension') return { key: 'scope', text: 'Que souhaitez-vous ajouter : une pièce, un étage, une annexe ?' };
    return { key: 'scope', text: 'Quelles pièces ou parties sont concernées par les travaux ?' };
  }
  return null;
}

export function proposalTitle(description: string, projectKind: ProjectKind, governorate: string | null) {
  const text = fold(description);
  const noun = /\bvilla\b/.test(text) ? 'd’une villa' : /\bappartement\b/.test(text) ? 'd’un appartement' : /\bmaison\b/.test(text) ? 'd’une maison' : /\b(local|commerce|boutique)\b/.test(text) ? 'd’un local' : /\bimmeuble\b/.test(text) ? 'd’un immeuble' : '';
  const verb = { construction: 'Construction', renovation: 'Rénovation', extension: 'Extension', other: 'Travaux' }[projectKind];
  return `${verb}${noun ? ` ${noun}` : ''}${governorate ? ` à ${governorate}` : ''}`.slice(0, 200);
}
