import type { BtpCatalogSnapshot, BtpProjectType, BtpWork } from '../../src/btp-reference/contract.js';

/** Fictional TEST data only. Does not assert DEV catalogue contents. */
export function guidedFixture(): BtpCatalogSnapshot {
  const all: BtpProjectType[] = ['construction', 'renovation', 'extension', 'repair'];
  const sourceRef = 'TEST #578 — fixture fictive';
  const work = (id: string, label: string, projectTypes = all): BtpWork => ({ id, code: `test_${id}`, label, unitCode: 'm2', relevance: 'conditional', projectTypes, aliases: [], requiredInputs: ['surface_area_m2'], measurementNote: 'TEST : aucune quantité implicite', sourceRef });
  const paint = { ...work('paint', 'Peinture intérieure'), aliases: ['réfection', 'Œuvre décorative'] };
  const wall = { ...work('wall', 'Mur porteur', ['construction', 'extension']), unitCode: 'm3', relevance: 'verify' as const };
  const demolition = work('demolition', 'Dépose existante', ['renovation', 'repair', 'extension']);
  const insulation = work('insulation', 'Isolation extérieure');
  const metadata = { projectTypes: all, relevance: 'conditional' as const, sourceRef };
  return {
    catalogVersion: { id: 'version-test-1', code: 'TEST-1', countryCode: 'TN', regionCode: null, effectiveFrom: '2026-01-01', provenance: { label: 'TEST fictif' } },
    units: [{ code: 'm2', symbol: 'm²', label: 'Mètre carré', dimension: 'area', decimalScale: 3 }, { code: 'm3', symbol: 'm³', label: 'Mètre cube', dimension: 'volume', decimalScale: 3 }],
    lots: [{ ...metadata, id: 'finishes', code: 'test_lot_finishes', label: 'Finitions', tradeId: 'test-trade', subLots: [
      { ...metadata, id: 'surfaces', code: 'test_sub_surfaces', label: 'Surfaces', works: [paint, demolition, insulation] },
    ] }, { ...metadata, id: 'structure', code: 'test_lot_structure', label: 'Structure', tradeId: 'test-trade', subLots: [
      { ...metadata, id: 'walls', code: 'test_sub_walls', label: 'Murs', works: [wall] },
    ] }],
    rules: [{ id: 'study', code: 'test_rule_study', type: 'prerequisite', severity: 'blocking', subjects: ['test_wall'], condition: { measurement_requested: true }, effect: { requires: ['technical_study'] }, explanation: 'TEST : étude avant métré structurel', sourceRef }],
    dependencies: [{ id: 'dep', predecessorWorkId: 'demolition', successorWorkId: 'paint', relationType: 'before', mandatory: false, applicability: { project_type: 'renovation' }, explanation: 'TEST : dépose selon état existant', sourceRef }],
    measurementTemplates: ['paint', 'insulation'].map(id => ({ id: `model-${id}`, workId: id, outputUnitCode: 'm2', inputSchema: { required: ['surface_area_m2'], 'x-dao': { professionalConfirmation: id === 'insulation' } }, formulaAst: { op: 'identity', arg: 'surface_area_m2' }, roundingScale: 3, assumptions: ['TEST : surface explicite'], sourceRef })),
    priceSources: [],
  };
}
