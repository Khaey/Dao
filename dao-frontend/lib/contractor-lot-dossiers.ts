/**
 * Read-only grouping of active awarded lots for a single chantier (#381).
 *
 * An award remains the authoritative commercial record per lot. These groups
 * are presentation/contract-preparation dossiers, NOT signed contracts or
 * automatic grants of project membership. The caller must first enforce
 * Client/contractor authorisation and exclude cancelled award items.
 */
export type AwardedLotForDossier = {
  projectId: string;
  requestId: string;
  awardId: string;
  contractorId: string;
  agreedMillimes: number;
};

export type ContractorLotDossier = {
  projectId: string;
  contractorId: string;
  lotIds: string[];
  awardIds: string[];
  totalMillimes: number;
  /** This data alone cannot establish a contract or signature. */
  contractStatus: 'not_prepared';
};

export function groupAwardedLotsByContractor(
  projectId: string,
  awardedLots: readonly AwardedLotForDossier[],
): ContractorLotDossier[] {
  const groups = new Map<string, { lots: Map<string, AwardedLotForDossier>; awards: Set<string> }>();
  const seenLotIds = new Set<string>();
  for (const lot of awardedLots) {
    if (lot.projectId !== projectId) throw new Error('Cross-project award grouping is forbidden');
    if (!lot.requestId || !lot.awardId || !lot.contractorId) throw new Error('Incomplete award identity');
    if (!Number.isSafeInteger(lot.agreedMillimes) || lot.agreedMillimes < 0) {
      throw new Error('Invalid award amount in millimes');
    }
    if (seenLotIds.has(lot.requestId)) throw new Error('Multiple active awards for the same lot');
    seenLotIds.add(lot.requestId);
    let group = groups.get(lot.contractorId);
    if (!group) {
      group = { lots: new Map(), awards: new Set() };
      groups.set(lot.contractorId, group);
    }
    if (group.lots.has(lot.requestId)) throw new Error('Ambiguous active awards for the same lot and contractor');
    group.lots.set(lot.requestId, lot);
    group.awards.add(lot.awardId);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([contractorId, group]) => {
    const lots = [...group.lots.values()].sort((a, b) => a.requestId.localeCompare(b.requestId));
    const total = lots.reduce((sum, lot) => {
      const result = sum + lot.agreedMillimes;
      if (!Number.isSafeInteger(result)) throw new Error('Award totals exceed safe millimes precision');
      return result;
    }, 0);
    return {
      projectId,
      contractorId,
      lotIds: lots.map(lot => lot.requestId),
      awardIds: [...group.awards].sort(),
      totalMillimes: total,
      contractStatus: 'not_prepared' as const,
    };
  });
}
