export type TakeoffSourceKind = 'manual' | 'document' | 'survey' | 'bim_import';

export type TakeoffInput = {
  value: string;
  unit: string;
  source: { kind: TakeoffSourceKind; reference: string };
};
export type TakeoffTemplate = {
  catalogVersionId: string;
  catalogVersionCode: string;
  workId: string;
  workCode: string;
  workLabel: string;
  templateId: string;
  outputUnitCode: 'm' | 'm2' | 'm3' | 'unit';
  inputSchema: { required?: string[]; properties?: Record<string, { type?: string; minimum?: number }> };
  formulaAst: Record<string, unknown>;
  roundingScale: number;
  assumptions: string[];
  sourceRef: string;
};

export type CanonicalTakeoffInput = TakeoffInput & {
  original: { value: string; unit: string };
};

export type TakeoffEvaluation = {
  status: 'insufficient_data' | 'calculated';
  canonicalInputs: Record<string, CanonicalTakeoffInput>;
  missingFields: string[];
  questions: string[];
  rawResult?: string;
  result?: { value: string; unit: string; roundingScale: number };
  steps: Array<Record<string, unknown>>;
};
