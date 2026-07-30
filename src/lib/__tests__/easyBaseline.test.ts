import {
  computeEasyBaselineSecPerMi,
  FALLBACK_EASY_BASELINE_SEC_PER_MI,
} from '../kpi/easyBaseline';

const act = (local_date: string, miles: number, secPerMi: number) => ({
  local_date,
  distance_meters: miles * 1609.344,
  moving_time_s: miles * secPerMi,
});
const easyDay = (date: string) => ({ date, is_quality: false, type: 'easy' });

describe('computeEasyBaselineSecPerMi', () => {
  it('returns the median easy-day pace with ≥3 easy runs', () => {
    const workouts = [easyDay('2026-06-01'), easyDay('2026-06-02'), easyDay('2026-06-03')];
    const activities = [
      act('2026-06-01', 5, 480),
      act('2026-06-02', 5, 500),
      act('2026-06-03', 5, 520),
    ];
    expect(computeEasyBaselineSecPerMi(activities, workouts)).toBeCloseTo(500, 0);
  });
  it('falls back to 495 with fewer than 3 easy runs', () => {
    expect(computeEasyBaselineSecPerMi([], [])).toBe(FALLBACK_EASY_BASELINE_SEC_PER_MI);
  });
  it('excludes days where a quality workout shares the date', () => {
    const workouts = [
      easyDay('2026-06-01'), easyDay('2026-06-02'), easyDay('2026-06-03'),
      easyDay('2026-06-04'), { date: '2026-06-04', is_quality: true, type: 'interval' },
    ];
    const activities = [
      act('2026-06-01', 5, 480), act('2026-06-02', 5, 500), act('2026-06-03', 5, 520),
      act('2026-06-04', 5, 300), // fast quality run must NOT drag the baseline
    ];
    expect(computeEasyBaselineSecPerMi(activities, workouts)).toBeCloseTo(500, 0);
  });
});
