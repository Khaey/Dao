import test from 'node:test';
import assert from 'node:assert/strict';
import { expectedInputUnit, evaluateTakeoff } from '../src/btp-takeoff/engine.js';
import type { TakeoffTemplate } from '../src/btp-takeoff/contract.js';
import {
  checkDraft, compareInputs, dimensionOf, fieldLabel, formulaText, INPUT_UNITS, normalizeDecimal,
  scopeKeyFrom, takeoffActions, templateFields, uniqueScopeKey,
} from '../src/btp-takeoff-ui/presentation.js';

const MASONRY = { required: ['wall_length_m', 'wall_height_m', 'openings_area_m2'] };
const MASONRY_AST = { op: 'subtract', args: [{ op: 'multiply', args: ['wall_length_m', 'wall_height_m'] }, 'openings_area_m2'] };

test('dimensions and input units mirror the #548 engine exactly', () => {
  for (const name of ['length_m', 'surface_area_m2', 'volume_m3', 'fixture_count']) assert.equal(dimensionOf(name), expectedInputUnit(name));
  assert.equal(dimensionOf('colour'), null);
  // Chaque unité proposée est acceptée par le moteur (aucune unité proposée puis refusée).
  const tpl = (field: string, unit: TakeoffTemplate['outputUnitCode']): TakeoffTemplate => ({ catalogVersionId: 'v', catalogVersionCode: 'TN', workId: 'w', workCode: 'w',
    workLabel: 'w', templateId: 't', outputUnitCode: unit, inputSchema: { required: [field] }, formulaAst: { op: 'identity', arg: field }, roundingScale: 3, assumptions: [], sourceRef: 's' });
  for (const [field, dim] of [['a_m', 'm'], ['a_m2', 'm2'], ['a_m3', 'm3'], ['a_count', 'unit']] as const) {
    for (const unit of INPUT_UNITS[dim]) {
      const out = evaluateTakeoff(tpl(field, dim), { [field]: { value: '1000', unit, source: { kind: 'manual', reference: 'test' } } });
      assert.equal(out.status, 'calculated');
    }
  }
});

test('fields are generated from template metadata, titles first, no hard-coded work', () => {
  assert.deepEqual(templateFields(MASONRY), ['wall_length_m', 'wall_height_m', 'openings_area_m2']);
  assert.deepEqual(templateFields({ required: ['length_m'], properties: { length_m: {}, width_m: {}, note: {} } }), ['length_m', 'width_m']);
  assert.equal(fieldLabel('wall_height_m'), 'Hauteur du mur');
  assert.equal(fieldLabel('slab_thickness_m'), 'Épaisseur de la dalle');
  assert.equal(fieldLabel('length_m', { properties: { length_m: { title: 'Longueur intérieure' } } }), 'Longueur intérieure');
  assert.equal(formulaText(MASONRY_AST, MASONRY), 'Longueur du mur × hauteur du mur − surface des ouvertures à déduire');
  assert.equal(formulaText({ op: 'multiply', args: ['length_m', { op: 'subtract', args: ['width_m', 'depth_m'] }] }), 'Longueur × (largeur − profondeur)');
});

test('draft check never fills a value: empty stays missing, partial is an error', () => {
  assert.equal(normalizeDecimal('12,5'), '12.5');
  assert.equal(normalizeDecimal('1 250'), '1250');
  for (const bad of ['-1', '1e3', '01', '1.1234567', '', 'abc']) assert.equal(normalizeDecimal(bad), null);
  const fields = ['wall_length_m', 'wall_height_m', 'openings_area_m2'];
  const check = checkDraft(fields, {
    wall_length_m: { value: '1250', unit: 'cm', kind: 'document', reference: ' Plan A-12 ' },
    wall_height_m: { value: '2,8', unit: 'm', kind: '', reference: 'Relevé' },
    openings_area_m2: { value: '', unit: 'm2', kind: 'manual', reference: '' },
  });
  assert.deepEqual(check.inputs, { wall_length_m: { value: '1250', unit: 'cm', source: { kind: 'document', reference: 'Plan A-12' } } });
  assert.match(check.errors.wall_height_m, /provenance/);
  assert.deepEqual(check.missing, ['openings_area_m2']);
  assert.match(checkDraft(['length_m'], { length_m: { value: '3', unit: 'm2', kind: 'manual', reference: 'x' } }).errors.length_m, /Unité/);
  assert.match(checkDraft(['length_m'], { length_m: { value: '', unit: 'm', kind: 'manual', reference: 'x' } }).errors.length_m, /valeur/);
});

test('scope keys respect the #548 contract and never merge two perimeters', () => {
  const pattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
  for (const label of ['Mur nord', 'Pièce n°2 — étage', '***', 'É'.repeat(200)]) assert.match(scopeKeyFrom(label), pattern);
  assert.equal(scopeKeyFrom('Mur nord (RDC)'), 'mur-nord-rdc');
  assert.equal(uniqueScopeKey('mur-nord', ['mur-nord', 'mur-nord-2']), 'mur-nord-3');
});

test('screen actions are stricter than the database: no self-validation, no validation without an authorised manager', () => {
  const draft = { status: 'draft' as const, currentStatus: 'calculated' as const };
  const submitted = { status: 'submitted' as const, currentStatus: 'calculated' as const };
  const owner = { isOwner: true, isAdmin: false, isAssignedManager: false, hasAssignedManager: false };
  assert.equal(takeoffActions(owner, draft).canSubmit, true);
  assert.equal(takeoffActions(owner, submitted).canValidate, false);
  assert.equal(takeoffActions(owner, submitted).awaitingValidation, true);
  assert.equal(takeoffActions({ ...owner, isAdmin: true }, submitted).canValidate, false);
  // #556 §5.1 : le réglage ouvre la validation au Client propriétaire, et seulement à lui.
  assert.equal(takeoffActions({ ...owner, clientCanValidate: true }, submitted).canValidate, true);
  assert.equal(takeoffActions({ ...owner, clientCanValidate: true }, submitted).awaitingValidation, false);
  assert.equal(takeoffActions({ ...owner, clientCanValidate: true }, draft).canValidate, false);
  assert.equal(takeoffActions({ ...owner, clientCanValidate: false }, submitted).canValidate, false);
  assert.equal(takeoffActions(owner, { status: 'draft', currentStatus: 'insufficient_data' }).canSubmit, false);
  const manager = { isOwner: false, isAdmin: false, isAssignedManager: true, hasAssignedManager: true };
  assert.equal(takeoffActions(manager, submitted).canValidate, true);
  assert.equal(takeoffActions(manager, draft).canValidate, false);
  const stranger = { isOwner: false, isAdmin: false, isAssignedManager: false, hasAssignedManager: true };
  assert.deepEqual([takeoffActions(stranger, draft).canWrite, takeoffActions(stranger, submitted).canValidate], [false, false]);
  assert.equal(takeoffActions({ ...stranger, clientCanValidate: true }, submitted).canValidate, false);
});

test('revision comparison shows original units and flags changed provenance', () => {
  const rows = compareInputs(
    { length_m: { value: '12', unit: 'm', original: { value: '1200', unit: 'cm' }, source: { kind: 'document', reference: 'Plan B' } } },
    { length_m: { value: '12', unit: 'm', original: { value: '1200', unit: 'cm' }, source: { kind: 'document', reference: 'Plan A' } }, width_m: { value: '3', unit: 'm', original: { value: '3', unit: 'm' } } },
  );
  assert.deepEqual(rows.map(r => [r.field, r.current, r.reference, r.changed]), [['length_m', '1200 cm', '1200 cm', true], ['width_m', '—', '3 m', true]]);
});
