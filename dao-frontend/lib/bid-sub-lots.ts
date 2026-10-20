// #325 — sous-lots PROPOSÉS par l'Artisan dans son offre et liens techniques proposés.
// Aucune date, durée ni dépendance n'est inventée : tout ce qui part vers le serveur a été saisi par l'Artisan.
// L'attribution reste par LOT ; ces données ne créent ni award, ni contrat, ni planning effectif.

export type SubLotDraft = { key: string; title: string; scope: string; start: string; end: string; budget: string; officialId: string };
export type LinkEndpointKind = 'proposal' | 'official_sub_lot' | 'lot';
export type LinkDraft = { predKind: LinkEndpointKind; predRef: string; succKind: LinkEndpointKind; succRef: string };
export type Referent = { kind: 'lot' | 'official_sub_lot'; ref: string; label: string; lot_ref: string };

export const emptySubLot = (): SubLotDraft => ({ key: crypto.randomUUID(), title: '', scope: '', start: '', end: '', budget: '', officialId: '' });

/** "12,5" / "12.500" -> millimes (null when not a valid non-negative TND amount with at most 3 decimals). */
export function tndToMillimes(value: string): number | null {
  const match = value.trim().replace(',', '.').match(/^(\d+)(?:\.(\d{0,3}))?$/);
  if (!match) return null;
  return Number(BigInt(match[1]) * BigInt(1000) + BigInt((match[2] ?? '').padEnd(3, '0')));
}

/** Inclusive number of days between two ISO dates (null when incomplete or inverted). */
export function inclusiveDays(start: string, end: string): number | null {
  if (!start || !end) return null;
  const a = Date.parse(`${start}T00:00:00Z`), b = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / 86400000) + 1;
}

/** Human-readable problem with a lot's sub-lots, or null when they can be sent. `priceMillimes` is the lot price of the offer. */
export function subLotsProblem(items: SubLotDraft[], priceMillimes: number | null): string | null {
  if (items.length > 100) return 'Au plus 100 sous-lots par lot.';
  let total = 0;
  for (const [index, item] of items.entries()) {
    const label = `Sous-lot ${index + 1}`;
    if (!item.title.trim()) return `${label} : le titre est obligatoire.`;
    if (item.title.trim().length > 200) return `${label} : titre trop long (200 caractères maximum).`;
    if (item.scope.length > 4000) return `${label} : périmètre trop long (4000 caractères maximum).`;
    if (Boolean(item.start) !== Boolean(item.end)) return `${label} : renseignez les deux dates (début et fin) ou aucune.`;
    if (item.start && inclusiveDays(item.start, item.end) === null) return `${label} : la fin précède le début.`;
    if (item.budget.trim()) {
      const budget = tndToMillimes(item.budget);
      if (budget === null) return `${label} : budget invalide (TND, 3 décimales maximum).`;
      total += budget;
    }
  }
  if (priceMillimes !== null && total > priceMillimes) return 'La somme des budgets des sous-lots dépasse le prix proposé pour ce lot.';
  return null;
}

export function subLotsPayload(items: SubLotDraft[]) {
  return items.map((item) => ({
    node_key: item.key,
    title: item.title.trim(),
    scope: item.scope.trim() || null,
    start_date: item.start || null,
    end_date: item.end || null,
    duration_days: inclusiveDays(item.start, item.end),
    budget_millimes: item.budget.trim() ? tndToMillimes(item.budget) : null,
    official_sub_lot_id: item.officialId || null,
  }));
}

export function linksPayload(links: LinkDraft[]) {
  return links.map((link) => ({ pred_kind: link.predKind, pred_ref: link.predRef, succ_kind: link.succKind, succ_ref: link.succRef }));
}

/** Local mirror of the server rules, to give a clear message before the round trip (the server stays the authority). */
export function linksProblem(links: LinkDraft[], knownProposalKeys: Set<string>): string | null {
  const seen = new Set<string>();
  for (const link of links) {
    if (!link.predRef || !link.succRef) return 'Chaque lien doit avoir un prédécesseur et un successeur.';
    if (link.predKind === link.succKind && link.predRef === link.succRef) return 'Un sous-lot ne peut pas dépendre de lui-même.';
    if (link.predKind !== 'proposal' && link.succKind !== 'proposal') return 'Un lien doit partir de l’un de vos sous-lots ou y arriver.';
    if ((link.predKind === 'proposal' && !knownProposalKeys.has(link.predRef)) || (link.succKind === 'proposal' && !knownProposalKeys.has(link.succRef)))
      return 'Un lien pointe vers un sous-lot qui n’existe plus.';
    const id = `${link.predKind}:${link.predRef}>${link.succKind}:${link.succRef}`;
    if (seen.has(id)) return 'Ce lien est en double.';
    seen.add(id);
  }
  const from: string[] = [], to: string[] = [];
  for (const link of links) { from.push(`${link.predKind}:${link.predRef}`); to.push(`${link.succKind}:${link.succRef}`); }
  return hasCycle(from, to) ? 'Ces liens forment une boucle : un sous-lot ne peut pas dépendre, même indirectement, de lui-même.' : null;
}

/** Same algorithm as dao_private.edges_have_cycle: strip sources until nothing is left or only a cycle remains. */
export function hasCycle(from: string[], to: string[]): boolean {
  let f = [...from], t = [...to];
  while (f.length > 0) {
    const keepF: string[] = [], keepT: string[] = [];
    for (let i = 0; i < f.length; i++) if (t.includes(f[i])) { keepF.push(f[i]); keepT.push(t[i]); }
    if (keepF.length === f.length) return true;
    f = keepF; t = keepT;
  }
  return false;
}
