import type { NativeExecutionActivityDTO, NativeExecutionPlanDTO } from './contract.js';
import { calculateNativeForecast, type NativeForecast, type NativePlanningDependency, type NativePlanningNode } from './planning.js';

type PlanPage = Pick<NativeExecutionPlanDTO, 'lots' | 'activities'> & Partial<Pick<NativeExecutionPlanDTO, 'dependencies'>>;
const shiftDay = (date: string | null, count: number | null) => {
  if (!date || count === null || !Number.isInteger(count) || count < 1) return null;
  const parsed = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(parsed) ? new Date(parsed + (count - 1) * 86_400_000).toISOString().slice(0, 10) : null;
};

/** Project-wide graph from pages already authorized by the caller's JWT. */
export function projectNativeForecast(pages: PlanPage[], truncated = false): NativeForecast {
  const nodes = new Map<string, NativePlanningNode>();
  const aliases = new Map<string, string>();
  const rawDependencies = new Map<string, Omit<NativePlanningDependency, 'from' | 'to'> & { from: string | null; to: string | null }>();
  const activities = new Map<string, NativeExecutionActivityDTO>();

  for (const page of pages) {
    for (const link of page.dependencies ?? []) {
      rawDependencies.set(link.id, { ...link, from: link.from, to: link.to });
    }
    for (const activity of page.activities.items) if (activity.active) activities.set(activity.id, activity);
    for (const lot of page.lots) {
      const id = `lot:${lot.requestId}`;
      const agreed = lot.dates.agreed;
      const planned = lot.dates.plan;
      const proposed = lot.dates.proposed;
      nodes.set(id, {
        id, requestId: lot.requestId, title: lot.title ?? id,
        baselineStart: agreed?.start ?? null,
        baselineEnd: shiftDay(agreed?.start ?? null, agreed?.durationDays ?? null),
        durationDays: agreed?.durationDays ?? null,
        plannedStart: planned?.start ?? proposed?.start ?? agreed?.start ?? null,
        plannedEnd: planned?.end ?? proposed?.end ?? shiftDay(planned?.start ?? proposed?.start ?? agreed?.start ?? null,
          planned?.start ? null : proposed?.start ? proposed?.durationDays ?? null : agreed?.durationDays ?? null),
        observedStart: lot.dates.observed?.start ?? null,
        observedEnd: lot.dates.observed?.end ?? null,
      });
      aliases.set(id, id);
      aliases.set(lot.requestId, id);
      for (const sublot of lot.executionSubLots) {
        const nodeId = `node:${sublot.id}`;
        nodes.set(nodeId, {
          id: nodeId, requestId: lot.requestId, title: sublot.title,
          baselineStart: sublot.agreedDates?.start ?? null,
          baselineEnd: sublot.agreedDates?.end ?? null,
          durationDays: sublot.agreedDates?.durationDays ?? sublot.proposedDates.durationDays,
          plannedStart: sublot.agreedDates?.start ?? sublot.proposedDates.start,
          plannedEnd: sublot.agreedDates?.end ?? sublot.proposedDates.end,
          observedStart: null, observedEnd: null,
        });
        aliases.set(nodeId, nodeId);
        aliases.set(sublot.id, nodeId);
        aliases.set(sublot.nodeKey, nodeId);
      }
      for (const link of lot.dependencies) {
        const id = link.id;
        // The project-level graph has already resolved native activity endpoints.
        // A lot-level projection can carry the same link with a null endpoint
        // (and state 'unresolved'). Never overwrite the authoritative link.
        if (rawDependencies.has(id)) continue;
        rawDependencies.set(id, {
          id,
          from: link.from,
          to: link.to,
          state: link.state as NativePlanningDependency['state'],
          relation: link.relation,
          lagDays: link.lagDays,
        });
      }
    }
  }

  for (const activity of activities.values()) {
    const id = `activity:${activity.id}`;
    nodes.set(id, {
      id, requestId: activity.requestId, title: activity.title,
      baselineStart: null, baselineEnd: null,
      durationDays: activity.plannedDates.durationDays,
      plannedStart: activity.plannedDates.start, plannedEnd: activity.plannedDates.end,
      observedStart: activity.execution?.observed?.start ?? null,
      observedEnd: activity.execution?.observed?.end ?? null,
    });
    aliases.set(id, id);
    aliases.set(activity.id, id);
  }

  const dependencies = [...rawDependencies.values()].map(link => ({
    ...link,
    from: link.from ? aliases.get(link.from) ?? link.from : null,
    to: link.to ? aliases.get(link.to) ?? link.to : null,
  }));

  const unresolvedDependencyIds = dependencies
    .filter(link => link.state === 'awaiting_confirmation' || link.state === 'unresolved')
    .map(link => link.id);
  const forecast = calculateNativeForecast([...nodes.values()], dependencies);
  if (unresolvedDependencyIds.length && forecast.state === 'ready') {
    forecast.state = 'incomplete';
    forecast.unresolvedDependencyIds = unresolvedDependencyIds.sort();
  }
  if (truncated) {
    forecast.state = 'incomplete';
    forecast.truncated = true;
    forecast.projectStart = null;
    forecast.projectEnd = null;
    forecast.durationDays = null;
    forecast.criticalPathIds = [];
    forecast.nodes = forecast.nodes.map(node => ({ ...node, critical: false, totalFloatDays: null }));
  }
  return forecast;
}
