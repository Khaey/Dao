import { BTP_REFERENTIAL_CONTRACT_VERSION, type Applicability, type BtpReferentialPort, type ProjectKind, type ReferentialItem, type ReferentialSnapshot, type Relevance } from './contract.js';

/**
 * Données FICTIVES conformes au contrat v1, en attendant le référentiel de DEV 5 (#541).
 * Taxonomie éditoriale uniquement : aucun prix, quantité, durée ni conformité.
 * Elles sont affichées comme « référentiel provisoire » dans l'interface.
 */
const provenance = { source: 'Référentiel provisoire D.A.O. (données de démonstration, en attente du référentiel #541)', version: 'fixture-1', verifiedOn: null };

type Spec = [code: string, label: string, applicability: Partial<Record<ProjectKind, Relevance>>, keywords: string[], extra?: { trade?: string; unit?: string; related?: string[]; description?: string }];

const items: ReferentialItem[] = [];
const id = (code: string) => `fx:${code}`;
function add(kind: ReferentialItem['kind'], parent: string | null, [code, label, applicability, keywords, extra = {}]: Spec) {
  items.push({
    id: id(code), code, kind, parentId: parent ? id(parent) : null, label, description: extra.description,
    tradeCode: extra.trade ?? null, unit: extra.unit ?? null,
    applicability: Object.entries(applicability).map(([projectKind, relevance]) => ({ projectKind, relevance }) as Applicability),
    keywords, relatedIds: extra.related?.map(id), status: 'published', provenance,
  });
}
function lot(spec: Spec, subLots: Array<[Spec, Spec[]]>) {
  add('lot', null, spec);
  for (const [sub, works] of subLots) { add('sub_lot', spec[0], sub); for (const work of works) add('work', sub[0], work); }
}

const NEW = { construction: 'usual', extension: 'usual' } as const;

lot(['lot_studies', 'Études et conception', { construction: 'usual', extension: 'usual', renovation: 'conditional' }, ['architecte', 'etude', 'conception', 'bureau d etude'], { trade: 'general_contractor' }], [
  [['sub_design', 'Conception et plans', { construction: 'usual', extension: 'usual', renovation: 'conditional' }, ['plan architecte', 'conception']], [
    ['work_architectural_plans', 'Plans architecturaux et dossier d’autorisation à préparer', { construction: 'verify', extension: 'verify', renovation: 'conditional' }, ['plan', 'permis de batir', 'autorisation de batir'], { unit: 'ens' }],
    ['work_structural_study', 'Étude de structure (béton armé)', { construction: 'verify', extension: 'verify' }, ['etude beton', 'etude de structure', 'ingenieur'], { unit: 'ens' }],
    ['work_soil_study', 'Étude géotechnique du sol', { construction: 'conditional', extension: 'conditional' }, ['etude de sol', 'geotechnique', 'sol'], { unit: 'ens' }],
  ]],
]);

lot(['lot_earthworks', 'Terrassement et réseaux extérieurs', { construction: 'usual', extension: 'conditional' }, ['terrassement', 'vrd'], { trade: 'trade_earthworks' }], [
  [['sub_earthworks', 'Terrassement', { construction: 'usual', extension: 'conditional' }, ['fouille', 'decapage']], [
    ['work_excavation', 'Décapage et fouilles', { construction: 'verify', extension: 'verify' }, ['fouille', 'decapage', 'excavation'], { unit: 'm3' }],
    ['work_backfill', 'Remblai et compactage', { construction: 'verify', extension: 'conditional' }, ['remblai', 'compactage'], { unit: 'm3' }],
  ]],
  [['sub_utilities', 'Raccordements aux réseaux', { construction: 'usual', extension: 'conditional' }, ['raccordement']], [
    ['work_utility_connections', 'Raccordements eau, électricité et assainissement (à vérifier auprès des concessionnaires)', { construction: 'verify', extension: 'conditional' }, ['steg', 'sonede', 'onas', 'compteur', 'raccordement'], { unit: 'ens' }],
  ]],
]);

lot(['lot_structure', 'Gros œuvre', { ...NEW }, ['gros oeuvre', 'structure', 'maconnerie'], { trade: 'trade_masonry' }], [
  [['sub_foundations', 'Fondations', { ...NEW }, ['fondation']], [
    ['work_foundations', 'Fondations selon l’étude de sol', { construction: 'verify', extension: 'verify' }, ['fondation', 'semelle', 'radier'], { unit: 'm3', related: ['work_soil_study'] }],
  ]],
  [['sub_frame', 'Structure en béton armé', { ...NEW }, ['beton arme', 'ossature']], [
    ['work_columns_slabs', 'Poteaux, poutres et planchers', { construction: 'verify', extension: 'verify' }, ['poteau', 'poutre', 'dalle', 'plancher'], { unit: 'm3', related: ['work_structural_study'] }],
    ['work_stairs', 'Escalier', { construction: 'conditional', extension: 'conditional' }, ['escalier', 'etage', 'duplex'], { unit: 'u' }],
  ]],
  [['sub_masonry', 'Maçonnerie', { ...NEW }, ['maconnerie']], [
    ['work_walls', 'Murs et cloisons en brique', { construction: 'usual', extension: 'usual' }, ['mur', 'cloison', 'brique'], { unit: 'm2' }],
  ]],
  [['sub_annexes', 'Annexes construites', { construction: 'optional', extension: 'optional' }, ['annexe']], [
    ['work_garage', 'Garage', { construction: 'optional', extension: 'optional' }, ['garage', 'parking couvert'], { unit: 'u' }],
  ]],
  [['sub_existing_interface', 'Liaison avec le bâtiment existant', { extension: 'usual', renovation: 'conditional' }, ['existant', 'liaison']], [
    ['work_existing_diagnosis', 'Diagnostic de la structure existante', { extension: 'verify', renovation: 'conditional' }, ['diagnostic', 'existant', 'fissure'], { unit: 'ens' }],
    ['work_existing_connection', 'Raccordement à la structure et aux réseaux existants', { extension: 'verify' }, ['raccordement existant', 'surelevation', 'agrandissement'], { unit: 'ens' }],
  ]],
]);

lot(['lot_demolition', 'Dépose et démolition', { renovation: 'usual', extension: 'conditional' }, ['demolition', 'depose', 'demolir', 'casser'], { trade: 'trade_demolition' }], [
  [['sub_removal', 'Dépose de l’existant', { renovation: 'usual', extension: 'conditional' }, ['depose']], [
    ['work_strip_finishes', 'Dépose des revêtements et équipements existants', { renovation: 'verify', extension: 'conditional' }, ['depose', 'enlever le carrelage', 'ancien carrelage'], { unit: 'm2' }],
    ['work_partition_demolition', 'Démolition de cloisons (après vérification de la structure)', { renovation: 'conditional', extension: 'conditional' }, ['abattre', 'casser un mur', 'demolir', 'ouvrir la cuisine'], { unit: 'm2', related: ['work_existing_diagnosis'] }],
  ]],
]);

lot(['lot_waterproofing', 'Étanchéité', { construction: 'usual', extension: 'usual', renovation: 'conditional' }, ['etancheite', 'infiltration', 'fuite toiture'], { trade: 'trade_waterproofing' }], [
  [['sub_roof_waterproofing', 'Étanchéité de toiture-terrasse', { construction: 'usual', extension: 'usual', renovation: 'conditional' }, ['toiture terrasse', 'toit']], [
    ['work_roof_waterproofing', 'Étanchéité de la toiture-terrasse', { construction: 'verify', extension: 'verify', renovation: 'conditional' }, ['etancheite', 'toiture', 'toit', 'infiltration'], { unit: 'm2' }],
  ]],
]);

lot(['lot_plumbing', 'Plomberie et sanitaires', { construction: 'usual', extension: 'usual', renovation: 'conditional' }, ['plomberie', 'sanitaire', 'canalisation'], { trade: 'plumbing' }], [
  [['sub_water_networks', 'Réseaux d’eau', { construction: 'usual', extension: 'usual', renovation: 'conditional' }, ['tuyauterie', 'canalisation']], [
    ['work_water_supply', 'Alimentation en eau froide et chaude', { construction: 'usual', extension: 'usual', renovation: 'conditional' }, ['alimentation eau', 'tuyau', 'eau chaude'], { unit: 'ens' }],
    ['work_drainage', 'Évacuations des eaux usées', { construction: 'usual', extension: 'usual', renovation: 'conditional' }, ['evacuation', 'eaux usees'], { unit: 'ens' }],
  ]],
  [['sub_sanitary_fixtures', 'Équipements sanitaires', { construction: 'usual', extension: 'conditional', renovation: 'conditional' }, ['sanitaire']], [
    ['work_bathroom', 'Équipement des salles de bain', { construction: 'usual', extension: 'conditional', renovation: 'conditional' }, ['salle de bain', 'salle d eau', 'sdb', 'douche', 'baignoire', 'lavabo'], { unit: 'u', related: ['work_wall_tiling', 'work_drainage', 'work_water_supply'] }],
    ['work_toilets', 'WC', { construction: 'usual', extension: 'conditional', renovation: 'conditional' }, ['wc', 'toilette'], { unit: 'u' }],
    ['work_water_heater', 'Chauffe-eau', { construction: 'conditional', extension: 'conditional', renovation: 'conditional' }, ['chauffe eau', 'ballon'], { unit: 'u' }],
  ]],
]);

lot(['lot_sanitation', 'Assainissement', { construction: 'conditional', extension: 'conditional' }, ['assainissement', 'fosse septique', 'onas'], { trade: 'trade_sanitation' }], [
  [['sub_sewage', 'Évacuation vers le réseau ou fosse', { construction: 'conditional', extension: 'conditional' }, ['assainissement']], [
    ['work_sewage', 'Raccordement au réseau ou fosse selon le site', { construction: 'verify', extension: 'verify' }, ['fosse septique', 'assainissement', 'regard'], { unit: 'ens' }],
  ]],
]);

lot(['lot_electrical', 'Électricité', { construction: 'usual', extension: 'usual', renovation: 'conditional' }, ['electricite', 'electrique', 'courant'], { trade: 'electrical' }], [
  [['sub_power', 'Installation électrique', { construction: 'usual', extension: 'usual', renovation: 'conditional' }, ['installation electrique']], [
    ['work_panel_circuits', 'Tableau et circuits électriques', { construction: 'usual', extension: 'usual', renovation: 'conditional' }, ['tableau electrique', 'disjoncteur', 'circuit', 'cablage'], { unit: 'ens' }],
    ['work_outlets_lighting', 'Prises, interrupteurs et éclairage', { construction: 'usual', extension: 'usual', renovation: 'conditional' }, ['prise', 'interrupteur', 'eclairage', 'luminaire', 'spot'], { unit: 'u' }],
  ]],
  [['sub_low_voltage', 'Courants faibles', { construction: 'optional', extension: 'optional', renovation: 'optional' }, ['courant faible']], [
    ['work_network_tv', 'Réseau internet, TV et interphone', { construction: 'optional', extension: 'optional', renovation: 'optional' }, ['internet', 'wifi', 'tv', 'interphone', 'camera', 'domotique'], { unit: 'ens' }],
  ]],
]);

lot(['lot_plaster', 'Enduits et faux plafonds', { construction: 'usual', extension: 'usual', renovation: 'conditional' }, ['enduit', 'platre', 'faux plafond'], { trade: 'trade_plaster' }], [
  [['sub_plaster', 'Enduits et plafonds', { construction: 'usual', extension: 'usual', renovation: 'conditional' }, ['enduit']], [
    ['work_plaster', 'Enduits intérieurs', { construction: 'usual', extension: 'usual', renovation: 'conditional' }, ['enduit', 'crepissage', 'platre'], { unit: 'm2' }],
    ['work_false_ceiling', 'Faux plafonds et décor (staff)', { construction: 'optional', extension: 'optional', renovation: 'optional' }, ['faux plafond', 'staff', 'placo', 'ba13'], { unit: 'm2' }],
  ]],
]);

lot(['lot_tiling', 'Revêtements de sols et murs', { construction: 'usual', extension: 'usual', renovation: 'conditional' }, ['revetement', 'carrelage', 'sol'], { trade: 'trade_tiling' }], [
  [['sub_tiling', 'Sols et faïence', { construction: 'usual', extension: 'usual', renovation: 'conditional' }, ['carrelage']], [
    ['work_floor_tiling', 'Carrelage des sols', { construction: 'usual', extension: 'usual', renovation: 'conditional' }, ['carrelage', 'sol', 'sols', 'dallage'], { unit: 'm2' }],
    ['work_wall_tiling', 'Faïence murale (pièces d’eau, cuisine)', { construction: 'usual', extension: 'conditional', renovation: 'conditional' }, ['faience'], { unit: 'm2' }],
    ['work_marble', 'Marbre (escalier, seuils, appuis)', { construction: 'optional', extension: 'optional', renovation: 'optional' }, ['marbre', 'granit', 'pierre'], { unit: 'm2' }],
  ]],
]);

lot(['lot_painting', 'Peinture', { construction: 'usual', extension: 'usual', renovation: 'usual' }, ['peinture', 'peindre'], { trade: 'trade_painting' }], [
  [['sub_painting', 'Peinture', { construction: 'usual', extension: 'usual', renovation: 'usual' }, ['peinture']], [
    ['work_interior_paint', 'Peinture intérieure', { construction: 'usual', extension: 'usual', renovation: 'usual' }, ['peinture', 'peindre', 'murs', 'rafraichir'], { unit: 'm2' }],
    ['work_facade', 'Façade : enduit et peinture extérieure', { construction: 'usual', extension: 'conditional', renovation: 'conditional' }, ['facade', 'ravalement', 'exterieur'], { unit: 'm2' }],
  ]],
]);

lot(['lot_joinery', 'Menuiseries', { construction: 'usual', extension: 'usual', renovation: 'conditional' }, ['menuiserie'], { trade: 'trade_alu_joinery' }], [
  [['sub_windows', 'Menuiseries extérieures', { construction: 'usual', extension: 'usual', renovation: 'conditional' }, ['menuiserie exterieure']], [
    ['work_windows', 'Fenêtres et portes-fenêtres', { construction: 'usual', extension: 'usual', renovation: 'conditional' }, ['fenetre', 'baie vitree', 'aluminium', 'alu', 'pvc', 'volet'], { unit: 'u' }],
    ['work_entrance_door', 'Porte d’entrée', { construction: 'usual', extension: 'conditional', renovation: 'conditional' }, ['porte d entree', 'porte blindee'], { unit: 'u' }],
  ]],
  [['sub_interior_doors', 'Menuiseries intérieures', { construction: 'usual', extension: 'usual', renovation: 'conditional' }, ['menuiserie interieure']], [
    ['work_interior_doors', 'Portes intérieures', { construction: 'usual', extension: 'usual', renovation: 'conditional' }, ['porte', 'portes', 'placard'], { unit: 'u' }],
  ]],
  [['sub_metalwork', 'Ferronnerie', { construction: 'conditional', extension: 'conditional', renovation: 'optional' }, ['ferronnerie']], [
    ['work_railings', 'Garde-corps, grilles et portail', { construction: 'conditional', extension: 'conditional', renovation: 'optional' }, ['garde corps', 'grille', 'portail', 'rampe', 'ferronnerie'], { unit: 'u' }],
  ]],
]);

lot(['lot_kitchen', 'Cuisine équipée', { construction: 'optional', extension: 'optional', renovation: 'optional' }, ['cuisine'], { trade: 'trade_kitchen' }], [
  [['sub_kitchen', 'Agencement de cuisine', { construction: 'optional', extension: 'optional', renovation: 'optional' }, ['cuisine']], [
    ['work_kitchen_units', 'Meubles et plan de travail de cuisine', { construction: 'optional', extension: 'optional', renovation: 'optional' }, ['cuisine', 'plan de travail', 'cuisine equipee', 'cuisine separee', 'cuisine ouverte'], { unit: 'ens', related: ['work_wall_tiling', 'work_water_supply', 'work_drainage'] }],
  ]],
]);

lot(['lot_hvac', 'Climatisation et chauffage', { construction: 'optional', extension: 'optional', renovation: 'optional' }, ['climatisation', 'chauffage'], { trade: 'trade_hvac' }], [
  [['sub_hvac', 'Confort thermique', { construction: 'optional', extension: 'optional', renovation: 'optional' }, ['climatisation']], [
    ['work_air_conditioning', 'Climatisation', { construction: 'optional', extension: 'optional', renovation: 'optional' }, ['climatisation', 'clim', 'climatiseur'], { unit: 'u' }],
    ['work_heating', 'Chauffage central', { construction: 'optional', extension: 'optional', renovation: 'optional' }, ['chauffage', 'chauffage central', 'radiateur'], { unit: 'ens' }],
  ]],
]);

lot(['lot_solar', 'Énergie solaire', { construction: 'optional', extension: 'optional', renovation: 'optional' }, ['solaire', 'photovoltaique'], { trade: 'trade_solar' }], [
  [['sub_solar', 'Équipements solaires', { construction: 'optional', extension: 'optional', renovation: 'optional' }, ['solaire']], [
    ['work_solar_panels', 'Panneaux photovoltaïques', { construction: 'optional', extension: 'optional', renovation: 'optional' }, ['photovoltaique', 'panneau solaire', 'panneaux solaires'], { unit: 'ens' }],
    ['work_solar_water_heater', 'Chauffe-eau solaire', { construction: 'optional', extension: 'optional', renovation: 'optional' }, ['chauffe eau solaire'], { unit: 'u' }],
  ]],
]);

lot(['lot_outdoor', 'Aménagements extérieurs', { construction: 'optional', extension: 'optional', renovation: 'optional' }, ['amenagement exterieur', 'exterieur'], { trade: 'trade_landscaping' }], [
  [['sub_outdoor', 'Espaces extérieurs', { construction: 'optional', extension: 'optional', renovation: 'optional' }, ['espace exterieur']], [
    ['work_terrace', 'Terrasse', { construction: 'optional', extension: 'optional', renovation: 'optional' }, ['terrasse'], { unit: 'm2' }],
    ['work_garden', 'Jardin et espaces verts', { construction: 'optional', extension: 'optional', renovation: 'optional' }, ['jardin', 'espace vert', 'gazon', 'arrosage'], { unit: 'm2' }],
    ['work_fence', 'Clôture et mur de clôture', { construction: 'conditional', extension: 'optional', renovation: 'optional' }, ['cloture', 'mur de cloture'], { unit: 'm' }],
  ]],
]);

lot(['lot_pool', 'Piscine', { construction: 'optional', extension: 'optional', renovation: 'optional' }, ['piscine'], { trade: 'trade_pool' }], [
  [['sub_pool', 'Bassin et équipements', { construction: 'optional', extension: 'optional', renovation: 'optional' }, ['bassin']], [
    ['work_pool', 'Piscine (bassin, filtration)', { construction: 'optional', extension: 'optional', renovation: 'optional' }, ['piscine', 'bassin'], { unit: 'u' }],
  ]],
]);

lot(['lot_cleaning', 'Nettoyage de fin de chantier', { construction: 'optional', extension: 'optional', renovation: 'optional' }, ['nettoyage'], { trade: 'trade_cleaning' }], [
  [['sub_cleaning', 'Nettoyage', { construction: 'optional', extension: 'optional', renovation: 'optional' }, ['nettoyage']], [
    ['work_final_cleaning', 'Nettoyage et évacuation des déchets', { construction: 'optional', extension: 'optional', renovation: 'optional' }, ['nettoyage', 'gravats', 'evacuation des dechets'], { unit: 'ens' }],
  ]],
]);

export const FIXTURE_REFERENTIAL: ReferentialSnapshot = Object.freeze({
  contractVersion: BTP_REFERENTIAL_CONTRACT_VERSION,
  provider: 'fixture',
  catalogVersion: 'fixture-1',
  countryCode: 'TN',
  completeness: 'fixture',
  items,
}) as ReferentialSnapshot;

export class FixtureReferentialProvider implements BtpReferentialPort {
  async snapshot(): Promise<ReferentialSnapshot> { return FIXTURE_REFERENTIAL; }
}
