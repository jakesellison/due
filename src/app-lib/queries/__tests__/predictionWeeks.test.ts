jest.mock('../../supabase', () => ({ supabase: {} }));

import { completedPredictionWeekStarts } from '../prediction';

describe('completedPredictionWeekStarts', () => {
  it('excludes the current week even when it already contains activities', () => {
    expect(completedPredictionWeekStarts([
      '2026-07-05',
      '2026-07-12',
      '2026-07-13',
      '2026-07-17',
    ], '2026-07-18')).toEqual([
      '2026-06-29',
      '2026-07-06',
    ]);
  });

  it('keeps empty completed weeks in a fixed horizon instead of compressing time', () => {
    expect(completedPredictionWeekStarts([
      '2026-06-30',
      '2026-07-13',
    ], '2026-07-18', { completedWeeks: 4 })).toEqual([
      '2026-06-15',
      '2026-06-22',
      '2026-06-29',
      '2026-07-06',
    ]);
  });
});
