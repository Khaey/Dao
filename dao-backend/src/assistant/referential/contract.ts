/**
 * Contrat minimal et stable entre l'assistant BTP (Coordinateur Mission 1) et
 * le référentiel BTP (DEV 5, #541). Version 1.
 *
 * Règles du contrat :
 * - le référentiel est la seule source des lots, sous-lots et ouvrages : l'assistant
 *   ne crée jamais d'élément absent du référentiel ;
 * - aucun prix, ratio, quantité, durée ni conformité réglementaire ne transite ici ;
 * - les identifiants sont stables d'une version à l'autre (un élément retiré passe
 *   en `deprecated`, il n'est pas réutilisé) ;
 * - tout élément porte sa provenance.
 *
 * Toute implémentation (données fictives aujourd'hui, tables DEV 5 demain) doit
 * satisfaire `validateReferentialSnapshot`.
 */
export const BTP_REFERENTIAL_CONTRACT_VERSION = '1';

export const PROJECT_KINDS = ['construction', 'renovation', 'extension', 'other'] as const;
export type ProjectKind = typeof PROJECT_KINDS[number];

export const ITEM_KINDS = ['lot', 'sub_lot', 'work'] as const;
export type ReferentialItemKind = typeof ITEM_KINDS[number];

/**
 * usual       : habituel pour ce type de projet, proposé d'office ;
 * verify      : habituel mais dépendant d'études ou de l'existant, proposé et signalé « à vérifier » ;
 * conditional : selon la situation, suggéré seulement ;
 * optional    : facultatif, suggéré seulement.
 */
export const RELEVANCES = ['usual', 'verify', 'conditional', 'optional'] as const;
export type Relevance = typeof RELEVANCES[number];

export type Applicability = { projectKind: ProjectKind; relevance: Relevance };

export type Provenance = {
  /** Libellé lisible de la source (ex. « Référentiel D.A.O. »). */
  source: string;
  /** Version de la source ou du catalogue. */
  version: string;
  /** Date ISO de dernière vérification humaine, ou null. */
  verifiedOn: string | null;
};

export type ReferentialItem = {
  /** Identifiant canonique stable (UUID côté DEV 5). */
  id: string;
  /** Code lisible et stable, unique dans le catalogue. */
  code: string;
  kind: ReferentialItemKind;
  /** Lot : null. Sous-lot : id d'un lot. Ouvrage : id d'un sous-lot. */
  parentId: string | null;
  label: string;
  description?: string;
  /** Code métier `public.trades.code`, obligatoire pour un lot. */
  tradeCode: string | null;
  /** Unité de mesure prévue pour les métrés futurs (m, m2, m3, u, ens), sans quantité. */
  unit: string | null;
  /** Types de projet auxquels l'élément s'applique, avec sa pertinence. */
  applicability: Applicability[];
  /** Mots et expressions (français, extensible arabe/tunisien) qui désignent l'élément. */
  keywords: string[];
  /** Éléments souvent associés (ids), suggérés lorsque celui-ci est retenu. */
  relatedIds?: string[];
  status: 'published' | 'deprecated';
  provenance: Provenance;
};

export type ReferentialSnapshot = {
  contractVersion: typeof BTP_REFERENTIAL_CONTRACT_VERSION;
  /** Fournisseur : `fixture` (données fictives conformes) ou `dao-referential` (DEV 5). */
  provider: string;
  catalogVersion: string;
  countryCode: string;
  /** `fixture` : données de démonstration ; `partial` : référentiel réel incomplet ; `complete`. */
  completeness: 'fixture' | 'partial' | 'complete';
  items: ReferentialItem[];
};

export type ReferentialQuery = { countryCode: string };

/** Port lu par l'assistant. DEV 5 fournit l'implémentation réelle. */
export interface BtpReferentialPort {
  snapshot(query: ReferentialQuery): Promise<ReferentialSnapshot>;
}

const ID = /^[A-Za-z0-9:_-]{1,80}$/;
const CODE = /^[a-z0-9_.-]{2,80}$/;

/** Vérifie la conformité d'un instantané ; renvoie la liste des écarts (vide si conforme). */
export function validateReferentialSnapshot(snapshot: ReferentialSnapshot): string[] {
  const errors: string[] = [];
  if (snapshot.contractVersion !== BTP_REFERENTIAL_CONTRACT_VERSION) errors.push('contractVersion');
  if (!snapshot.provider || !snapshot.catalogVersion) errors.push('provider/catalogVersion');
  const byId = new Map<string, ReferentialItem>();
  const codes = new Set<string>();
  for (const item of snapshot.items) {
    if (!ID.test(item.id) || byId.has(item.id)) errors.push(`id:${item.id}`);
    if (!CODE.test(item.code) || codes.has(item.code)) errors.push(`code:${item.code}`);
    byId.set(item.id, item); codes.add(item.code);
    if (!ITEM_KINDS.includes(item.kind)) errors.push(`kind:${item.code}`);
    if (!item.label || item.label.length > 120) errors.push(`label:${item.code}`);
    if (!item.provenance?.source || !item.provenance?.version) errors.push(`provenance:${item.code}`);
    if (!item.applicability?.length || item.applicability.some(a => !PROJECT_KINDS.includes(a.projectKind) || !RELEVANCES.includes(a.relevance))) errors.push(`applicability:${item.code}`);
    if (item.kind === 'lot' && (item.parentId !== null || !item.tradeCode)) errors.push(`lot:${item.code}`);
    for (const forbidden of ['price', 'prix', 'quantity', 'quantite', 'duration', 'duree']) {
      if (forbidden in (item as Record<string, unknown>)) errors.push(`forbidden:${forbidden}:${item.code}`);
    }
  }
  for (const item of snapshot.items) {
    if (item.kind === 'lot') continue;
    const parent = item.parentId ? byId.get(item.parentId) : undefined;
    const expected = item.kind === 'sub_lot' ? 'lot' : 'sub_lot';
    if (!parent || parent.kind !== expected) errors.push(`parent:${item.code}`);
    for (const related of item.relatedIds ?? []) if (!byId.has(related)) errors.push(`related:${item.code}`);
  }
  return errors;
}
