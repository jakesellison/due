import {
  haversineMeters,
  type LatLng,
} from './geo';

export interface ElevationPoint {
  distanceMeters: number;
  elevationMeters: number;
}

const ELEVATION_URL = 'https://api.open-meteo.com/v1/elevation';




function cumulativeDistances(path: LatLng[]): number[] {
  const out = [0];
  for (let i = 1; i < path.length; i++) {
    out.push(out[i - 1]! + haversineMeters(path[i - 1]!, path[i]!));
  }
  return out;
}

function interpolateAtDistance(path: LatLng[], cumulative: number[], target: number): LatLng {
  for (let i = 1; i < path.length; i++) {
    const prev = cumulative[i - 1]!;
    const next = cumulative[i]!;
    if (target <= next) {
      const span = next - prev;
      const t = span > 0 ? (target - prev) / span : 0;
      const a = path[i - 1]!;
      const b = path[i]!;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
  }
  return path[path.length - 1]!;
}
