import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateNativeForecast, type NativePlanningNode } from '../src/native-tracking/planning.js';
import { projectNativeForecast } from '../src/native-tracking/forecast.js';

const node = (id: string, start: string | null, end: string | null, durationDays: number | null = null): NativePlanningNode => ({
  id, requestId: 'request-1', title: id, baselineStart: start, baselineEnd: end,
  durationDays, observedStart: null, observedEnd: null,
});

test('native CPM computes dates, float and critical path for a linked awarded-lot graph', () => {
  const result = calculateNativeForecast([
    node('a', '2026-01-01', '2026-01-02'),
    node('b', null, null, 2),
    node('c', '2026-01-01', '2026-01-03'),
  ], [{ id: 'ab', from: 'a', to: 'b', state: 'effective', relation: 'FS', lagDays: 0 }]);
  assert.equal(result.state, 'ready');
  assert.equal(result.nodes.find(item => item.id === 'b')?.projectedStart, '2026-01-03');
  assert.equal(result.nodes.find(item => item.id === 'b')?.projectedEnd, '2026-01-04');
  assert.equal(result.nodes.find(item => item.id === 'c')?.totalFloatDays, 1);
  assert.deepEqual(result.criticalPathIds, ['a', 'b']);
});

test('native CPM returns incomplete instead of inventing dates and propagates missing predecessors', () => {
  const result = calculateNativeForecast([node('a', null, null, 2), node('b', '2026-01-01', '2026-01-02')], [
    { id: 'ab', from: 'a', to: 'b', state: 'effective', relation: 'FS', lagDays: 0 },
  ]);
  assert.equal(result.state, 'incomplete');
  assert.deepEqual(result.incompleteNodeIds, ['a', 'b']);
  assert.equal(result.nodes.every(item => item.projectedStart === null), true);
});

test('native CPM reports cycles and unsupported effective relations explicitly', () => {
  const nodes = [node('a', '2026-01-01', '2026-01-01'), node('b', '2026-01-02', '2026-01-02')];
  const cycle = calculateNativeForecast(nodes, [
    { id: 'ab', from: 'a', to: 'b', state: 'effective', relation: 'FS', lagDays: 0 },
    { id: 'ba', from: 'b', to: 'a', state: 'effective', relation: 'FS', lagDays: 0 },
  ]);
  assert.equal(cycle.state, 'cycle');
  const unsupported = calculateNativeForecast(nodes, [
    { id: 'ab', from: 'a', to: 'b', state: 'effective', relation: 'SS', lagDays: 0 },
  ]);
  assert.equal(unsupported.state, 'unsupported');
  assert.deepEqual(unsupported.unsupportedDependencyIds, ['ab']);
});

test('native project forecast resolves cross-lot dependency aliases across the full project graph', () => {
  const lot = (requestId: string, start: string, durationDays: number, dependencies: any[] = []) => ({
    requestId, title: requestId, dates: {
      agreed: { start, durationDays }, plan: null, proposed: null, observed: null,
    }, executionSubLots: [], dependencies,
  });
  const page: any = {
    lots: [
      lot('request-a', '2026-03-01', 2, [{ id: 'edge', from: 'lot:request-a', to: 'lot:request-b', state: 'effective', relation: 'FS', lagDays: 0 }]),
      lot('request-b', '2026-03-01', 1),
    ],
    activities: { items: [] },
  };
  const forecast = projectNativeForecast([page]);
  assert.equal(forecast.state, 'ready');
  assert.equal(forecast.nodes.find(item => item.requestId === 'request-b')?.projectedStart, '2026-03-03');
  assert.deepEqual(forecast.criticalPathIds, ['lot:request-a', 'lot:request-b']);
});
