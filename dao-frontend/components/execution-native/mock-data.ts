/** DAO #410 : données fictives ; jamais une source serveur. */
export type Role = 'client' | 'artisan' | 'gestionnaire';
export type WorkStatus = 'to_assign' | 'conditions' | 'ready' | 'in_progress' | 'complete';
export type Option = 'sub_lots' | 'dates' | 'dependencies' | 'milestones' | 'installments';
export type Node = {
  id: string; title: string; status: WorkStatus; progress: number | null;
  start: string | null; end: string | null; subLots?: Node[];
};
export type Lot = Node & {
  awardId: string | null; awardActive: boolean; contractorId: string | null;
  contractor: string | null; options: Option[]; agreementVersion: number | null;
  contractEnabled: boolean; installmentNote?: string;
};
export type Scenario = {
  id: string; label: string; description: string; project: string;
  lots: Lot[]; phase?: 'ready' | 'loading' | 'error';
};
const lots: Lot[] = [
  {
    id: 'fake-lot-maconnerie', title: 'Maçonnerie', status: 'in_progress', progress: 35,
    start: '2026-11-02', end: '2026-12-16', awardId: 'fake-award-a-1', awardActive: true,
    contractorId: 'fake-artisan-a', contractor: 'Entreprise Atlas (fictif)',
    options: ['sub_lots', 'dates', 'dependencies'], agreementVersion: 2, contractEnabled: false,
    subLots: [
      { id: 'fake-sublot-fondations', title: 'Fondations', status: 'in_progress',
        progress: 60, start: '2026-11-02', end: '2026-11-20' },
      { id: 'fake-sublot-murs', title: 'Élévation des murs', status: 'ready',
        progress: null, start: null, end: null },
    ],
  },
  {
    id: 'fake-lot-electricite', title: 'Électricité', status: 'conditions', progress: null,
    start: null, end: null, awardId: 'fake-award-b-1', awardActive: true,
    contractorId: 'fake-artisan-b', contractor: 'Société Éclair (fictif)',
    options: [], agreementVersion: null, contractEnabled: false,
  },
  {
    id: 'fake-lot-peinture', title: 'Peinture', status: 'ready', progress: null,
    start: '2026-12-20', end: '2027-01-12', awardId: 'fake-award-a-2', awardActive: true,
    contractorId: 'fake-artisan-a', contractor: 'Entreprise Atlas (fictif)',
    options: ['dates', 'milestones'], agreementVersion: 1, contractEnabled: false,
  },
  {
    id: 'fake-lot-jardin', title: 'Aménagement jardin', status: 'to_assign', progress: null,
    start: null, end: null, awardId: null, awardActive: false,
    contractorId: null, contractor: null, options: [], agreementVersion: null, contractEnabled: false,
  },
];
const copy = (items: Lot[]): Lot[] => items.map(item => ({
  ...item, options: [...item.options], subLots: item.subLots?.map(sub => ({ ...sub })),
}));
const datesOnly = copy(lots.slice(0, 1)).map(lot => ({
  ...lot, subLots: undefined, progress: null, options: ['dates'] as Option[],
}));
const installments = copy(lots.slice(1, 2)).map(lot => ({
  ...lot, status: 'ready' as WorkStatus, options: ['installments'] as Option[],
  installmentNote: '2 échéances indicatives ; aucun paiement',
}));
export const scenarios: Scenario[] = [
  { id: 'multi', label: 'Client multi-artisans', description: 'Deux Artisans, plusieurs lots et un lot ouvert.',
    project: 'Maison S+3 — maquette fictive', lots: copy(lots) },
  { id: 'artisan_two', label: 'Artisan avec deux lots', description: 'Maçonnerie et Peinture pour le même Artisan.',
    project: 'Maison S+3 — maquette fictive', lots: copy(lots) },
  { id: 'small', label: 'Petit chantier détaillé', description: 'Sous-lots du devis retenu visibles en expansion.',
    project: 'Petite rénovation — maquette fictive', lots: copy(lots.slice(0, 1)) },
  { id: 'large', label: 'Grand chantier sans sous-lot', description: 'Aucun sous-lot imposé.',
    project: 'Résidence — maquette fictive', lots: copy(lots.slice(0, 3)).map(lot => ({
      ...lot, subLots: undefined, progress: null, options: [],
    })) },
  { id: 'dates', label: 'Dates seules', description: 'Dates renseignées sans avancement ou jalon implicite.',
    project: 'Planning léger — maquette fictive', lots: datesOnly },
  { id: 'installments', label: 'Échéancier sans sous-lot', description: 'Échéancier purement informatif, indépendant.',
    project: 'Chantier à échéances — maquette fictive', lots: installments },
  { id: 'contract_off', label: 'Contrat OFF', description: 'La lecture du suivi ne dépend pas de la signature.',
    project: 'Chantier sans contrat activé — maquette fictive', lots: copy(lots.slice(0, 2)) },
  { id: 'empty', label: 'Sans données', description: 'Aucune fausse ligne affichée.',
    project: 'Chantier vide — maquette fictive', lots: [] },
  { id: 'loading', label: 'Chargement', description: 'Attente sans inventer de progression.',
    project: 'Maquette fictive', lots: [], phase: 'loading' },
  { id: 'error', label: 'Erreur de lecture', description: 'Erreur distincte du vide.',
    project: 'Maquette fictive', lots: [], phase: 'error' },
];
