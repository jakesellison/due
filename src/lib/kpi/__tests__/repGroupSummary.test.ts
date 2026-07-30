import {
  repGroupSummary,
  snapRepDistMeters,
} from '../qualityDetect';

const rep = (distanceMeters: number, paceSecPerMi: number) => ({ distanceMeters, paceSecPerMi });

describe('repGroupSummary', () => {
  test('same-distance reps with varied pace read as ONE set with a pace range', () => {
    // The real hill session: 6×~563m, paces 7:20..8:14 (fatigue/grade). Must NOT
    // fragment into "1× + 4× + 1×" — a single set with the spread shown as a range.
    const reps = [
      rep(563, 440), // 7:20
      rep(564, 491), // 8:11
      rep(564, 494), // 8:14
      rep(562, 484), // 8:04
      rep(562, 481), // 8:01
      rep(562, 467), // 7:47
    ];
    // Distance snaps to the nominal 600m mark (563m GPS is a 600m rep), so the
    // pill reads a clean "6×600m" and agrees with the per-rep rows.
    expect(repGroupSummary(reps)).toBe('6×600m @ 7:20–8:14');
  });

  test('consistent same-distance reps show a single pace (no noisy range)', () => {
    const reps = [rep(221, 342), rep(221, 341), rep(221, 343)]; // 5:42 ± 1s
    expect(repGroupSummary(reps)).toBe('3×200m @ 5:42'); // 221m → nominal 200m
  });

  test('different rep distances stay in separate groups', () => {
    const reps = [rep(400, 85), rep(400, 86), rep(800, 88), rep(800, 87)];
    // 400s and 800s never merge (distance), each tight → single pace per group.
    expect(repGroupSummary(reps)).toMatch(/^2×400m @ .+ \+ 2×800m @ .+$/);
  });
});

describe('snapRepDistMeters', () => {
  test('GPS drift within tolerance snaps to the standard mark', () => {
    expect(snapRepDistMeters(563)).toBe(600); // 6.2% short of 600
    expect(snapRepDistMeters(660)).toBe(600); // 10% long of 600
    expect(snapRepDistMeters(221)).toBe(200); // 10.5% long of 200
    expect(snapRepDistMeters(1180)).toBe(1200);
    expect(snapRepDistMeters(400)).toBe(400); // exact mark unchanged
  });

  test('genuinely off-ladder distances round to a clean 50m, not a wrong mark', () => {
    // 700m is >12% from both 600 and 800 — don't force it onto either.
    expect(snapRepDistMeters(700)).toBe(700);
    expect(snapRepDistMeters(682)).toBe(700); // nearest 50, still honest
  });

  test('a mile and up is returned unchanged (measured miles read cleanly)', () => {
    expect(snapRepDistMeters(1609)).toBe(1609);
    expect(snapRepDistMeters(3218)).toBe(3218);
  });
});
