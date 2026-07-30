export type QualityZone = 'easy' | 'steady' | 'threshold' | 'interval' | 'rep';

export interface PlannedQuality {
  plannedDistanceMeters: number;
  hardLaps?: number;
  zone?: QualityZone;
}
export interface ActivityEffort {
  distanceMeters: number;
  avgHr?: number;
  hardLaps?: number;
}
export interface QualityOpts {
  distanceTolerance?: number;
  hrFloors?: Record<QualityZone, number>;
}
export type QualityReason = 'distance' | 'hr' | 'laps' | 'none';
export interface QualityResult { completed: boolean; reason: QualityReason }

const DEFAULT_HR_FLOORS: Record<QualityZone, number> = {
  easy: 999, steady: 999, threshold: 160, interval: 168, rep: 172,
};

