import {
  normalizeMovingTime,
} from '../movingTime';
import longRun from './fixtures/longrun-pause.json';
import track from './fixtures/track-stationary.json';
import clean from './fixtures/clean-run.json';

type Fixture = { id: string; streams: { t: number[]; d: number[]; v: number[] }; stravaMovingTimeS: number };

describe('normalizeMovingTime — real runs', () => {
  it('long run with watch pauses: stoppage excluded, moving ≈ Strava moving', () => {
    const f = longRun as Fixture;
    const r = normalizeMovingTime(f.streams);
    expect(r.movingTimeS).toBeLessThan(r.elapsedTimeS);
    expect(r.elapsedTimeS - r.movingTimeS).toBeGreaterThan(300);
    const drift = Math.abs(r.movingTimeS - f.stravaMovingTimeS) / f.stravaMovingTimeS;
    expect(drift).toBeLessThan(0.05);
    expect(r.stopIntervals.length).toBeGreaterThan(0);
  });

  it('track session with stand-between-reps: stationary spans removed', () => {
    const f = track as Fixture;
    const r = normalizeMovingTime(f.streams);
    expect(r.movingTimeS).toBeLessThan(r.elapsedTimeS);
    expect(r.stopIntervals.length).toBeGreaterThan(0);
    expect(r.movingPaceSecPerMi).not.toBeNull();
    expect(r.movingPaceSecPerMi!).toBeLessThan(r.elapsedPaceSecPerMi!);
  });

  it('clean easy run: moving ≈ total (little/no stoppage)', () => {
    const f = clean as Fixture;
    const r = normalizeMovingTime(f.streams);
    const drift = (r.elapsedTimeS - r.movingTimeS) / r.elapsedTimeS;
    expect(drift).toBeLessThan(0.05);
  });
});
