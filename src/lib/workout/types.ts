export type TargetBy = 'pace' | 'time' | 'distance' | 'hr' | 'effort';

export type PaceLabel =
  | 'MP' | 'HMP' | '10K' | '5K' | '3K' | 'mile'
  | 'threshold' | 'tempo' | 'easy' | 'steady' | 'rep' | 'recovery';

/**
 * A concrete pace band in seconds per kilometre.
 *
 * `fast_s_per_km` is the lower number; `slow_s_per_km` is the upper number.
 * Equal values represent an explicitly prescribed point pace.
 */
export interface PaceBand {
  fast_s_per_km: number;
  slow_s_per_km: number;
}

/**
 * Pace is an exclusive prescription:
 *
 * - `relative` preserves portable coaching intent. `speed_fraction` is a
 *   fraction of the reference's SPEED, not its time-per-distance pace. A
 *   0.92 fraction is therefore slower than the reference.
 * - `absolute` preserves an authored numeric prescription exactly. `intent`
 *   is descriptive metadata only; the band remains authoritative.
 *
 * Installed relative prescriptions may carry a `resolved` band. It is a
 * runner-specific snapshot derived by the install engine, never a second
 * authored target, and is removed when a plan is exported as a portable file.
 */
export type PacePrescription =
  | {
      kind: 'relative';
      reference: PaceLabel;
      speed_fraction: number;
      resolved?: PaceBand;
    }
  | {
      kind: 'absolute';
      band: PaceBand;
      intent?: PaceLabel;
    };

export interface Target {
  by: TargetBy | TargetBy[];
  distance_m?: number;
  duration_s?: number;
  pace?: PacePrescription;
  hr_zone?: 'easy' | 'steady' | 'threshold' | 'interval' | 'rep';
  /** Free-text effort / RPE (e.g. "comfortably hard", "RPE 8"). */
  effort?: string;
  note?: string;
}

// Role of the segment. Intensity lives in Target. `steady`/`interval` are
// retained for back-compat; `work` is the preferred generic hard-rep role.
export type SegmentKind =
  | 'warmup' | 'cooldown' | 'steady' | 'interval' | 'work' | 'recovery' | 'strides' | 'repeat';

export interface LeafSegment {
  kind: Exclude<SegmentKind, 'repeat'>;
  target: Target;
  note?: string;
}

export interface RepeatSegment {
  kind: 'repeat';
  sets: number;
  children: Segment[];
  note?: string;
}

export type Segment = LeafSegment | RepeatSegment;
export type WorkoutStructure = Segment[];
