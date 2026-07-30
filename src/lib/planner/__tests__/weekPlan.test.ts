import {
  weekTotals,
  trayTiles,
  tilesOnDay,
  type PlanTile,
  type Placement,
} from '../weekPlan';

const M = 1609.344;
const t = (id: string, type: PlanTile['type'], mi: number, q?: number): PlanTile => ({
  id,
  type,
  meters: mi * M,
  ...(q != null ? { qualityMeters: q * M } : {}),
});

// A week: Mon easy14, Tue quality14 (hard 10), Wed easy16, Thu easy12,
// Fri easy9, Sat long20, Sun rest(none).
const TILES: PlanTile[] = [
  t('mon', 'easy', 14),
  t('tue', 'quality', 14, 10),
  t('wed', 'easy', 16),
  t('thu', 'easy', 12),
  t('fri', 'easy', 9),
  t('sat', 'long', 20),
];
const ALL: Placement = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5 };

test('weekTotals: quality reads prescribed hard-miles; long is the max long', () => {
  const w = weekTotals(TILES, ALL);
  expect(Math.round(w.miles / M)).toBe(14 + 14 + 16 + 12 + 9 + 20);
  expect(Math.round(w.quality / M)).toBe(10); // hard-miles, not the 14 total
  expect(Math.round(w.long / M)).toBe(20);
});



