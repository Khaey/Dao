import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGuidedCatalog, compareGuidedReference, normalizeGuidedText, suggestGuidedWorks, type GuidedCatalog, type GuidedNature, type GuidedProjectSelection, type GuidedUsage } from '../src/btp-reference/guided-selection.js';
import { GuidedCatalogError } from '../src/btp-reference/guided-validation.js';
import { guidedFixture } from './fixtures/btp-guided-fixture.js';

const active = { kind: 'published_active' as const };
const flatten = (c: { groups: GuidedCatalog['groups'] }) => c.groups.flatMap(l => l.subLots.flatMap(s => s.works));
const read = () => buildGuidedCatalog(guidedFixture(), active);
const suggestions = (usage: GuidedUsage, nature?: GuidedNature, text?: string) => suggestGuidedWorks(read(), { usage, nature, text });

test('#578 maison neuve / appartement rénovation: same usage evidence, different explicit nature', () => {
  assert.deepEqual(flatten(suggestions('house', 'construction')).map(w => w.workId), ['insulation', 'paint', 'wall']);
  assert.deepEqual(flatten(suggestions('apartment', 'renovation')).map(w => w.workId), ['demolition', 'insulation', 'paint']);
  const house = suggestions('house', 'renovation'); const flat = suggestions('apartment', 'renovation');
  assert.deepEqual(house.groups, flat.groups);
  for (const l of house.groups) for (const s of l.subLots) for (const w of s.works) {
    assert.equal(w.relevance.nature, 'covered'); assert.equal(w.relevance.status, 'to_confirm');
    assert.equal(w.relevance.usage, 'not_documented'); assert.equal(w.sourceRef, 'TEST #578 — fixture fictive');
  }
});

test('#578 matrix: every UX usage × every nature, no small-work/description inference', () => {
  for (const usage of ['house', 'apartment', 'commercial', 'office', 'other', 'free'] as const) {
    for (const nature of ['construction', 'renovation', 'extension', 'repair', 'other', 'small_work'] as const) {
      const result = suggestions(usage, nature);
      assert.deepEqual(result.groups, suggestions('house', nature).groups);
      for (const lot of result.groups) for (const sub of lot.subLots) for (const w of sub.works) {
        assert.equal(w.relevance.nature, nature === 'small_work' ? 'no_evidence' : 'covered');
      }
    }
  }
  const free = suggestions('free'); assert.equal(flatten(free).length, 4);
  assert.equal(free.groups[0].subLots[0].works[0].relevance.status, 'no_evidence');
  assert.equal(flatten(suggestions('free', undefined, 'maison piscine 120 m2')).length, 0);
});

test('#578 applicability checks all hierarchy levels; no-evidence opt-in preserves reason', () => {
  const fixture = guidedFixture(); fixture.lots[0].projectTypes = ['repair'];
  const result = suggestGuidedWorks(buildGuidedCatalog(fixture, active), { usage: 'house', nature: 'construction' });
  assert.deepEqual(flatten(result).map(w => w.workId), ['wall']);
  const all = suggestGuidedWorks(read(), { usage: 'house', nature: 'construction', includeWithoutEvidence: true });
  assert.equal(all.groups[0].subLots[0].works.find(w => w.workId === 'demolition')!.relevance.status, 'no_evidence');
});

test('#578 French search: accents/aliases/ligature/path/code, deterministic navigation', () => {
  assert.equal(normalizeGuidedText('  ŒUVRE / RéFÉCTION  '), 'oeuvre refection');
  for (const text of ['REFECTION', 'œuvre', 'oeuvre', 'surfaces peinture', 'test_paint']) assert.deepEqual(flatten(suggestions('apartment', 'renovation', text)).map(w => w.workId), ['paint']);
  const f = guidedFixture(); f.lots.reverse(); f.lots.forEach(l => l.subLots.forEach(s => s.works.reverse())); f.measurementTemplates.reverse();
  assert.deepEqual(buildGuidedCatalog(f, active), read());
  assert.equal(flatten(suggestions('house', 'renovation', '   ')).length, 3);
});

test('#578 model and professional limits are independent; geometry is not technical design', () => {
  const all = suggestGuidedWorks(read(), { usage: 'house', nature: 'construction' }).groups.flatMap(l => l.subLots.flatMap(s => s.works));
  const wall = all.find(w => w.workId === 'wall')!;
  assert.equal(wall.measurement.status, 'no_model'); assert.equal(wall.professional.status, 'study_required');
  assert.deepEqual(wall.rules[0].condition, { measurement_requested: true });
  const insulation = all.find(w => w.workId === 'insulation')!;
  assert.equal(insulation.measurement.status, 'dimensions_required'); assert.equal(insulation.professional.status, 'confirmation_required');
  assert.deepEqual(insulation.models[0].dimensions, [{ name: 'surface_area_m2', unitCode: 'm2', required: true }]);
  assert.equal(all.find(w => w.workId === 'paint')!.professional.status, 'not_documented');
  assert.ok(!/"(quantity|price|duration|result|value)":/.test(JSON.stringify(all)));
});

test('#578 absent dimensions / units / unsupported or mismatched formula never suggest calculability', () => {
  for (const inputSchema of [{}, { required: [] }, { required: ['unknown_dimension'] }]) {
    const f = guidedFixture(); f.measurementTemplates[0].inputSchema = inputSchema;
    const w = flatten(buildGuidedCatalog(f, active)).find(w => w.workId === 'paint')!;
    assert.equal(w.models[0].status, 'metadata_incomplete'); assert.ok(w.models[0].reason);
  }
  for (const formulaAst of [{ op: 'eval', code: '1' }, { op: 'identity', arg: 'missing_m2' }, { op: 'multiply', args: ['surface_area_m2', 'surface_area_m2'] }]) {
    const f = guidedFixture(); f.measurementTemplates[0].formulaAst = formulaAst;
    const result = suggestGuidedWorks(buildGuidedCatalog(f, active), { usage: 'house', nature: 'construction' });
    assert.equal(result.groups[0].subLots[0].works.find(w => w.workId === 'paint')!.measurement.status, 'not_calculable');
  }
});

test('#578 two occurrences of the same work; optional project sub-lot never removes canonical path', () => {
  const reference = flatten(read()).find(w => w.workId === 'paint')!;
  const items: GuidedProjectSelection[] = ['room-a', 'room-b'].map(projectWorkItemId => ({ projectWorkItemId, projectLotId: 'real-lot', projectSubLotId: null, selection: { kind: 'catalog', reference: structuredClone(reference) } }));
  assert.equal(items.length, 2); assert.notEqual(items[0].projectWorkItemId, items[1].projectWorkItemId);
  for (const item of items) if (item.selection.kind === 'catalog') {
    assert.equal(item.selection.reference.workId, 'paint'); assert.equal(item.selection.reference.path.subLot.id, 'surfaces');
  }
  const custom: GuidedProjectSelection = { projectWorkItemId: 'custom', projectLotId: 'real-lot', projectSubLotId: null, selection: { kind: 'custom', label: 'Besoin non catalogué', unitCode: null } };
  assert.equal(custom.selection.kind, 'custom');
  assert.ok(flatten(suggestions('house', 'renovation')).some(w => w.workId === reference.workId));
});

test('#578 version and unit history are preserved; no remapping by code or inference of retirement', () => {
  const reference = flatten(read()).find(w => w.workId === 'paint')!;
  const f = guidedFixture(); f.catalogVersion!.id = 'version-test-2'; f.catalogVersion!.code = 'TEST-2';
  f.lots[0].subLots[0].works[0].unitCode = 'm3'; f.measurementTemplates[0].outputUnitCode = 'm3';
  const result = compareGuidedReference(reference, buildGuidedCatalog(f, active));
  assert.equal(result.status, 'version_changed'); assert.equal(result.reference.unit.code, 'm2');
  assert.equal(result.reference.catalogVersion.code, 'TEST-1'); assert.equal(result.candidate!.unit.code, 'm3');
  const gone = guidedFixture(); gone.lots[0].subLots[0].works[0].id = 'new-id-same-code'; gone.dependencies = []; gone.measurementTemplates = [];
  assert.equal(compareGuidedReference(reference, buildGuidedCatalog(gone, active)).status, 'not_in_snapshot');
  const historical = buildGuidedCatalog(guidedFixture(), { kind: 'historical', retiredWorkIds: ['paint'] });
  assert.equal(compareGuidedReference(reference, historical).status, 'retired');
  assert.equal(flatten(suggestGuidedWorks(historical, { usage: 'house' })).length, 0);
  assert.equal(flatten(historical).find(w => w.workId === 'insulation')!.lifecycle, 'unknown');
  assert.deepEqual(reference, flatten(read()).find(w => w.workId === 'paint'));
});

test('#578 no aliases between provider, suggestions, or saved references', () => {
  const f = guidedFixture(), original = structuredClone(f), catalog = buildGuidedCatalog(f, active);
  const suggestions = suggestGuidedWorks(catalog, { usage: 'house', nature: 'renovation' });
  suggestions.groups[0].subLots[0].works[0].unit.symbol = 'CHANGED';
  assert.deepEqual(f, original); assert.deepEqual(catalog, read());
  const reference = flatten(catalog)[0]; const copy = compareGuidedReference(reference, catalog);
  copy.reference.label = 'CHANGED'; assert.notEqual(reference.label, 'CHANGED');
});

test('#578 empty snapshot and missing publication are explicit', () => {
  const f = guidedFixture(); f.lots = []; f.rules = []; f.dependencies = []; f.measurementTemplates = [];
  assert.equal(buildGuidedCatalog(f, active).state, 'empty'); f.catalogVersion = null;
  assert.equal(buildGuidedCatalog(f, active).state, 'no_catalog');
  assert.deepEqual(suggestGuidedWorks(buildGuidedCatalog(f, active), { usage: 'free' }).groups, []);
});

test('#578 malformed input, duplicates, foreign links, and conflicting lifecycle fail closed', () => {
  const corruptions: Array<(f: any) => void> = [
    f => { f.catalogVersion = undefined; }, f => { f.catalogVersion = null; },
    f => { f.lots = {}; }, f => { f.lots[0].subLots = null; }, f => { f.lots[0].subLots[0].works = null; },
    f => { f.lots[0].subLots[0].lotId = 'wrong'; }, f => { f.lots[0].subLots[0].works[0].subLotId = 'wrong'; },
    f => { f.lots.push(structuredClone(f.lots[0])); },
    f => { f.lots[1].code = f.lots[0].code; }, f => { f.units.push(f.units[0]); },
    f => { f.units[0].dimension = 'length'; }, f => { f.lots[0].catalogVersionId = 'other-version'; },
    f => { f.lots[0].subLots[0].works[0].unitCode = 'unknown'; },
    f => { f.lots[0].subLots[0].works[0].aliases = ['']; },
    f => { f.lots[0].subLots[0].works[0].sourceRef = ''; },
    f => { f.lots[0].projectTypes = ['small_work']; },
    f => { f.lots[0].projectTypes = []; },
    f => { f.rules[0].subjects = ['missing']; }, f => { f.dependencies[0].successorWorkId = 'missing'; },
    f => { f.rules[0].subjects = [f.rules[0].code]; },
    f => { f.measurementTemplates[0].workId = 'missing'; }, f => { f.measurementTemplates[0].outputUnitCode = 'm3'; },
    f => { f.measurementTemplates[0].inputSchema.required = ['a_m', 'a_m']; },
    f => { f.measurementTemplates[0].inputSchema.properties = { a_m: { type: 'string' } }; },
    f => { f.measurementTemplates[0].inputSchema['x-dao'].professionalConfirmation = 'false'; },
    f => { f.measurementTemplates[0].roundingScale = -1; },
  ];
  for (const corrupt of corruptions) { const f = guidedFixture(); corrupt(f); assert.throws(() => buildGuidedCatalog(f, active), GuidedCatalogError); }
  for (const raw of [null, [], '', {}, 1]) assert.throws(() => buildGuidedCatalog(raw, active), GuidedCatalogError);
  assert.throws(() => buildGuidedCatalog(guidedFixture(), { ...active, retiredWorkIds: ['paint'] }), /contradictoires/);
  assert.throws(() => buildGuidedCatalog(guidedFixture(), { kind: 'historical', retiredWorkIds: ['unknown'] }), /inconnu/);
  assert.throws(() => suggestGuidedWorks(read(), { usage: 'villa' } as never), /filtre invalide/);
});
