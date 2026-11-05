// #566 — fixtures TEST uniquement. Aucune donnée projet réelle.
export const btpQualificationFixtures = {
  villaSurfaceOnly: { label: 'TEST villa R+1 — surface seule', projectType: 'construction', inputs: { built_area_m2: 180 }, expected: 'insufficient_data' },
  villaMeasured: { label: 'TEST villa R+1 — dimensions explicites', projectType: 'construction', inputs: { length_m: '10', width_m: '6' }, expectedAreaM2: '60' },
  renovationRoom: { label: 'TEST rénovation — pièce mesurée', projectType: 'renovation', inputs: { length_m: '4.25', width_m: '3.10' }, expectedAreaM2: '13.175' },
  multiLot: { label: 'TEST multi-lots — scopes distincts', projectType: 'construction', scopes: ['lot-plomberie-sdb-01', 'lot-plomberie-sdb-02'], inputs: { fixture_count: '3' }, expectedUnit: '3' },
} as const;
