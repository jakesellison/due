/**
 * The two-stage arrival. The Dash ALREADY sweeps the contract track 0→value on
 * every mount (`useGaugeTween`), so an arrival that simply targets the true
 * value is invisible — it is the ordinary mount sweep. This hook exists to hold
 * the target at the PRE-RUN value until that sweep has landed, then release it,
 * which is what makes the new miles read as arriving.
 *
 * `app` Jest project (jest-expo). Run with --forceExit.
 */
import { act, renderHook } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';

import {
  useArrivalMeters,
  ARRIVAL_HOLD_MS,
  MOUNT_SWEEP_MS,
} from '../useArrivalMeters';

jest.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Light: 'light' },
  impactAsync: jest.fn().mockResolvedValue(undefined),
}));

const TRUE_METERS = 90_000;
const RUN_METERS = 12_000;
const PRE_METERS = TRUE_METERS - RUN_METERS;

beforeEach(() => {
  jest.useFakeTimers();
  (Haptics.impactAsync as jest.Mock).mockClear();
});
afterEach(() => jest.useRealTimers());

describe('useArrivalMeters', () => {
  it('holds the PRE-RUN value through stage 1', () => {
    // The regression that matters: if this returns TRUE_METERS immediately, the
    // celebration silently collapses into the ordinary mount sweep and nothing
    // fails — no error, no glitch, just a missing moment.
    const { result } = renderHook(() =>
      useArrivalMeters({
        actualMeters: TRUE_METERS,
        arrivalMeters: RUN_METERS,
        reduceMotion: false,
      }),
    );
    expect(result.current.meters).toBe(PRE_METERS);
    expect(result.current.arriving).toBe(false);
  });

  it('releases to the true value after the sweep and the hold', () => {
    const { result } = renderHook(() =>
      useArrivalMeters({
        actualMeters: TRUE_METERS,
        arrivalMeters: RUN_METERS,
        reduceMotion: false,
      }),
    );

    act(() => {
      jest.advanceTimersByTime(MOUNT_SWEEP_MS + ARRIVAL_HOLD_MS - 1);
    });
    expect(result.current.meters).toBe(PRE_METERS);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(2);
    });
    expect(result.current.meters).toBe(TRUE_METERS);
    expect(result.current.arriving).toBe(true);
  });

  // FIX 3a — spec: "one light haptic at the start of stage 2." The deleted
  // BankedCelebration fired haptics; this branch had none until now.
  it('fires exactly one light haptic at the start of stage 2', () => {
    renderHook(() =>
      useArrivalMeters({
        actualMeters: TRUE_METERS,
        arrivalMeters: RUN_METERS,
        reduceMotion: false,
      }),
    );

    act(() => {
      jest.advanceTimersByTime(MOUNT_SWEEP_MS + ARRIVAL_HOLD_MS - 1);
    });
    expect(Haptics.impactAsync).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(2);
    });
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
  });

  // FIX 3a — Reduce Motion suppresses the haptic too: there is no stage 2 to
  // mark the start of, so nothing should fire at all.
  it('fires no haptic under Reduce Motion', () => {
    renderHook(() =>
      useArrivalMeters({
        actualMeters: TRUE_METERS,
        arrivalMeters: RUN_METERS,
        reduceMotion: true,
      }),
    );
    act(() => {
      jest.advanceTimersByTime(5_000);
    });
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  it('calls onSettled exactly once, after stage 2 finishes', () => {
    const onSettled = jest.fn();
    renderHook(() =>
      useArrivalMeters({
        actualMeters: TRUE_METERS,
        arrivalMeters: RUN_METERS,
        reduceMotion: false,
        onSettled,
      }),
    );

    act(() => {
      jest.advanceTimersByTime(MOUNT_SWEEP_MS + ARRIVAL_HOLD_MS);
    });
    expect(onSettled).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(MOUNT_SWEEP_MS);
    });
    expect(onSettled).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(5_000);
    });
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('under Reduce Motion snaps to the true value AND still settles', () => {
    // The likely regression: acknowledgement is attached to an animation that
    // never runs, so the moment replays on every Dash open for 48h.
    const onSettled = jest.fn();
    const { result } = renderHook(() =>
      useArrivalMeters({
        actualMeters: TRUE_METERS,
        arrivalMeters: RUN_METERS,
        reduceMotion: true,
        onSettled,
      }),
    );
    expect(result.current.meters).toBe(TRUE_METERS);
    // FIX 3b: the design spec calls for the leading-edge highlight to "appear
    // and fade without movement" under Reduce Motion — `arriving` must be true
    // immediately, not permanently false. Before the fix this folded
    // `!reduceMotion` into the gate, so the highlight could never render here.
    expect(result.current.arriving).toBe(true);
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(onSettled).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(5_000);
    });
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  // Important 2 — the highlight must be PERCEIVABLE, not just present for a
  // single commit. Before this fix, `onSettled` fired in the SAME effect that
  // first rendered `arriving: true`, so the caller's ack nulled `arrivalMeters`
  // (and `arriving` with it) before the next paint — ~16-32ms versus the
  // motion path's ~600ms. This pins the hold's actual DURATION.
  it('holds the highlight for MOUNT_SWEEP_MS under Reduce Motion before settling', () => {
    const onSettled = jest.fn();
    const { result } = renderHook(() =>
      useArrivalMeters({
        actualMeters: TRUE_METERS,
        arrivalMeters: RUN_METERS,
        reduceMotion: true,
        onSettled,
      }),
    );
    expect(result.current.arriving).toBe(true);

    act(() => {
      jest.advanceTimersByTime(MOUNT_SWEEP_MS - 1);
    });
    expect(onSettled).not.toHaveBeenCalled();
    expect(result.current.arriving).toBe(true);

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('is inert with no arrival — the ordinary week-browse path', () => {
    const onSettled = jest.fn();
    const { result } = renderHook(() =>
      useArrivalMeters({
        actualMeters: TRUE_METERS,
        arrivalMeters: null,
        reduceMotion: false,
        onSettled,
      }),
    );
    expect(result.current.meters).toBe(TRUE_METERS);
    expect(result.current.arriving).toBe(false);
    act(() => {
      jest.advanceTimersByTime(5_000);
    });
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('stages a SECOND arrival on a reused instance (browse away and back)', () => {
    // Reachable in normal use: leaving the live week clears arrivalMeters, and
    // returning to it sets a new one on the SAME mounted hook. If `released`
    // survives from the first arrival, the second silently skips its staging.
    const onSettled = jest.fn();
    const { result, rerender } = renderHook(
      ({ arrivalMeters }: { arrivalMeters: number | null }) =>
        useArrivalMeters({ actualMeters: TRUE_METERS, arrivalMeters, reduceMotion: false, onSettled }),
      { initialProps: { arrivalMeters: RUN_METERS } },
    );

    act(() => {
      jest.advanceTimersByTime(MOUNT_SWEEP_MS + ARRIVAL_HOLD_MS + MOUNT_SWEEP_MS);
    });
    expect(result.current.meters).toBe(TRUE_METERS);
    expect(onSettled).toHaveBeenCalledTimes(1);

    rerender({ arrivalMeters: null });          // browsed away
    rerender({ arrivalMeters: RUN_METERS });    // browsed back — a new arrival

    // Must land back on stage 1 with the highlight OFF — not the prior
    // arrival's settled end-state for even a frame (that flicker is the bug
    // this reset guards against; see useArrivalMeters.ts).
    expect(result.current.meters).toBe(PRE_METERS);
    expect(result.current.arriving).toBe(false);

    // "At most once PER DISTINCT ARRIVAL" — the second, genuinely distinct
    // arrival earns its own onSettled once ITS timers complete.
    act(() => {
      jest.advanceTimersByTime(MOUNT_SWEEP_MS + ARRIVAL_HOLD_MS + MOUNT_SWEEP_MS);
    });
    expect(result.current.meters).toBe(TRUE_METERS);
    expect(onSettled).toHaveBeenCalledTimes(2);
  });

  // `holdMs`/`sweepMs` exist ONLY for `app/lab/run-arrival.tsx` to retune the
  // feel live. These two tests are the contract that protects production:
  // omitting the fields must be byte-identical to before they existed, and
  // supplying them must genuinely retime the staged release (not just be
  // accepted and ignored).
  it('defaults holdMs/sweepMs to the module constants when omitted', () => {
    const { result } = renderHook(() =>
      useArrivalMeters({
        actualMeters: TRUE_METERS,
        arrivalMeters: RUN_METERS,
        reduceMotion: false,
      }),
    );

    act(() => {
      jest.advanceTimersByTime(MOUNT_SWEEP_MS + ARRIVAL_HOLD_MS - 1);
    });
    expect(result.current.meters).toBe(PRE_METERS);

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current.meters).toBe(TRUE_METERS);
  });

  it('releases on the OVERRIDDEN holdMs/sweepMs, not the module constants', () => {
    const shortHold = 10;
    const shortSweep = 20;
    const { result } = renderHook(() =>
      useArrivalMeters({
        actualMeters: TRUE_METERS,
        arrivalMeters: RUN_METERS,
        reduceMotion: false,
        holdMs: shortHold,
        sweepMs: shortSweep,
      }),
    );

    // Still held just short of the OVERRIDDEN release point, well inside
    // where the default timing (MOUNT_SWEEP_MS + ARRIVAL_HOLD_MS) would still
    // be holding too — so this alone wouldn't prove the override took effect.
    act(() => {
      jest.advanceTimersByTime(shortSweep + shortHold - 1);
    });
    expect(result.current.meters).toBe(PRE_METERS);

    // The override's release point — well before the DEFAULT timing would
    // ever release. Only reachable if holdMs/sweepMs actually replaced the
    // constants inside the hook.
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current.meters).toBe(TRUE_METERS);
    expect(shortSweep + shortHold).toBeLessThan(MOUNT_SWEEP_MS + ARRIVAL_HOLD_MS);
  });

  it('stages a SECOND arrival under Reduce Motion on a reused instance (browse away and back)', () => {
    // Reduce Motion never runs the two-stage animation (`active` is always
    // false), but `onSettled` must still fire once PER DISTINCT ARRIVAL — not
    // just once ever. If the settle gate only ever resets on the `active`
    // branch of the effect, Reduce Motion never reaches it, so a second,
    // genuinely distinct arrival is silently dropped: the moment replays on
    // every Dash open for 48h for any Reduce-Motion user.
    const onSettled = jest.fn();
    const { result, rerender } = renderHook(
      ({ arrivalMeters }: { arrivalMeters: number | null }) =>
        useArrivalMeters({ actualMeters: TRUE_METERS, arrivalMeters, reduceMotion: true, onSettled }),
      { initialProps: { arrivalMeters: RUN_METERS } },
    );

    act(() => {
      jest.advanceTimersByTime(MOUNT_SWEEP_MS);
    });
    expect(result.current.meters).toBe(TRUE_METERS);
    expect(onSettled).toHaveBeenCalledTimes(1);

    rerender({ arrivalMeters: null });          // browsed away
    rerender({ arrivalMeters: RUN_METERS });    // browsed back — a new arrival

    act(() => {
      jest.advanceTimersByTime(MOUNT_SWEEP_MS);
    });
    expect(result.current.meters).toBe(TRUE_METERS);
    expect(onSettled).toHaveBeenCalledTimes(2);
  });
});
