import { expect, test } from '@playwright/test';
import { groupAwardedLotsByContractor } from '../../lib/contractor-lot-dossiers';

test('two awarded lots from one contractor form one unsiged project dossier; other lots stay independent', () => {
  const groups = groupAwardedLotsByContractor('project-1', [
    { projectId: 'project-1', requestId: 'lot-b', awardId: 'award-b', contractorId: 'artisan-a', agreedMillimes: 2100500 },
    { projectId: 'project-1', requestId: 'lot-a', awardId: 'award-a', contractorId: 'artisan-a', agreedMillimes: 8000000 },
    { projectId: 'project-1', requestId: 'lot-c', awardId: 'award-c', contractorId: 'artisan-b', agreedMillimes: 3000000 },
  ]);
  expect(groups).toEqual([
    { projectId: 'project-1', contractorId: 'artisan-a', lotIds: ['lot-a', 'lot-b'], awardIds: ['award-a', 'award-b'], totalMillimes: 10100500, contractStatus: 'not_prepared' },
    { projectId: 'project-1', contractorId: 'artisan-b', lotIds: ['lot-c'], awardIds: ['award-c'], totalMillimes: 3000000, contractStatus: 'not_prepared' },
  ]);
});

test('one award can cover multiple lots and is counted once as an award', () => {
  const groups = groupAwardedLotsByContractor('p', [
    { projectId: 'p', requestId: 'lot-a', awardId: 'award', contractorId: 'a', agreedMillimes: 1000 },
    { projectId: 'p', requestId: 'lot-b', awardId: 'award', contractorId: 'a', agreedMillimes: 2500 },
  ]);
  expect(groups[0].awardIds).toEqual(['award']);
  expect(groups[0].totalMillimes).toBe(3500);
});

test('never regroup across chantiers or accept corrupt monetary totals', () => {
  const normal = { projectId: 'p', requestId: 'lot-a', awardId: 'award', contractorId: 'a', agreedMillimes: 1000 };
  expect(() => groupAwardedLotsByContractor('p', [normal, { ...normal, projectId: 'other', requestId: 'other-lot' }])).toThrow(/Cross-project/);
  expect(() => groupAwardedLotsByContractor('p', [normal, normal])).toThrow(/Ambiguous/);
  expect(() => groupAwardedLotsByContractor('p', [{ ...normal, agreedMillimes: 0.5 }])).toThrow(/Invalid/);
  expect(() => groupAwardedLotsByContractor('p', [{ ...normal, agreedMillimes: -1 }])).toThrow(/Invalid/);
  expect(groupAwardedLotsByContractor('p', [])).toEqual([]);
});
