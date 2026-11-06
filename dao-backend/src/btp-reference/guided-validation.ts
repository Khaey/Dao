import type { BtpCatalogSnapshot } from './contract.js';

/** Only a complete, single-version snapshot (RPC with p_project_type=null). */
export class GuidedCatalogError extends Error {
  constructor(readonly path: string, reason: string) { super(`${path}: ${reason}`); }
}
function check(ok: unknown, path: string, reason = 'schéma invalide'): asserts ok {
  if (!ok) throw new GuidedCatalogError(path, reason);
}
function record(v: unknown, p: string): asserts v is Record<string, any> {
  check(v !== null && typeof v === 'object' && !Array.isArray(v), p);
}
function text(v: unknown, p: string): asserts v is string { check(typeof v === 'string' && v.trim().length > 0, p); }
function array(v: unknown, p: string): asserts v is any[] { check(Array.isArray(v), p); }
function strings(v: unknown, p: string): asserts v is string[] {
  array(v, p); v.forEach((s, i) => text(s, `${p}[${i}]`));
  check(new Set(v).size === v.length, p, 'doublon');
}
const natures = ['construction', 'renovation', 'extension', 'repair', 'other'];
const relevances = ['usual', 'conditional', 'optional', 'verify'];

/** Validate the consulted fields, not pricing (which is never returned). No repair/coercion. */
export function validateGuidedSnapshot(raw: unknown): asserts raw is BtpCatalogSnapshot {
  record(raw, 'snapshot');
  for (const key of ['units', 'lots', 'rules', 'dependencies', 'measurementTemplates']) array(raw[key], key);
  if (raw.catalogVersion === null) {
    check(['lots', 'rules', 'dependencies', 'measurementTemplates'].every(k => raw[k].length === 0), 'catalogVersion', 'version absente avec contenu');
    return;
  }
  record(raw.catalogVersion, 'catalogVersion');
  for (const k of ['id', 'code', 'countryCode', 'effectiveFrom']) text(raw.catalogVersion[k], `catalogVersion.${k}`);
  check(raw.catalogVersion.regionCode === null || typeof raw.catalogVersion.regionCode === 'string', 'catalogVersion.regionCode');
  record(raw.catalogVersion.provenance, 'catalogVersion.provenance');
  const ids = new Set<string>(), codes = new Set<string>(), units = new Set<string>();
  const workUnits = new Map<string, string>();
  const unique = (set: Set<string>, value: string, p: string) => { check(!set.has(value), p, 'doublon'); set.add(value); };
  const identified = (v: any, p: string, code = true) => {
    record(v, p); text(v.id, `${p}.id`); unique(ids, v.id, `${p}.id`);
    check(v.catalogVersionId === undefined || v.catalogVersionId === raw.catalogVersion.id, `${p}.catalogVersionId`, 'version incompatible');
    if (code) { text(v.code, `${p}.code`); unique(codes, v.code, `${p}.code`); }
    text(v.sourceRef, `${p}.sourceRef`);
  };
  const node = (v: any, p: string) => {
    identified(v, p); text(v.label, `${p}.label`); strings(v.projectTypes, `${p}.projectTypes`);
    check(v.projectTypes.length && v.projectTypes.every((t: string) => natures.includes(t)), `${p}.projectTypes`);
    check(relevances.includes(v.relevance), `${p}.relevance`);
  };
  raw.units.forEach((u: any, i: number) => {
    const p = `units[${i}]`; record(u, p);
    for (const k of ['code', 'symbol', 'label', 'dimension']) text(u[k], `${p}.${k}`);
    const dimensions: Record<string, string> = { m: 'length', m2: 'area', m3: 'volume', unit: 'count', kg: 'mass', hour: 'time', package: 'package' };
    check(['length', 'area', 'volume', 'count', 'mass', 'time', 'package'].includes(u.dimension), `${p}.dimension`);
    check(!(u.code in dimensions) || dimensions[u.code] === u.dimension, `${p}.dimension`, 'dimension incompatible');
    check(Number.isInteger(u.decimalScale) && u.decimalScale >= 0 && u.decimalScale <= 6, `${p}.decimalScale`);
    unique(units, u.code, `${p}.code`);
  });
  raw.lots.forEach((lot: any, i: number) => {
    const p = `lots[${i}]`; node(lot, p); text(lot.tradeId, `${p}.tradeId`); array(lot.subLots, `${p}.subLots`);
    lot.subLots.forEach((sub: any, j: number) => {
      const q = `${p}.subLots[${j}]`; node(sub, q); array(sub.works, `${q}.works`);
      // The RPC expresses parentage by nesting. Reject contradictory explicit links too.
      check(sub.lotId === undefined || sub.lotId === lot.id, `${q}.lotId`, 'parent incompatible');
      sub.works.forEach((work: any, k: number) => {
        const r = `${q}.works[${k}]`; node(work, r);
        check(work.subLotId === undefined || work.subLotId === sub.id, `${r}.subLotId`, 'parent incompatible');
        check(units.has(work.unitCode), `${r}.unitCode`, 'unité inconnue');
        strings(work.aliases, `${r}.aliases`); strings(work.requiredInputs, `${r}.requiredInputs`);
        check(typeof work.measurementNote === 'string', `${r}.measurementNote`);
        workUnits.set(work.id, work.unitCode);
      });
    });
  });
  const hierarchyCodes = new Set(codes);
  raw.rules.forEach((r: any, i: number) => {
    const p = `rules[${i}]`; identified(r, p);
    for (const k of ['type', 'severity', 'explanation']) text(r[k], `${p}.${k}`);
    strings(r.subjects, `${p}.subjects`);
    check(r.subjects.length && r.subjects.every((c: string) => hierarchyCodes.has(c)), `${p}.subjects`, 'lien inconnu (snapshot complet requis)');
    record(r.condition, `${p}.condition`); record(r.effect, `${p}.effect`);
  });
  raw.dependencies.forEach((d: any, i: number) => {
    const p = `dependencies[${i}]`; identified(d, p, false);
    check(workUnits.has(d.predecessorWorkId) && workUnits.has(d.successorWorkId) && d.predecessorWorkId !== d.successorWorkId, p, 'lien ouvrage invalide');
    check(typeof d.mandatory === 'boolean', `${p}.mandatory`);
    text(d.relationType, `${p}.relationType`); text(d.explanation, `${p}.explanation`); record(d.applicability, `${p}.applicability`);
  });
  raw.measurementTemplates.forEach((t: any, i: number) => {
    const p = `measurementTemplates[${i}]`; identified(t, p, false);
    check(workUnits.has(t.workId), `${p}.workId`, 'ouvrage inconnu');
    check(units.has(t.outputUnitCode) && workUnits.get(t.workId) === t.outputUnitCode, `${p}.outputUnitCode`, 'unité incompatible');
    check(Number.isInteger(t.roundingScale) && t.roundingScale >= 0 && t.roundingScale <= 6, `${p}.roundingScale`);
    strings(t.assumptions, `${p}.assumptions`); record(t.inputSchema, `${p}.inputSchema`); record(t.formulaAst, `${p}.formulaAst`);
    const schema = t.inputSchema;
    if (schema.required !== undefined) strings(schema.required, `${p}.inputSchema.required`);
    if (schema.properties !== undefined) {
      record(schema.properties, `${p}.inputSchema.properties`);
      for (const [name, value] of Object.entries(schema.properties)) {
        const q = `${p}.inputSchema.properties.${name}`; text(name, q); record(value, q);
        if (value.type !== undefined) check(value.type === 'number', `${q}.type`);
        if (value.minimum !== undefined) check(typeof value.minimum === 'number' && Number.isFinite(value.minimum), `${q}.minimum`);
        for (const k of ['title', 'description']) if (value[k] !== undefined) text(value[k], `${q}.${k}`);
      }
    }
    if (schema['x-dao'] !== undefined) {
      record(schema['x-dao'], `${p}.inputSchema.x-dao`);
      const v = schema['x-dao'].professionalConfirmation;
      check(v === undefined || typeof v === 'boolean', `${p}.inputSchema.x-dao.professionalConfirmation`);
    }
  });
}
