/**
 * #419 — Modèle de LECTURE du Gantt natif. Il ne calcule aucun planning : les dates projetées,
 * marges et chemin critique viennent du `forecast` natif DEV 3 (#413) ; à défaut, seules les dates
 * réellement enregistrées sont placées, avec leur provenance. Aucune date ni progression inventée.
 */
import type { NativeExecutionPlanDTO } from '../../../dao-backend/src/native-tracking/contract';

export type GanttSpan = { start: string; end: string };
export type GanttBarSource = 'projected' | 'recorded';
export type GanttRowKind = 'lot' | 'sub_lot' | 'activity';
export interface GanttMilestone { key: string; title: string; date: string | null; status: string }
export interface GanttRow {
  id: string;
  kind: GanttRowKind;
  level: number;
  requestId: string;
  title: string;
  contractor: string | null;
  bar: (GanttSpan & { source: GanttBarSource; sourceLabel: string }) | null;
  baseline: GanttSpan | null;
  observed: GanttSpan | null;
  progress: { percent: number; at: string } | null;
  critical: boolean;
  floatDays: number | null;
  finishVarianceDays: number | null;
  incomplete: boolean;
  inCycle: boolean;
  milestones: GanttMilestone[];
}
export interface GanttDependency { id: string; from: string; to: string; state: string; supported: boolean }
export interface GanttModel {
  rows: GanttRow[];
  dependencies: GanttDependency[];
  forecastState: NonNullable<NativeExecutionPlanDTO['forecast']>['state'] | 'unavailable';
  projectStart: string | null;
  projectEnd: string | null;
  durationDays: number | null;
  truncated: boolean;
  range: GanttSpan | null;
  undatedCount: number;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
export const toDay = (value: string) => Math.floor(Date.parse(value.slice(0, 10) + 'T00:00:00Z') / DAY_MS);
export const fromDay = (value: number) => new Date(value * DAY_MS).toISOString().slice(0, 10);
const valid = (value: string | null | undefined): value is string => Boolean(value && DAY.test(value.slice(0, 10)) && Number.isFinite(toDay(value)));
const span = (start: string | null | undefined, end: string | null | undefined): GanttSpan | null =>
  valid(start) && valid(end) && toDay(end) >= toDay(start) ? { start: start.slice(0, 10), end: end.slice(0, 10) } : null;
/** Fin déduite seulement d'une durée enregistrée (jours calendaires inclusifs), comme le moteur natif. */
const fromDuration = (start: string | null | undefined, days: number | null | undefined) =>
  valid(start) && days != null && Number.isInteger(days) && days >= 1 ? span(start, fromDay(toDay(start) + days - 1)) : null;

export function buildGanttModel(plan: NativeExecutionPlanDTO): GanttModel {
  const forecast = plan.forecast;
  const forecastNodes = new Map((forecast?.nodes ?? []).map(node => [node.id, node]));
  const incomplete = new Set(forecast?.incompleteNodeIds ?? []);
  const cycle = new Set(forecast?.cycleNodeIds ?? []);
  const aliases = new Map<string, string>();
  const rows: GanttRow[] = [];

  const row = (id: string, base: Omit<GanttRow, 'id' | 'bar' | 'baseline' | 'observed' | 'critical' | 'floatDays' | 'finishVarianceDays' | 'incomplete' | 'inCycle'>,
    recorded: { value: GanttSpan | null; label: string }, observed: GanttSpan | null): GanttRow => {
    const node = forecastNodes.get(id);
    const projected = node ? span(node.projectedStart, node.projectedEnd) : null;
    return {
      id, ...base,
      bar: projected ? { ...projected, source: 'projected', sourceLabel: 'Prévision native' }
        : recorded.value ? { ...recorded.value, source: 'recorded', sourceLabel: recorded.label } : null,
      baseline: node ? span(node.baselineStart, node.baselineEnd) : null,
      observed: (node ? span(node.observedStart, node.observedEnd) : null) ?? observed,
      critical: forecast?.state === 'ready' && Boolean(node?.critical),
      floatDays: forecast?.state === 'ready' ? node?.totalFloatDays ?? null : null,
      finishVarianceDays: node?.finishVarianceDays ?? null,
      incomplete: incomplete.has(id),
      inCycle: cycle.has(id),
    };
  };

  const activities = (plan.activities?.items ?? []).filter(item => item.active).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  for (const lot of plan.lots.filter(item => item.permissions.canRead)) {
    const lotId = `lot:${lot.requestId}`;
    aliases.set(lot.requestId, lotId); aliases.set(lotId, lotId);
    const planDates = span(lot.dates.plan?.start, lot.dates.plan?.end);
    const proposed = span(lot.dates.proposed?.start, lot.dates.proposed?.end) ?? fromDuration(lot.dates.proposed?.start, lot.dates.proposed?.durationDays);
    const agreed = fromDuration(lot.dates.agreed?.start, lot.dates.agreed?.durationDays);
    rows.push(row(lotId, {
      kind: 'lot', level: 0, requestId: lot.requestId, title: lot.title?.trim() || 'Lot sans intitulé',
      contractor: lot.award ? lot.award.contractorName ?? 'Attributaire (nom non communiqué)' : null,
      progress: lot.progress ? { percent: lot.progress.percent, at: lot.progress.at } : null,
      milestones: lot.milestones.map(item => ({ key: item.key, title: item.title, date: valid(item.targetDate) ? item.targetDate!.slice(0, 10) : null, status: item.status })),
    }, planDates ? { value: planDates, label: 'Plan du lot enregistré' } : agreed ? { value: agreed, label: 'Dates convenues' }
      : { value: proposed, label: 'Proposées au devis' }, span(lot.dates.observed?.start, lot.dates.observed?.end)));

    for (const sub of [...lot.executionSubLots].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))) {
      const id = `node:${sub.id}`;
      aliases.set(sub.id, id); aliases.set(sub.nodeKey, id); aliases.set(id, id);
      const agreedSub = span(sub.agreedDates?.start, sub.agreedDates?.end) ?? fromDuration(sub.agreedDates?.start, sub.agreedDates?.durationDays);
      const proposedSub = span(sub.proposedDates.start, sub.proposedDates.end) ?? fromDuration(sub.proposedDates.start, sub.proposedDates.durationDays);
      rows.push(row(id, {
        kind: 'sub_lot', level: 1, requestId: lot.requestId, title: sub.title, contractor: null,
        progress: sub.progress ? { percent: sub.progress.percent, at: sub.progress.at } : null, milestones: [],
      }, agreedSub ? { value: agreedSub, label: 'Dates convenues' } : { value: proposedSub, label: 'Proposées au devis' }, null));
    }

    const lotActivities = activities.filter(item => item.requestId === lot.requestId);
    const depth = (activity: typeof activities[number]) => {
      let level = 1; let parent = activity.parentActivityId; const seen = new Set<string>();
      while (parent && !seen.has(parent) && level < 4) { seen.add(parent); level++; parent = lotActivities.find(item => item.id === parent)?.parentActivityId ?? null; }
      return level;
    };
    for (const activity of lotActivities) {
      const id = `activity:${activity.id}`;
      aliases.set(activity.id, id); aliases.set(id, id);
      rows.push(row(id, {
        kind: 'activity', level: depth(activity), requestId: lot.requestId, title: activity.title, contractor: null,
        progress: activity.execution?.progress ? { percent: activity.execution.progress.percent, at: activity.execution.progress.at } : null,
        milestones: (activity.execution?.milestones ?? []).map(item => ({ key: item.key, title: item.title, date: valid(item.targetDate) ? item.targetDate!.slice(0, 10) : null, status: item.status })),
      }, { value: span(activity.plannedDates.start, activity.plannedDates.end) ?? fromDuration(activity.plannedDates.start, activity.plannedDates.durationDays), label: 'Dates du suivi' },
      span(activity.execution?.observed?.start, activity.execution?.observed?.end)));
    }
  }

  const unsupported = new Set(forecast?.unsupportedDependencyIds ?? []);
  const rowIds = new Set(rows.map(item => item.id));
  const dependencies: GanttDependency[] = [];
  const seenLinks = new Set<string>();
  for (const lot of plan.lots) for (const link of lot.dependencies) {
    if (seenLinks.has(link.id)) continue;
    seenLinks.add(link.id);
    const from = link.from ? aliases.get(link.from) : undefined; const to = link.to ? aliases.get(link.to) : undefined;
    if (from && to && rowIds.has(from) && rowIds.has(to) && link.state !== 'rejected') {
      dependencies.push({ id: link.id, from, to, state: link.state, supported: !unsupported.has(link.id) });
    }
  }

  const days: number[] = [];
  for (const item of rows) {
    for (const value of [item.bar, item.baseline, item.observed]) if (value) days.push(toDay(value.start), toDay(value.end));
    for (const milestone of item.milestones) if (milestone.date) days.push(toDay(milestone.date));
  }
  return {
    rows, dependencies,
    forecastState: forecast?.state ?? 'unavailable',
    projectStart: forecast?.state === 'ready' ? forecast.projectStart : null,
    projectEnd: forecast?.state === 'ready' ? forecast.projectEnd : null,
    durationDays: forecast?.state === 'ready' ? forecast.durationDays : null,
    truncated: Boolean(forecast?.truncated),
    range: days.length ? { start: fromDay(Math.min(...days)), end: fromDay(Math.max(...days)) } : null,
    undatedCount: rows.filter(item => !item.bar && !item.observed && !item.milestones.some(milestone => milestone.date)).length,
  };
}
