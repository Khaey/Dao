// #560 — Présentation du parcours métrés (Client / Gestionnaire), sans aucun calcul de quantité.
// Le calcul reste celui du moteur #548 (TypeScript + revérification PostgreSQL). Ce module ne fait
// que : libeller les champs à partir des métadonnées du modèle publié, proposer les unités
// compatibles, contrôler la forme de la saisie et rendre la formule lisible. Aucune valeur par
// défaut, aucune quantité, aucun prix. Module pur (aucune dépendance) : importable côté navigateur.

export type TakeoffDimension = 'm' | 'm2' | 'm3' | 'unit';
export type TakeoffSourceKind = 'manual' | 'document' | 'survey' | 'bim_import';
export type TakeoffSchema = { required?: string[]; properties?: Record<string, { type?: string; minimum?: number; title?: string; description?: string }> };
export type TakeoffDraftField = { value: string; unit: string; kind: TakeoffSourceKind | ''; reference: string };

/** Même règle que `expectedInputUnit` du moteur #548 (vérifié par test), sans exception. */
export function dimensionOf(field: string): TakeoffDimension | null {
  if (field.endsWith('_m3')) return 'm3';
  if (field.endsWith('_m2')) return 'm2';
  if (field.endsWith('_m')) return 'm';
  if (field.endsWith('_count')) return 'unit';
  return null;
}

/** Unités de saisie acceptées par le moteur #548 pour chaque dimension (conversions exactes V1). */
export const INPUT_UNITS: Record<TakeoffDimension, string[]> = {
  m: ['m', 'cm', 'mm'],
  m2: ['m2', 'cm2', 'mm2'],
  m3: ['m3', 'l', 'cm3'],
  unit: ['unit'],
};
export const UNIT_SYMBOLS: Record<string, string> = { m: 'm', cm: 'cm', mm: 'mm', m2: 'm²', cm2: 'cm²', mm2: 'mm²', m3: 'm³', l: 'L', cm3: 'cm³', unit: 'u' };

export const SOURCE_KINDS: Array<{ kind: TakeoffSourceKind; label: string; hint: string }> = [
  { kind: 'manual', label: 'Mesure manuelle', hint: 'Ex. mesuré au mètre le 03/11' },
  { kind: 'document', label: 'Plan ou document', hint: 'Ex. Plan A-12, indice B' },
  { kind: 'survey', label: 'Relevé de géomètre', hint: 'Ex. Relevé topographique du 02/11' },
  { kind: 'bim_import', label: 'Maquette BIM (référence)', hint: 'Ex. maquette v3, élément 1042 (non lue par D.A.O.)' },
];

const WORDS: Record<string, string> = {
  length: 'longueur', width: 'largeur', height: 'hauteur', depth: 'profondeur', thickness: 'épaisseur',
  surface: 'surface', area: 'surface', volume: 'volume', count: 'nombre', perimeter: 'périmètre',
  wall: 'du mur', openings: 'des ouvertures', opening: 'de l’ouverture', floor: 'du sol', roof: 'de la toiture',
  room: 'de la pièce', slab: 'de la dalle', net: 'nette', gross: 'brute', total: 'totale',
};
const KNOWN: Record<string, string> = {
  length_m: 'Longueur', width_m: 'Largeur', depth_m: 'Profondeur', height_m: 'Hauteur',
  wall_length_m: 'Longueur du mur', wall_height_m: 'Hauteur du mur',
  openings_area_m2: 'Surface des ouvertures à déduire', surface_area_m2: 'Surface',
};

/** Libellé d'un champ : titre publié dans le modèle, sinon libellé connu, sinon nom décomposé. */
export function fieldLabel(field: string, schema?: TakeoffSchema | null): string {
  const title = schema?.properties?.[field]?.title;
  if (typeof title === 'string' && title.trim()) return title.trim();
  if (KNOWN[field]) return KNOWN[field];
  const parts = field.replace(/_(m|m2|m3|count)$/, '').split('_').filter(Boolean);
  if (!parts.length) return field;
  const words = parts.map(part => WORDS[part] ?? part);
  // « wall_length » → « longueur du mur » : le mot de mesure passe en tête.
  const measureIndex = words.findIndex((_, i) => ['length','width','height','depth','thickness','surface','area','volume','count','perimeter'].includes(parts[i]));
  if (measureIndex > 0) words.unshift(...words.splice(measureIndex, 1));
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Champs à saisir : `required` fait foi (certains modèles V1 n'ont pas de `properties`). */
export function templateFields(schema?: TakeoffSchema | null): string[] {
  const required = Array.isArray(schema?.required) ? schema!.required! : [];
  const optional = Object.keys(schema?.properties ?? {}).filter(name => !required.includes(name));
  return [...required, ...optional].filter(name => dimensionOf(name) !== null);
}

/** Formule du modèle publié rendue en mots, sans l'évaluer. */
export function formulaText(node: unknown, schema?: TakeoffSchema | null): string {
  const render = (n: any, nested: boolean): string => {
    if (typeof n === 'string') return fieldLabel(n, schema).toLowerCase();
    if (!n || typeof n !== 'object') return '?';
    if (n.op === 'identity') return fieldLabel(String(n.arg ?? ''), schema).toLowerCase();
    if (n.op === 'multiply' && Array.isArray(n.args)) return n.args.map((a: unknown) => render(a, true)).join(' × ');
    if (n.op === 'subtract' && Array.isArray(n.args) && n.args.length === 2) {
      const text = `${render(n.args[0], true)} − ${render(n.args[1], true)}`;
      return nested ? `(${text})` : text;
    }
    return '?';
  };
  const text = render(node, false);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const DECIMAL_INPUT = /^(0|[1-9]\d{0,8})(?:[.,](\d{1,6}))?$/;

/** Saisie française acceptée (virgule ou point) → chaîne décimale du contrat #548, sinon null. */
export function normalizeDecimal(raw: string): string | null {
  const value = raw.trim().replace(/\s/g, '');
  if (!DECIMAL_INPUT.test(value)) return null;
  return value.replace(',', '.');
}

export type DraftCheck = {
  inputs: Record<string, { value: string; unit: string; source: { kind: TakeoffSourceKind; reference: string } }>;
  errors: Record<string, string>;
  missing: string[];
};

/**
 * Contrôle de forme avant envoi. Un champ vide reste **manquant** (le moteur produira « données
 * insuffisantes ») ; un champ commencé mais incomplet est une erreur à corriger, jamais complété.
 */
export function checkDraft(fields: string[], draft: Record<string, TakeoffDraftField | undefined>): DraftCheck {
  const inputs: DraftCheck['inputs'] = {}; const errors: Record<string, string> = {}; const missing: string[] = [];
  for (const field of fields) {
    const entry = draft[field];
    const dimension = dimensionOf(field);
    const started = Boolean(entry && (entry.value.trim() || entry.reference.trim()));
    if (!entry || !started) { missing.push(field); continue; }
    const value = normalizeDecimal(entry.value);
    if (!entry.value.trim()) { errors[field] = 'Indiquez la valeur ou videz la provenance.'; continue; }
    if (value === null) { errors[field] = 'Nombre positif attendu, 6 décimales au plus (ex. 12,5).'; continue; }
    if (!dimension || !INPUT_UNITS[dimension].includes(entry.unit)) { errors[field] = 'Unité incompatible avec cette dimension.'; continue; }
    if (!entry.kind) { errors[field] = 'Indiquez la provenance de la mesure.'; continue; }
    const reference = entry.reference.trim();
    if (!reference) { errors[field] = 'Indiquez la référence (plan, relevé, date de mesure…).'; continue; }
    if (reference.length > 300) { errors[field] = 'Référence trop longue (300 caractères au plus).'; continue; }
    inputs[field] = { value, unit: entry.unit, source: { kind: entry.kind, reference } };
  }
  return { inputs, errors, missing };
}

/** Clé de périmètre conforme au contrat #548 dérivée d'un libellé (« Mur nord » → « mur-nord »). */
export function scopeKeyFrom(label: string): string {
  const slug = label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '-').replace(/^[^a-z0-9]+/, '').replace(/-+$/g, '').slice(0, 80);
  return slug || 'principal';
}

/** Rend une clé unique parmi les métrés existants du même ouvrage (aucune fusion silencieuse). */
export function uniqueScopeKey(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base.slice(0, 75)}-${i}`;
    if (!taken.includes(candidate)) return candidate;
  }
  return `${base.slice(0, 70)}-${Date.now().toString(36)}`;
}

export type TakeoffStatus = 'draft' | 'submitted' | 'validated';
export type ViewerRole = { isOwner: boolean; isAdmin: boolean; isAssignedManager: boolean; hasAssignedManager: boolean };

/**
 * Actions proposées à l'écran. La base reste seule juge (RLS/RPC #548) ; l'écran est **plus
 * prudent** : le Client propriétaire ne valide jamais son propre métré, même s'il est aussi staff.
 */
export function takeoffActions(role: ViewerRole, takeoff: { status: TakeoffStatus; currentStatus: 'calculated' | 'insufficient_data' | null } | null) {
  const canWrite = role.isOwner || role.isAdmin || role.isAssignedManager;
  const canValidateRole = (role.isAdmin || role.isAssignedManager) && !role.isOwner;
  return {
    canWrite,
    canCalculate: canWrite,
    canSubmit: canWrite && takeoff?.status === 'draft' && takeoff.currentStatus === 'calculated',
    canValidate: canValidateRole && takeoff?.status === 'submitted',
    awaitingValidation: takeoff?.status === 'submitted' && !canValidateRole,
  };
}

export const STATUS_LABELS: Record<TakeoffStatus, string> = {
  draft: 'Brouillon',
  submitted: 'En attente de validation technique',
  validated: 'Validé',
};

export const EVENT_LABELS: Record<string, string> = {
  calculated: 'Calcul enregistré',
  insufficient_data: 'Données insuffisantes',
  submitted: 'Soumis pour validation',
  validated: 'Validé',
  validation_invalidated: 'Nouvelle révision : la validation précédente reste conservée',
};

/** Différences d'entrées entre deux révisions (comparaison révision courante / validée). */
export function compareInputs(current: Record<string, any> | null | undefined, reference: Record<string, any> | null | undefined) {
  const names = [...new Set([...Object.keys(current ?? {}), ...Object.keys(reference ?? {})])].sort();
  return names.map(name => {
    const a = current?.[name]; const b = reference?.[name];
    const show = (x: any) => x ? `${x.original?.value ?? x.value} ${UNIT_SYMBOLS[x.original?.unit ?? x.unit] ?? x.original?.unit ?? x.unit}` : '—';
    return { field: name, current: show(a), reference: show(b), changed: show(a) !== show(b) || a?.source?.reference !== b?.source?.reference };
  });
}
