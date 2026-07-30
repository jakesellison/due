/**
 * useArrivalMeters — stages the weekly contract's target so a freshly-banked run
 * READS as arriving.
 *
 * The Dash already sweeps the contract track 0→value on every mount
 * (`useGaugeTween`: "on mount the ring still sweeps up from empty"). So an
 * arrival animation that simply targets the true value is invisible — it is
 * indistinguishable from the sweep that always plays.
 *
 * This hook does not animate anything. It changes WHAT `useGaugeTween` is aimed
 * at, in two stages:
 *
 *   stage 1  target = pre-run value   (the mount sweep lands here — looks normal)
 *   hold     ARRIVAL_HOLD_MS          (the beat that separates the two)
 *   stage 2  target = true value      (useGaugeTween glides from the live frame)
 *            + one light haptic, right as stage 2 starts
 *
 * Everything downstream — easing, retargeting, the Reduce-Motion SNAP — stays in
 * `useGaugeTween`, which already handles all of it. What Reduce Motion does NOT
 * get for free is the two-stage TIMING itself (there is nothing to snap out of
 * if this hook never staged anything): under Reduce Motion this hook releases
 * to the true value immediately and reports `arriving: true` right away too, so
 * the leading-edge highlight still appears (without the movement) instead of
 * never rendering.
 *
 * Reduce Motion suppresses MOVEMENT, not the highlight's EXISTENCE — a runner
 * still needs to see WHICH miles are new. So this hook also holds `onSettled`
 * back for `MOUNT_SWEEP_MS` under Reduce Motion (the same span the highlight
 * stays lit on the motion path, between release and settle): calling it in the
 * same commit the highlight first appears gave it exactly one render's
 * lifetime (~16-32ms) before the caller's ack nulled `arrivalMeters` out from
 * under it. `meters`/`arriving` are unaffected by this hold — they still read
 * as fully arrived from the very first render — only the ACKNOWLEDGEMENT is
 * delayed, so nothing here reintroduces staged TIMING for the values.
 *
 * `ArrivalInput.holdMs`/`sweepMs` let a caller override the two constants
 * below. No production caller does — the Dash always takes the defaults, so
 * this is byte-identical to before those fields existed. `app/lab/
 * run-arrival.tsx` is the only caller that supplies them, so the hold (named
 * above as "the single knob worth tuning") can be tuned live, by eye.
 */
import { useEffect, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';

import { preRunMeters } from '@/lib/kpi/justBanked';
import { DURATION_MS } from './useGaugeTween';

/** How long stage 1 takes to land — literally `useGaugeTween`'s own tween
 *  duration (FIX 6: was a same-value comment-only duplicate; a retune of one
 *  could silently desync the hold from the sweep it's timed against). */
export const MOUNT_SWEEP_MS = DURATION_MS;

/**
 * The beat between the two stages. Load-bearing: without it the stages read as
 * one longer sweep and there is no moment at all. The single knob worth tuning.
 */
export const ARRIVAL_HOLD_MS = 250;

export interface ArrivalInput {
  /** The week's true banked meters. */
  actualMeters: number;
  /** This run's contribution, or null when nothing just banked. */
  arrivalMeters: number | null;
  reduceMotion: boolean;
  /** Fires ONCE when the arrival has finished (after a `MOUNT_SWEEP_MS` hold
   *  under Reduce Motion — long enough for the highlight to be seen, not the
   *  same commit it first renders in). */
  onSettled?: () => void;
  /**
   * Override the beat between stage 1 and stage 2 (default `ARRIVAL_HOLD_MS`).
   * No production caller passes this — the Dash always takes the tuned
   * default. It exists so `app/lab/run-arrival.tsx` (the only caller that
   * supplies it, via `WeekGauges`'s matching lab-only prop) can retune the
   * "single knob worth tuning" live, by eye, without editing the constant.
   */
  holdMs?: number;
  /**
   * Override how long stage 1 is held before stage 2 may begin (default
   * `MOUNT_SWEEP_MS`, i.e. `useGaugeTween`'s own duration). Same lab-only
   * caveat as `holdMs`: production never passes this, so omitting it keeps
   * behaviour byte-identical to before this field existed.
   */
  sweepMs?: number;
}

export interface ArrivalState {
  /** Feed to `useGaugeTween` as the target. */
  meters: number;
  /** True from the start of stage 2 — drives the leading-edge highlight. */
  arriving: boolean;
}

export function useArrivalMeters({
  actualMeters,
  arrivalMeters,
  reduceMotion,
  onSettled,
  holdMs = ARRIVAL_HOLD_MS,
  sweepMs = MOUNT_SWEEP_MS,
}: ArrivalInput): ArrivalState {
  // Whether there IS an arrival to stage at all, independent of motion
  // preference — Reduce Motion still needs to know this to render the
  // leading-edge highlight (see `arriving` below); only the two-stage TIMING
  // is motion-gated.
  const hasArrival = arrivalMeters != null && arrivalMeters > 0;
  const active = hasArrival && !reduceMotion;
  const preMeters = preRunMeters(actualMeters, arrivalMeters ?? 0);

  const [released, setReleased] = useState(!active);
  // Held in a ref so a re-rendered parent passing a fresh closure cannot
  // re-arm the timers and fire the settle twice.
  const settledRef = useRef(false);
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  // Each distinct arrival must restage from the pre-run value AND earn its own
  // `onSettled` call. This adjustment happens during RENDER, not in an effect:
  // a passive effect is not guaranteed to flush before the commit reaches the
  // native tree, so resetting there let a second arrival commit its SETTLED
  // end-state for a frame before snapping back to stage 1 — a visible flicker
  // on exactly the path this protects. (That ordering isn't observable from a
  // synchronous hook test — `rerender()` inside `act()` flushes the effect
  // before any assertion runs — so this must not be "simplified" back into the
  // effect on the strength of a green suite; see the test file.)
  //
  // The key is deliberately NOT gated on `active`: `active` is false for the
  // entire Reduce Motion path, so an `active`-gated key would read as the same
  // 'none' identity across every Reduce Motion arrival and this block would
  // never re-fire for a second one. Keying on the raw arrival value instead
  // makes it sensitive to distinct arrivals in every motion mode.
  const arrivalKey = arrivalMeters != null && arrivalMeters > 0 ? String(arrivalMeters) : 'none';
  const [seenArrival, setSeenArrival] = useState(arrivalKey);
  if (arrivalKey !== seenArrival) {
    setSeenArrival(arrivalKey);
    setReleased(!active);
    // Gates the one-shot `onSettled` call below. Reset here, alongside
    // `released`, so Reduce Motion (which never enters the effect's `active`
    // branch) still gets a fresh gate per distinct arrival — an effect-only
    // reset silently starved every Reduce Motion arrival after the first.
    settledRef.current = false;
  }

  useEffect(() => {
    if (!active) {
      // Reduce Motion (and the no-arrival path) still has to acknowledge, or the
      // moment replays on every Dash open until the 48h recency window closes.
      setReleased(true);
      if (arrivalMeters == null || arrivalMeters <= 0) return; // nothing banked, nothing to hold
      // Important-2 fix: acknowledging in THIS commit gave the highlight one
      // render's lifetime before the caller's ack nulled `arrivalMeters` and
      // it vanished — imperceptible versus the motion path's ~600ms. Hold for
      // `sweepMs` (default `MOUNT_SWEEP_MS`), matching how long the motion
      // path's own highlight stays lit (release → settle), so Reduce Motion
      // gets a highlight a runner can actually see, not a bug fixed only on
      // paper.
      const settle = setTimeout(() => {
        if (settledRef.current) return;
        settledRef.current = true;
        onSettledRef.current?.();
      }, sweepMs);
      return () => clearTimeout(settle);
    }

    const release = setTimeout(() => {
      setReleased(true);
      // One light haptic AT THE START of stage 2 — the beat the new miles
      // start counting, not the mount sweep everyone already gets. `active`
      // already excludes Reduce Motion, so no separate guard is needed here.
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    }, sweepMs + holdMs);
    const settle = setTimeout(() => {
      if (settledRef.current) return;
      settledRef.current = true;
      onSettledRef.current?.();
    }, sweepMs + holdMs + sweepMs);

    // FIX 7 — WHY this cleanup can silently "swallow" an arrival's onSettled:
    // a second arrival landing inside this ~1.45s window remounts this effect
    // (new `arrivalKey`), and this cleanup clears the FIRST arrival's pending
    // timers before they fire — so the first arrival never calls its own
    // `onSettled`. That is correct, not a bug: `acknowledge()` records the
    // NEWEST run's `start_date`, which already supersedes the interrupted one,
    // so nothing is left unacknowledged — it would just be a redundant second
    // call for the same effective "seen" state.
    return () => {
      clearTimeout(release);
      clearTimeout(settle);
    };
    // `holdMs`/`sweepMs` are included so the lab's live sliders actually
    // retime a running effect; every real caller omits them, so they are
    // referentially stable (the module constants) and never cause this to
    // re-fire in production.
  }, [active, arrivalMeters, holdMs, sweepMs]);

  return {
    meters: released ? actualMeters : preMeters,
    // FIX 3b: gated on `hasArrival`, NOT `active` — `active` folds in
    // `!reduceMotion`, which used to make this permanently false under Reduce
    // Motion and so the highlight could never render there. Reduce Motion
    // still has a real arrival to show; it just skips the two-stage TIMING
    // (`released` is already true on the very first render in that case, so
    // this reads true immediately — "appears... without movement").
    arriving: hasArrival && released,
  };
}
