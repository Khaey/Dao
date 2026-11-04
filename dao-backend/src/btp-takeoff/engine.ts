import { DomainError } from '../lib/errors.js';
import type { CanonicalTakeoffInput, TakeoffEvaluation, TakeoffInput, TakeoffTemplate } from './contract.js';

const DECIMAL = /^(0|[1-9]\d{0,8})(?:\.(\d{1,6}))?$/;
const POW10 = (n: number) => BigInt(10) ** BigInt(n);

class ExactDecimal {
  constructor(readonly coefficient: bigint, readonly scale: number) {}
  static parse(value: string) {
    const match = DECIMAL.exec(value);
    if (!match) throw new DomainError('Valeur de dimension invalide', 'BAD_REQUEST');
    const fraction = match[2] ?? '';
    return new ExactDecimal(BigInt(value.replace('.', '')), fraction.length).normalized();
  }
  normalized() {
    let coefficient = this.coefficient; let scale = this.scale;
    while (scale > 0 && coefficient % BigInt(10) === BigInt(0)) { coefficient /= BigInt(10); scale--; }
    return new ExactDecimal(coefficient, scale);
  }
  multiply(other: ExactDecimal) { return new ExactDecimal(this.coefficient * other.coefficient, this.scale + other.scale).normalized(); }
  subtract(other: ExactDecimal) {
    const scale = Math.max(this.scale, other.scale);
    return new ExactDecimal(this.coefficient * POW10(scale - this.scale) - other.coefficient * POW10(scale - other.scale), scale).normalized();
  }
  round(scale: number) {
    if (this.scale <= scale) return this;
    const divisor = POW10(this.scale - scale);
    const quotient = this.coefficient / divisor;
    const remainder = this.coefficient % divisor;
    return new ExactDecimal(quotient + (remainder * BigInt(2) >= divisor ? BigInt(1) : BigInt(0)), scale).normalized();
  }
  isNegative() { return this.coefficient < BigInt(0); }
  isZero() { return this.coefficient === BigInt(0); }
  toString() {
    const sign = this.coefficient < 0 ? '-' : '';
    const digits = (this.coefficient < 0 ? -this.coefficient : this.coefficient).toString().padStart(this.scale + 1, '0');
    if (!this.scale) return sign + digits;
    return `${sign}${digits.slice(0, -this.scale)}.${digits.slice(-this.scale)}`;
  }
}
const unitConversions: Record<string, { canonical: string; factor: string }> = {
  mm: { canonical: 'm', factor: '0.001' }, cm: { canonical: 'm', factor: '0.01' }, m: { canonical: 'm', factor: '1' },
  mm2: { canonical: 'm2', factor: '0.000001' }, cm2: { canonical: 'm2', factor: '0.0001' }, m2: { canonical: 'm2', factor: '1' },
  cm3: { canonical: 'm3', factor: '0.000001' }, l: { canonical: 'm3', factor: '0.001' }, m3: { canonical: 'm3', factor: '1' },
  unit: { canonical: 'unit', factor: '1' },
};

export function expectedInputUnit(name: string) {
  if (name.endsWith('_m3')) return 'm3';
  if (name.endsWith('_m2')) return 'm2';
  if (name.endsWith('_m')) return 'm';
  if (name.endsWith('_count')) return 'unit';
  throw new DomainError(`Unité canonique inconnue pour ${name}`, 'BAD_REQUEST');
}

function normalize(name: string, input: TakeoffInput): CanonicalTakeoffInput {
  if (!input || typeof input !== 'object' || typeof input.value !== 'string' || typeof input.unit !== 'string'
    || !input.source || !['manual','document','survey','bim_import'].includes(input.source.kind)
    || typeof input.source.reference !== 'string' || !input.source.reference.trim() || input.source.reference.trim().length > 300) {
    throw new DomainError(`Entrée invalide pour ${name}`, 'BAD_REQUEST');
  }
  const conversion = unitConversions[input.unit];
  const expected = expectedInputUnit(name);
  if (!conversion || conversion.canonical !== expected) throw new DomainError(`Unité incompatible pour ${name}`, 'BAD_REQUEST');
  const original = ExactDecimal.parse(input.value);
  const value = original.multiply(ExactDecimal.parse(conversion.factor));
  return { value: value.toString(), unit: expected, source: { kind: input.source.kind, reference: input.source.reference.trim() }, original: { value: input.value, unit: input.unit } };
}

function evaluateNode(node: any, inputs: Record<string, CanonicalTakeoffInput>, steps: Array<Record<string, unknown>>): { value: ExactDecimal; dimension: string } {
  if (!node || typeof node !== 'object') throw new DomainError('Formule de métré invalide', 'BAD_REQUEST');
  if (node.op === 'identity') {
    const field = String(node.arg ?? ''); const input = inputs[field];
    if (!input) throw new DomainError(`Entrée manquante pour ${field}`, 'BAD_REQUEST');
    const result = { value: ExactDecimal.parse(input.value), dimension: input.unit };
    steps.push({ op: 'identity', field, value: result.value.toString(), unit: result.dimension });
    return result;
  }
  if (node.op === 'multiply') {
    if (!Array.isArray(node.args) || node.args.length < 2 || node.args.length > 3) throw new DomainError('Multiplication non supportée', 'BAD_REQUEST');
    let value = ExactDecimal.parse('1'); let dimension = 'scalar';
    for (const argument of node.args) {
      const child = typeof argument === 'string'
        ? { value: ExactDecimal.parse(inputs[argument]?.value ?? ''), dimension: inputs[argument]?.unit ?? '' }
        : evaluateNode(argument, inputs, steps);
      value = value.multiply(child.value);
      dimension = dimension === 'scalar' ? child.dimension
        : dimension === 'm' && child.dimension === 'm' ? 'm2'
        : dimension === 'm2' && child.dimension === 'm' ? 'm3' : '';
      if (!dimension) throw new DomainError('Dimensions incompatibles dans la formule', 'BAD_REQUEST');
    }
    steps.push({ op: 'multiply', value: value.toString(), unit: dimension });
    return { value, dimension };
  }
  if (node.op === 'subtract') {
    if (!Array.isArray(node.args) || node.args.length !== 2) throw new DomainError('Soustraction non supportée', 'BAD_REQUEST');
    const resolve = (argument: unknown) => typeof argument === 'string'
      ? { value: ExactDecimal.parse(inputs[argument]?.value ?? ''), dimension: inputs[argument]?.unit ?? '' }
      : evaluateNode(argument, inputs, steps);
    const left = resolve(node.args[0]); const right = resolve(node.args[1]);
    const value = left.value.subtract(right.value);
    if (left.dimension !== right.dimension || value.isNegative()) throw new DomainError('Déduction supérieure à la quantité brute ou unité incompatible', 'BAD_REQUEST');
    steps.push({ op: 'subtract', left: left.value.toString(), right: right.value.toString(), value: value.toString(), unit: left.dimension });
    return { value, dimension: left.dimension };
  }
  throw new DomainError('Opération de formule non supportée', 'BAD_REQUEST');
}

export function evaluateTakeoff(template: TakeoffTemplate, rawInputs: Record<string, TakeoffInput>): TakeoffEvaluation {
  if (!rawInputs || Array.isArray(rawInputs) || typeof rawInputs !== 'object') throw new DomainError('Entrées de métré invalides', 'BAD_REQUEST');
  const required = Array.isArray(template.inputSchema?.required) ? template.inputSchema.required : [];
  // Some V1 catalogue templates only declare `required` (the masonry seed is
  // one). Required names are therefore also the authoritative allow-list.
  const allowed = new Set([...required, ...Object.keys(template.inputSchema?.properties ?? {})]);
  if (!required.length || Object.keys(rawInputs).some(key => !allowed.has(key))) throw new DomainError('Entrée de métré non supportée', 'BAD_REQUEST');
  const canonicalInputs: Record<string, CanonicalTakeoffInput> = {};
  for (const [name, input] of Object.entries(rawInputs)) canonicalInputs[name] = normalize(name, input);
  const missingFields = required.filter(name => !canonicalInputs[name]);
  const questions = missingFields.map(name => `Renseignez ${name} en ${expectedInputUnit(name)} avec sa provenance.`);
  const steps: Array<Record<string, unknown>> = Object.entries(canonicalInputs).map(([field,input])=>({
    op:'convert',field,from:input.original,to:{value:input.value,unit:input.unit},source:input.source,
  }));
  if (missingFields.length) return { status: 'insufficient_data', canonicalInputs, missingFields, questions, steps };
  const evaluated = evaluateNode(template.formulaAst, canonicalInputs, steps);
  if (evaluated.dimension !== template.outputUnitCode || evaluated.value.isZero()) throw new DomainError('Résultat de métré invalide', 'BAD_REQUEST');
  const rounded = evaluated.value.round(template.roundingScale);
  return { status: 'calculated', canonicalInputs, missingFields: [], questions: [], rawResult: evaluated.value.toString(),
    result: { value: rounded.toString(), unit: template.outputUnitCode, roundingScale: template.roundingScale }, steps };
}
