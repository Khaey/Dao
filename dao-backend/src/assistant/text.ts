/** Normalisation de texte déterministe (français, Unicode conservé pour l'arabe). */
const KEEP = new Set(['sans', 'pas', 'plus', 'gros', 'sous', 'dans', 'vers', 'tres', 'apres', 'puis', 'fois', 'mais', 'avec', 'chez', 'deux', 'trois']);

export function stem(token: string) {
  let value = token;
  if (KEEP.has(value)) return value;
  if (value.length > 3 && /[sx]$/.test(value)) value = value.slice(0, -1);
  if (value.length > 5 && value.endsWith('e')) value = value.slice(0, -1);
  return value;
}

export function fold(text: string) {
  return text.toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function tokens(text: string): string[] {
  return fold(text).replace(/[’'`]/g, ' ').split(/[^\p{L}\p{N}+]+/u).filter(Boolean).map(stem);
}

/** Découpe en propositions : ponctuation et coordinations. */
export function clauses(text: string): string[] {
  return fold(text).split(/[.,;:!?\n()]+|\s(?:et|mais|puis|ou|ainsi que)\s/).map(part => part.trim()).filter(Boolean);
}

export const NEGATORS = new Set(['sans', 'pas', 'retire', 'retirer', 'retirez', 'supprime', 'supprimer', 'supprimez', 'enleve', 'enlever', 'enlevez', 'aucun', 'aucune', 'ni', 'non', 'oublie', 'oublier', 'oubliez', 'exclure', 'exclus', 'exclu'].map(stem));
export const ADDERS = new Set(['ajoute', 'ajouter', 'ajoutez', 'ajout', 'rajoute', 'rajouter', 'rajoutez', 'avec', 'inclure', 'inclus', 'mets', 'mettre', 'mettez', 'prevoir', 'prevois', 'prevoyez', 'garde', 'garder', 'gardez', 'remets', 'remettre', 'remettez', 'veux', 'voudrais', 'souhaite', 'aussi'].map(stem));
export const TENTATIVE = /\b(si possible|eventuellement|peut etre|a voir|optionnel|en option)\b/;
