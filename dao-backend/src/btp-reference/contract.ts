export type BtpProjectType = 'construction' | 'renovation' | 'extension' | 'repair' | 'other';
export type BtpRelevance = 'usual' | 'conditional' | 'optional' | 'verify';

export type BtpUnit = { code:string; symbol:string; label:string; dimension:string; decimalScale:number };
export type BtpWork = { id:string; code:string; label:string; unitCode:string; relevance:BtpRelevance; projectTypes:BtpProjectType[]; aliases:string[]; requiredInputs:string[]; measurementNote:string; sourceRef:string };
export type BtpSubLot = { id:string; code:string; label:string; relevance:BtpRelevance; projectTypes:BtpProjectType[]; sourceRef:string; works:BtpWork[] };
export type BtpLot = { id:string; code:string; tradeId:string; label:string; relevance:BtpRelevance; projectTypes:BtpProjectType[]; sourceRef:string; subLots:BtpSubLot[] };
export type BtpCatalogSnapshot = {
  catalogVersion:{id:string;code:string;countryCode:string;regionCode:string|null;effectiveFrom:string;provenance:Record<string,unknown>}|null;
  units:BtpUnit[]; lots:BtpLot[];
  rules:Array<{id:string;code:string;type:string;severity:string;subjects:string[];condition:Record<string,unknown>;effect:Record<string,unknown>;explanation:string;sourceRef:string}>;
  dependencies:Array<{id:string;predecessorWorkId:string;successorWorkId:string;relationType:string;mandatory:boolean;applicability:Record<string,unknown>;explanation:string;sourceRef:string}>;
  measurementTemplates:Array<{id:string;workId:string;outputUnitCode:string;inputSchema:Record<string,unknown>;formulaAst:Record<string,unknown>;roundingScale:number;assumptions:string[];sourceRef:string}>;
  priceSources:Array<{id:string;name:string;sourceName:string;sourceUri:string;countryCode:string;regionCode:string|null;currency:string;validFrom:string;validTo:string|null;verifiedAt:string}>;
};
