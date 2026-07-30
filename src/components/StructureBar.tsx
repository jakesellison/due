/**
 * StructureBar — draws a planned session's shape instead of describing it.
 *
 * Width ∝ distance, colour = effort. Warm-up / cool-down are neutral, recovery
 * fainter still, the work carries the session's secondary tone colour. The same
 * primitive renders any session, so there is no per-type copy.
 *
 * Completion is a PROPORTIONAL vessel fill (like the BLOCK chart): each segment
 * sits in a faint ghost track (the to-do) and fills solid from the left up to the
 * banked fraction (actual ÷ planned distance). Upcoming = all ghost, completed =
 * all solid, mid-run = partly filled — and it works for every type, since easy
 * now fills with its own green.
 *
 * Decorative: the title + distance carry the accessible content, so it's hidden.
 */
import { View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import type { Tokens } from '@/theme/tokens';
import { toneColorOr } from '@/theme/tone';
import type { BarSeg, WorkoutTone } from '@/lib';

/**
 * Secondary-colour family for a session tone — the SAME map the carousel pips use
 * (DayTab.stripToneColor): long → cyan, quality/speed → violet, easy → steel blue. One
 * type language across the strip, the panel token/label, and the structure bar.
 */
export function toneAccent(C: Tokens, tone: WorkoutTone): string {
  return toneColorOr(C, tone);
}

/** Hex → rgba at alpha `a`. Tinting `ink` keeps neutral track legible on both themes. */
function tint(hex: string, a: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export function StructureBar({
  segments,
  tone,
  fillFraction = 0,
  workDone = true,
  height = 10,
}: {
  segments: BarSeg[];
  tone: WorkoutTone;
  /** 0..1 banked share (actual ÷ planned distance) — sweeps the solid fill. */
  fillFraction?: number;
  /**
   * Whether the WORK (rep/interval) segments were actually completed. Distance
   * fills warm-up/cool-down/recovery honestly (those miles were run), but a
   * quality rep is only "done" when the effort was detected — running the day's
   * distance easy must NOT light the threshold reps. When false, work segments
   * render as a hollow tone-tinted outline (prescribed, not done). Default true
   * (easy/long, or a detected quality session).
   */
  workDone?: boolean;
  height?: number;
}) {
  const C = useTheme();
  if (segments.length === 0) return null;
  const accent = toneAccent(C, tone);
  const ghost = tint(C.ink, 0.08); // the to-do remainder — a faint empty vessel
  const workGhost = tint(accent, 0.16); // an un-done work rep — hollow tone outline
  const doneWarm = tint(C.ink, 0.3); // warm-up / cool-down, banked (kept neutral)
  const doneRest = tint(C.ink, 0.16); // recovery jog, banked (fainter still)

  // Fill threshold in segment-distance space (segments sum ≈ planned distance).
  const total = segments.reduce((a, s) => a + s.meters, 0) || 1;
  const threshold = Math.max(0, Math.min(1, fillFraction)) * total;
  let acc = 0;

  return (
    <View
      style={{ flexDirection: 'row', gap: 3, height }}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {segments.map((s, i) => {
        const isWarm = s.kind === 'wu' || s.kind === 'cd';
        const isRest = s.kind === 'rest';
        const isWork = !isWarm && !isRest;
        // A work rep only fills when the effort was actually done; otherwise it
        // stays a hollow tone-tinted vessel (prescribed, not completed).
        const undoneWork = isWork && !workDone;
        const done = isWarm ? doneWarm : isRest ? doneRest : accent; // work → type colour
        const segStart = acc;
        acc += s.meters;
        const segFrac = undoneWork ? 0 : Math.max(0, Math.min(1, (threshold - segStart) / s.meters));
        return (
          <View
            key={i}
            style={{
              flexGrow: s.meters,
              flexBasis: 0,
              minWidth: 4,
              height,
              borderRadius: 3,
              overflow: 'hidden',
              backgroundColor: undoneWork ? workGhost : ghost,
            }}
          >
            {segFrac > 0 ? (
              <View
                style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${segFrac * 100}%`, backgroundColor: done }}
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/**
 * ActualBar — draws WHAT WAS ACTUALLY RUN (one logged activity), not the plan.
 *
 * Unlike StructureBar (a prescription that fills as the run is banked), an actual
 * bar is fully "done" by construction — it's what happened. Each segment renders
 * SOLID at its own effort colour, per-segment (StructureBar's single-tone vessel
 * can't paint pink reps on a green base): work → quality pink, warm-up / cool-down
 * / steady → Easy steel blue, recovery jog → a fainter blue. No ghost track, no fill
 * sweep. An easy run is one flat steel-blue bar; an interval run shows its real reps.
 *
 * Decorative: the run's distance + type carry the accessible content, so hidden.
 */
export function ActualBar({
  segments,
  height = 10,
  testID,
}: {
  segments: BarSeg[];
  height?: number;
  testID?: string;
}) {
  const C = useTheme();
  if (segments.length === 0) return null;
  const easy = C.easyText;
  const colourFor = (kind: BarSeg['kind']): string =>
    kind === 'work' ? C.qualText : kind === 'rest' ? tint(C.easyText, 0.48) : easy;

  return (
    <View
      testID={testID}
      style={{ flexDirection: 'row', gap: 3, height }}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {segments.map((s, i) => (
        <View
          key={i}
          style={{
            flexGrow: s.meters,
            flexBasis: 0,
            minWidth: 4,
            height,
            borderRadius: 3,
            backgroundColor: colourFor(s.kind),
          }}
        />
      ))}
    </View>
  );
}

/**
 * PrescriptionBar — the quiet, always-present BEFORE state of a workout shape.
 * It has no remainder track and no progress semantics: it is simply the planned
 * session diagram. Easy/warm segments use the steel-blue family, hard work uses
 * violet, and recoveries recede further. The matching ActualBar is solid.
 */
export function PrescriptionBar({
  segments,
  height = 8,
  testID,
}: {
  segments: BarSeg[];
  height?: number;
  testID?: string;
}) {
  const C = useTheme();
  if (segments.length === 0) return null;
  const colourFor = (kind: BarSeg['kind']): string =>
    kind === 'work'
      ? tint(C.qualText, 0.42)
      : kind === 'rest'
        ? tint(C.easyText, 0.14)
        : tint(C.easyText, 0.3);

  return (
    <View
      testID={testID}
      style={{ flexDirection: 'row', gap: 3, height }}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {segments.map((s, i) => (
        <View
          key={i}
          style={{
            flexGrow: s.meters,
            flexBasis: 0,
            minWidth: 4,
            height,
            borderRadius: 3,
            backgroundColor: colourFor(s.kind),
          }}
        />
      ))}
    </View>
  );
}
