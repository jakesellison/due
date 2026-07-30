import fs from 'fs';
import path from 'path';
import {
  sampleIndices,
  downsampleStreams,
  decodePolyline,
  downsampleRoute,
  routeFromPolyline,
  routeFromLatLng,
  computeStreamSummary,
  computeStreamSummaryFromStored,
  fullResStreams,
  STREAM_SUMMARY_VERSION,
  type RawStreams,
} from '../streams';
import { estimateQualityFloor } from '../../lib/kpi/qualityFloor';

const TEST_QF = { floor: estimateQualityFloor({ easyBaselineSecPerMi: 495 }), easyBaselineSecPerMi: 495 };

function rawSteady(distM: number, durS: number, n: number, withHr = true) {
  const time: number[] = [], distance: number[] = [], velocity: number[] = [], heartrate: number[] = [];
  const vel = distM / durS;
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    time.push(Math.round(f * durS));
    distance.push(Math.round(f * distM * 100) / 100);
    velocity.push(vel);
    heartrate.push(150);
  }
  const raw: any = { time: { data: time }, distance: { data: distance }, velocity_smooth: { data: velocity } };
  if (withHr) raw.heartrate = { data: heartrate };
  return raw;
}

describe('fullResStreams', () => {
  it('keeps every sample (no downsample cap)', () => {
    const raw = rawSteady(5000, 1500, 1500);
    expect(fullResStreams(raw)!.t.length).toBe(1500);
  });
  it('returns null when there is no time stream', () => {
    expect(fullResStreams(null)).toBeNull();
    expect(fullResStreams({} as any)).toBeNull();
  });
});

describe('computeStreamSummary', () => {
  it('produces a pace_curve, pace_duration_curve, and early_miles from a real-length run', () => {
    const s = computeStreamSummary(rawSteady(5000, 1500, 1500), TEST_QF);
    expect(s).not.toBeNull();
    expect(s!.pace_curve.length).toBeGreaterThan(3);
    expect(s!.pace_curve.every((p) => p.paceSecPerKm > 0)).toBe(true);
    expect(s!.pace_duration_curve.length).toBeGreaterThan(2);
    expect(s!.pace_duration_curve.every((p) => p.paceSecPerKm > 0)).toBe(true);
    // >2 miles so early_miles.m2 is present with the steady pace + HR
    expect(s!.early_miles?.m2?.avgHr).toBe(150);
    expect(s!.early_miles?.m2?.paceSecPerKm).toBeCloseTo(300, 0);
  });
  it('returns null for an unusable stream', () => {
    expect(computeStreamSummary(null, TEST_QF)).toBeNull();
  });
});

describe('computeStreamSummary quality', () => {
  it('always includes a quality object when streams exist', () => {
    const s = computeStreamSummary(rawSteady(5000, 1500, 1500), TEST_QF);
    expect(s?.quality).toBeDefined();
    expect(typeof s?.quality?.isQuality).toBe('boolean');
    expect(s?.quality?.floor.easyBaselineSecPerMi).toBe(495);
    expect(s?.quality?.floor.paceFloorSecPerMi).toBeCloseTo(450, 0); // 495 midpoint with 495-90
  });
  it('detects an interval session as quality', () => {
    // Build a synthetic raw stream: 10 min easy (3 m/s), then 4 × (3 min @ 4.5 m/s + 2 min @ 2 m/s).
    // 4.5 m/s ≈ 5:58/mi, far under the 427.5 s/mi quality floor derived from TEST_QF.
    // The interpretWorkout interpreter segments on LAPS (not the raw stream), so
    // the fixture also declares one lap per push() span, mirroring Strava's
    // manual/auto laps 1:1 with the synthetic pace regimes above.
    const t: number[] = []; const d: number[] = []; const v: number[] = [];
    const laps: { distance: number; moving_time: number }[] = [];
    let dist = 0;
    const push = (secs: number, speed: number) => {
      const distBefore = dist;
      for (let i = 0; i < secs; i += 5) { dist += speed * 5; t.push((t.length ? t[t.length - 1]! : 0) + 5); d.push(dist); v.push(speed); }
      laps.push({ distance: dist - distBefore, moving_time: secs });
    };
    push(600, 3);
    for (let r = 0; r < 4; r++) { push(180, 4.5); push(120, 2); }
    const raw = { time: { data: t }, distance: { data: d }, velocity_smooth: { data: v } };
    const s = computeStreamSummary(raw, TEST_QF, laps);
    expect(s?.quality?.isQuality).toBe(true);
    expect(s?.quality?.kind).toBe('intervals');
    expect(s?.quality?.qualityDistanceMeters).toBeGreaterThan(2500);
  });
});

describe('computeStreamSummary — plan-conditioned interpreter wiring (v8, Task C1)', () => {
  // The pinned 07-12 fixture (docs/superpowers/specs/interpreter-prototype/):
  // a manual-lap MP long run that the OLD detector misread as 2.3mi; the
  // change-point interpreter reads it as ~10mi continuous tempo.
  const fixturesDir = path.join(__dirname, '../../lib/kpi/__tests__/fixtures');
  const streamsFixture = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'streams.json'), 'utf8'));
  const lapsFixture = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'fixtures.json'), 'utf8'));

  it('c4629fff (07-12 MP long run) DETECTS quality with a v8 candidate ladder (no plan threaded at ingest)', () => {
    const activityId = 'c4629fff-4d92-4ebd-ab04-1c45e3b17a28';
    const { d, v, t, hr, alt } = streamsFixture[activityId] as {
      d: number[]; v: number[]; t: number[]; hr: (number | null)[]; alt: number[];
    };
    const laps = lapsFixture[activityId].laps;
    const raw: RawStreams = {
      time: { data: t },
      distance: { data: d },
      velocity_smooth: { data: v },
      heartrate: { data: hr as number[] },
      altitude: { data: alt },
    };
    const qf = {
      floor: estimateQualityFloor({ easyBaselineSecPerMi: 500, hrModel: { steadyZoneFloorBpm: 148 } }),
      easyBaselineSecPerMi: 500,
    };

    const s = computeStreamSummary(raw, qf, laps);

    // Ingest threads no plan yet, so the flat credit fields = honest (broad-net
    // read). The plan-tilt that recovers this run's prescribed ~10mi continuous
    // block is proven at the interpreter level (interpretWorkout.test); it becomes
    // the stored credit once the prescription is threaded into ingest (plan-thread
    // task). Here we assert the pipeline detects quality + emits the ladder.
    expect(s?.quality?.v).toBe(STREAM_SUMMARY_VERSION);
    expect(s?.quality?.honest?.kind).not.toBe('none'); // quality IS detected
    expect(s?.quality?.kind).toBe(s?.quality?.honest?.kind); // resolved = matched ?? honest (matched null)
    expect(s?.quality?.matched).toBeNull();
    expect(s?.quality?.isQuality).toBe(true);
    expect((s?.quality?.candidates?.length ?? 0)).toBeGreaterThanOrEqual(1);
    expect(s?.quality?.blocks[0]?.startIdx).toBeGreaterThanOrEqual(0);
  });

  it('c4629fff WITH its tempo prescription credits the MATCHED ~10mi block', () => {
    const activityId = 'c4629fff-4d92-4ebd-ab04-1c45e3b17a28';
    const { d, v, t, hr, alt } = streamsFixture[activityId] as {
      d: number[]; v: number[]; t: number[]; hr: (number | null)[]; alt: number[];
    };
    const laps = lapsFixture[activityId].laps;
    const raw: RawStreams = {
      time: { data: t }, distance: { data: d }, velocity_smooth: { data: v },
      heartrate: { data: hr as number[] }, altitude: { data: alt },
    };
    const qf = {
      floor: estimateQualityFloor({ easyBaselineSecPerMi: 500, hrModel: { steadyZoneFloorBpm: 148 } }),
      easyBaselineSecPerMi: 500,
    };

    const s = computeStreamSummary(raw, qf, laps, { kind: 'tempo', qualityMi: 10, workoutId: 'w' });

    // The prescription reshapes the read: matched wins, flat credit = matched.
    expect(s?.quality?.matched?.matchesPlan).toBe(true);
    expect(s?.quality?.kind).toBe('tempo');
    expect(Math.abs((s?.quality?.qualityDistanceMeters ?? 0) / 1609.344 - 10)).toBeLessThan(1.5);
  });
});

describe('computeStreamSummaryFromStored — local recompute matches a Strava-fetch compute', () => {
  it('reproduces the same summary from ALREADY-STORED columnar streams (no fetch)', () => {
    const raw = rawSteady(5000, 1500, 1500);
    const fromRaw = computeStreamSummary(raw, TEST_QF);
    const stored = fullResStreams(raw); // what the DB holds
    const fromStored = computeStreamSummaryFromStored(stored, TEST_QF);
    expect(fromStored).toEqual(fromRaw);
  });

  it('returns null for empty/absent stored streams', () => {
    expect(computeStreamSummaryFromStored(null, TEST_QF)).toBeNull();
    expect(computeStreamSummaryFromStored({ t: [], d: [], v: [], hr: [], alt: null }, TEST_QF)).toBeNull();
  });
});

describe('sampleIndices', () => {
  it('returns all indices when length <= max', () => {
    expect(sampleIndices(5, 200)).toEqual([0, 1, 2, 3, 4]);
  });

  it('returns empty for zero length', () => {
    expect(sampleIndices(0, 200)).toEqual([]);
  });

  it('always retains first and last index', () => {
    const idxs = sampleIndices(1000, 200);
    expect(idxs[0]).toBe(0);
    expect(idxs[idxs.length - 1]).toBe(999);
  });

  it('produces <= max samples, strictly ascending and unique', () => {
    const idxs = sampleIndices(1000, 200);
    expect(idxs.length).toBeLessThanOrEqual(200);
    for (let i = 1; i < idxs.length; i++) {
      expect(idxs[i]!).toBeGreaterThan(idxs[i - 1]!);
    }
  });

  it('does uniform k-th sampling math (length 2N down to N -> every other)', () => {
    // 10 samples to 5 -> endpoints pinned, even spacing: 0,2,5,7,9 (rounded).
    expect(sampleIndices(10, 5)).toEqual([0, 2, 5, 7, 9]);
  });
});

describe('downsampleStreams', () => {
  function rawOf(n: number, opts: { hr?: boolean; alt?: boolean } = {}): RawStreams {
    const time = Array.from({ length: n }, (_, i) => i);
    const distance = Array.from({ length: n }, (_, i) => i * 3); // 3 m/s
    const velocity = Array.from({ length: n }, () => 3);
    const raw: RawStreams = {
      time: { data: time },
      distance: { data: distance },
      velocity_smooth: { data: velocity },
    };
    if (opts.hr) raw.heartrate = { data: Array.from({ length: n }, (_, i) => 140 + i) };
    if (opts.alt) raw.altitude = { data: Array.from({ length: n }, (_, i) => 200 + i) };
    return raw;
  }

  it('returns null for missing/empty payloads', () => {
    expect(downsampleStreams(null)).toBeNull();
    expect(downsampleStreams(undefined)).toBeNull();
    expect(downsampleStreams({})).toBeNull();
    expect(downsampleStreams({ time: { data: [] } })).toBeNull();
  });

  it('keeps all keys aligned to the same length', () => {
    const s = downsampleStreams(rawOf(1000, { hr: true, alt: true }), 200)!;
    const L = s.t.length;
    expect(L).toBeLessThanOrEqual(200);
    expect(s.d).toHaveLength(L);
    expect(s.v).toHaveLength(L);
    expect(s.hr).toHaveLength(L);
    expect(s.alt).toHaveLength(L);
  });

  it('retains first and last sample values', () => {
    const s = downsampleStreams(rawOf(1000, { hr: true, alt: true }), 200)!;
    expect(s.t[0]).toBe(0);
    expect(s.t[s.t.length - 1]).toBe(999);
    expect(s.d[0]).toBe(0);
    expect(s.d[s.d.length - 1]).toBe(999 * 3);
    expect(s.hr[0]).toBe(140);
    expect(s.hr[s.hr.length - 1]).toBe(140 + 999);
    expect(s.alt![0]).toBe(200);
  });

  it('fills hr with nulls when the heartrate stream is absent', () => {
    const s = downsampleStreams(rawOf(500, { hr: false, alt: true }), 200)!;
    expect(s.hr).toHaveLength(s.t.length);
    expect(s.hr.every((x) => x === null)).toBe(true);
  });

  it('sets alt to null when the altitude stream is absent', () => {
    const s = downsampleStreams(rawOf(500, { hr: true, alt: false }), 200)!;
    expect(s.alt).toBeNull();
  });

  it('passes through small streams unchanged in length', () => {
    const s = downsampleStreams(rawOf(50, { hr: true, alt: true }), 200)!;
    expect(s.t).toHaveLength(50);
  });

  it('defaults to a 500-sample cap, keeping the payload a few KB of jsonb', () => {
    // A dense ~2h activity at 1s spacing -> 7200 raw samples, capped to 500.
    const s = downsampleStreams(rawOf(7200, { hr: true, alt: true }))!;
    expect(s.t.length).toBeLessThanOrEqual(500);
    expect(s.t.length).toBeGreaterThan(490);
    expect(s.d).toHaveLength(s.t.length);
    expect(s.v).toHaveLength(s.t.length);
    expect(s.hr).toHaveLength(s.t.length);
    expect(s.alt).toHaveLength(s.t.length);
    // ~500 samples × (t,d,v,hr,alt) ≈ 2500 finite numbers; serialized jsonb is a
    // few KB, comfortably inside a row. Assert the serialized size stays sane.
    const bytes = JSON.stringify(s).length;
    expect(bytes).toBeLessThan(40_000);
  });
});

describe('decodePolyline', () => {
  it('decodes the documented Google example to the known fixture', () => {
    const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(pts).toHaveLength(3);
    // Compare with tolerance for 1e-5 precision rounding.
    const expected: [number, number][] = [
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ];
    pts.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(expected[i]![0], 5);
      expect(p[1]).toBeCloseTo(expected[i]![1], 5);
    });
  });

  it('returns empty for empty/missing input', () => {
    expect(decodePolyline('')).toEqual([]);
    expect(decodePolyline(null)).toEqual([]);
    expect(decodePolyline(undefined)).toEqual([]);
  });
});

describe('downsampleRoute', () => {
  it('caps the number of points and keeps first + last', () => {
    const pts: [number, number][] = Array.from({ length: 500 }, (_, i) => [i, 100 - i]);
    const out = downsampleRoute(pts, 120);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out[0]).toEqual([0, 100]);
    expect(out[out.length - 1]).toEqual([499, 100 - 499]);
  });

  it('returns a copy unchanged when under the cap', () => {
    const pts: [number, number][] = [
      [1, 1],
      [2, 2],
    ];
    expect(downsampleRoute(pts, 120)).toEqual(pts);
  });

  it('returns empty for empty input', () => {
    expect(downsampleRoute([], 120)).toEqual([]);
    expect(downsampleRoute(null, 120)).toEqual([]);
  });
});

describe('routeFromPolyline', () => {
  it('decodes then downsamples, returning null for nothing to decode', () => {
    expect(routeFromPolyline('')).toBeNull();
    const out = routeFromPolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(out).toHaveLength(3);
  });
});

describe('routeFromLatLng', () => {
  it('returns null when the latlng stream is absent or empty', () => {
    expect(routeFromLatLng(null)).toBeNull();
    expect(routeFromLatLng({})).toBeNull();
    expect(routeFromLatLng({ latlng: { data: [] } })).toBeNull();
  });

  it('reads [lat,lng] pairs straight from the stream (full fidelity, no decode)', () => {
    const raw: RawStreams = { latlng: { data: [[40.1, -74.1], [40.2, -74.2], [40.3, -74.3]] } };
    expect(routeFromLatLng(raw)).toEqual([[40.1, -74.1], [40.2, -74.2], [40.3, -74.3]]);
  });

  it('downsamples to the cap while pinning first + last', () => {
    const data = Array.from({ length: 5000 }, (_, i) => [40 + i / 1e5, -74 + i / 1e5]);
    const out = routeFromLatLng({ latlng: { data } }, 600)!;
    expect(out.length).toBeLessThanOrEqual(600);
    expect(out[0]).toEqual([40, -74]);
    expect(out[out.length - 1]).toEqual(data[4999]);
  });

  it('skips malformed samples (Strava emits nulls when GPS drops)', () => {
    const raw: RawStreams = { latlng: { data: [[40.1, -74.1], null, [40.2], [40.3, -74.3]] } };
    expect(routeFromLatLng(raw)).toEqual([[40.1, -74.1], [40.3, -74.3]]);
  });
});
