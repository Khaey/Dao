export type NativePlanningNode = {
  id: string;
  requestId: string;
  title: string;
  baselineStart: string | null;
  baselineEnd: string | null;
  durationDays: number | null;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  observedStart: string | null;
  observedEnd: string | null;
};

export type NativePlanningDependency = {
  id: string;
  from: string | null;
  to: string | null;
  state: 'effective' | 'awaiting_confirmation' | 'unresolved' | 'rejected';
  relation: string;
  lagDays: number;
};

export type NativeForecast = {
  state: 'none' | 'ready' | 'incomplete' | 'unsupported' | 'cycle';
  projectStart: string | null;
  projectEnd: string | null;
  durationDays: number | null;
  criticalPathIds: string[];
  incompleteNodeIds: string[];
  unsupportedDependencyIds: string[];
  unresolvedDependencyIds: string[];
  cycleNodeIds: string[];
  truncated: boolean;
  nodes: Array<{
    id: string;
    requestId: string;
    title: string;
    baselineStart: string | null;
    baselineEnd: string | null;
    projectedStart: string | null;
    projectedEnd: string | null;
    observedStart: string | null;
    observedEnd: string | null;
    startVarianceDays: number | null;
    finishVarianceDays: number | null;
    totalFloatDays: number | null;
    critical: boolean;
  }>;
};

const DAY_MS = 86_400_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function day(value: string): number | null {
  if (!DAY.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) return null;
  return Math.floor(time / DAY_MS);
}

function iso(value: number | null): string | null {
  return value === null ? null : new Date(value * DAY_MS).toISOString().slice(0, 10);
}

function duration(node: NativePlanningNode): number | null {
  // A DAO milestone has zero elapsed work but occupies its target calendar day in
  // the date projection, so it behaves as a one-day node for the CPM passes.
  if (node.durationDays !== null) return Number.isInteger(node.durationDays) && node.durationDays >= 0 ? Math.max(1, node.durationDays) : null;
  const startValue = node.plannedStart ?? node.baselineStart;
  const endValue = node.plannedEnd ?? node.baselineEnd;
  if (startValue === null || endValue === null) return null;
  const start = day(startValue); const end = day(endValue);
  return start === null || end === null || end < start ? null : end - start + 1;
}

const finish = (start: number, span: number) => start + Math.max(0, span - 1);

/** Compute one project-wide calendar-day FS/0 plan without supplying missing dates or durations. */
export function calculateNativeForecast(
  nodes: NativePlanningNode[],
  dependencies: NativePlanningDependency[],
): NativeForecast {
  const resultNodes = nodes.map(node => ({
    id: node.id, requestId: node.requestId, title: node.title,
    baselineStart: node.baselineStart, baselineEnd: node.baselineEnd,
    projectedStart: null as string | null, projectedEnd: null as string | null,
    observedStart: node.observedStart, observedEnd: node.observedEnd,
    startVarianceDays: null as number | null, finishVarianceDays: null as number | null,
    totalFloatDays: null as number | null, critical: false,
  }));
  const base = (state: NativeForecast['state'], extra: Partial<NativeForecast> = {}): NativeForecast => ({
    state, projectStart: null, projectEnd: null, durationDays: null, criticalPathIds: [],
    incompleteNodeIds: [], unsupportedDependencyIds: [], unresolvedDependencyIds: [], cycleNodeIds: [], truncated: false, nodes: resultNodes, ...extra,
  });
  if (!nodes.length) return base('none');

  const byId = new Map<string, NativePlanningNode>();
  for (const node of nodes) {
    if (!node.id || byId.has(node.id)) return base('unsupported', { incompleteNodeIds: [node.id] });
    if ((node.baselineStart !== null && day(node.baselineStart) === null)
      || (node.baselineEnd !== null && day(node.baselineEnd) === null)
      || (node.plannedStart != null && day(node.plannedStart) === null)
      || (node.plannedEnd != null && day(node.plannedEnd) === null)
      || (node.observedStart !== null && day(node.observedStart) === null)
      || (node.observedEnd !== null && day(node.observedEnd) === null)) {
      return base('unsupported', { incompleteNodeIds: [node.id] });
    }
    byId.set(node.id, node);
  }

  const effective = dependencies.filter(link => link.state === 'effective');
  const unsupportedDependencyIds = effective.filter(link => link.relation !== 'FS' || link.lagDays !== 0
    || !link.from || !link.to || !byId.has(link.from) || !byId.has(link.to)).map(link => link.id);
  if (unsupportedDependencyIds.length) return base('unsupported', { unsupportedDependencyIds });

  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const id of byId.keys()) { outgoing.set(id, []); incoming.set(id, []); indegree.set(id, 0); }
  const edgeIds = new Set<string>();
  for (const link of effective) {
    const edge = `${link.from}\0${link.to}`;
    if (edgeIds.has(edge)) return base('unsupported', { unsupportedDependencyIds: [link.id] });
    edgeIds.add(edge);
    outgoing.get(link.from!)!.push(link.to!);
    incoming.get(link.to!)!.push(link.from!);
    indegree.set(link.to!, indegree.get(link.to!)! + 1);
  }

  const queue = [...byId.keys()].filter(id => indegree.get(id) === 0).sort();
  const order: string[] = [];
  while (queue.length) {
    const current = queue.shift()!;
    order.push(current);
    for (const successor of outgoing.get(current)!) {
      indegree.set(successor, indegree.get(successor)! - 1);
      if (indegree.get(successor) === 0) { queue.push(successor); queue.sort(); }
    }
  }
  if (order.length !== nodes.length) {
    const cycleNodeIds = [...byId.keys()].filter(id => indegree.get(id)! > 0).sort();
    return base('cycle', { cycleNodeIds });
  }

  const spans = new Map<string, number | null>();
  const starts = new Map<string, number | null>();
  const ends = new Map<string, number | null>();
  const incomplete = new Set<string>();
  for (const id of order) {
    const node = byId.get(id)!;
    const span = duration(node);
    spans.set(id, span);
    const plannedStart = node.plannedStart ?? node.baselineStart;
    let earliest = plannedStart === null ? null : day(plannedStart);
    let blocked = false;
    const predecessors = incoming.get(id)!;
    for (const predId of predecessors) {
      const predEnd = ends.get(predId) ?? null;
      if (predEnd === null) { blocked = true; continue; }
      const after = predEnd + 1;
      earliest = earliest === null ? after : Math.max(earliest, after);
    }
    if (blocked) earliest = null;
    starts.set(id, earliest);
    if (earliest === null || span === null) {
      incomplete.add(id);
      ends.set(id, null);
    } else ends.set(id, finish(earliest, span));
  }

  for (const item of resultNodes) {
    const start = starts.get(item.id) ?? null;
    const end = ends.get(item.id) ?? null;
    item.projectedStart = iso(start); item.projectedEnd = iso(end);
    const baselineStart = item.baselineStart === null ? null : day(item.baselineStart);
    const baselineEnd = item.baselineEnd === null ? null : day(item.baselineEnd);
    item.startVarianceDays = start === null || baselineStart === null ? null : start - baselineStart;
    item.finishVarianceDays = end === null || baselineEnd === null ? null : end - baselineEnd;
  }
  if (incomplete.size) return base('incomplete', { incompleteNodeIds: [...incomplete].sort(), nodes: resultNodes });

  const projectStart = Math.min(...[...starts.values()].map(value => value!));
  const projectEnd = Math.max(...[...ends.values()].map(value => value!));
  const latestFinish = new Map<string, number>();
  const latestStart = new Map<string, number>();
  for (const id of [...order].reverse()) {
    const successors = outgoing.get(id)!;
    const latestEnd = successors.length
      ? Math.min(...successors.map(successor => latestStart.get(successor)! - 1))
      : projectEnd;
    const latestBegin = latestEnd - (Math.max(1, spans.get(id)!) - 1);
    latestFinish.set(id, latestEnd); latestStart.set(id, latestBegin);
    const totalFloat = latestBegin - starts.get(id)!;
    const target = resultNodes.find(item => item.id === id)!;
    target.totalFloatDays = totalFloat;
    target.critical = totalFloat === 0;
  }
  const criticalPathIds = resultNodes.filter(item => item.critical)
    .sort((a, b) => starts.get(a.id)! - starts.get(b.id)! || a.id.localeCompare(b.id)).map(item => item.id);
  return base('ready', {
    projectStart: iso(projectStart), projectEnd: iso(projectEnd), durationDays: projectEnd - projectStart + 1,
    criticalPathIds, nodes: resultNodes,
  });
}
