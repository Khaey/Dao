import type { BtpCatalogSnapshot, BtpProjectType, BtpRelevance } from '../../btp-reference/contract.js';
import { BTP_REFERENTIAL_CONTRACT_VERSION, PROJECT_KINDS, type Applicability, type BtpReferentialPort, type ProjectKind, type ReferentialItem, type ReferentialQuery, type ReferentialSnapshot } from './contract.js';

type Db = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: any; error: any }>;
  from(table: string): { select(columns: string): PromiseLike<{ data: any; error: any }> };
};

const applicability = (types: BtpProjectType[], relevance: BtpRelevance): Applicability[] =>
  types.filter((t): t is ProjectKind => (PROJECT_KINDS as readonly string[]).includes(t)).map(projectKind => ({ projectKind, relevance }));

/**
 * Adaptateur vers le référentiel publié par DEV 5 (#541, RPC `btp_catalog_snapshot`).
 * Seul point de couplage entre l'assistant et le schéma du référentiel.
 */
export function mapDaoCatalog(catalog: BtpCatalogSnapshot, tradeCodes: Map<string, string>): ReferentialSnapshot {
  const version = catalog.catalogVersion!;
  const provenance = version.provenance as Record<string, unknown>;
  const label = typeof provenance?.label === 'string' ? provenance.label : 'Référentiel BTP D.A.O.';
  const verifiedOn = typeof provenance?.verified_on === 'string' ? provenance.verified_on : null;
  const source = (ref: string) => ({ source: `${label}${ref ? ` — ${ref}` : ''}`.slice(0, 200), version: version.code, verifiedOn });
  const items: ReferentialItem[] = [];
  for (const lot of catalog.lots) {
    items.push({ id: lot.id, code: lot.code, kind: 'lot', parentId: null, label: lot.label, tradeCode: tradeCodes.get(lot.tradeId) ?? null,
      unit: null, applicability: applicability(lot.projectTypes, lot.relevance), keywords: [], status: 'published', provenance: source(lot.sourceRef) });
    for (const sub of lot.subLots) {
      items.push({ id: sub.id, code: sub.code, kind: 'sub_lot', parentId: lot.id, label: sub.label, tradeCode: null, unit: null,
        applicability: applicability(sub.projectTypes, sub.relevance), keywords: [], status: 'published', provenance: source(sub.sourceRef) });
      for (const work of sub.works) {
        items.push({ id: work.id, code: work.code, kind: 'work', parentId: sub.id, label: work.label, description: work.measurementNote,
          tradeCode: null, unit: work.unitCode, applicability: applicability(work.projectTypes, work.relevance), keywords: work.aliases ?? [],
          status: 'published', provenance: source(work.sourceRef) });
      }
    }
  }
  return { contractVersion: BTP_REFERENTIAL_CONTRACT_VERSION, provider: 'dao-referential', catalogVersion: version.code,
    countryCode: version.countryCode, completeness: 'partial', items: items.filter(item => item.applicability.length) };
}

export class DaoReferentialProvider implements BtpReferentialPort {
  constructor(private readonly db: Db) {}
  async snapshot(query: ReferentialQuery): Promise<ReferentialSnapshot> {
    const [{ data, error }, trades] = await Promise.all([
      this.db.rpc('btp_catalog_snapshot', { p_project_type: null, p_country_code: query.countryCode }),
      this.db.from('trades').select('id,code'),
    ]);
    if (error || trades.error) throw error ?? trades.error;
    if (!data?.catalogVersion) throw new Error('referential not published');
    return mapDaoCatalog(data as BtpCatalogSnapshot, new Map((trades.data ?? []).map((t: any) => [t.id, t.code])));
  }
}
