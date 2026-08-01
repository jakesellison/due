/**
 * ContractMetMoment — the run that closed the week's mileage contract.
 *
 * The one escalation above the inline arrival. It does not invent a shape: the
 * week's `WeekContractStamp` — the same seal that lives permanently in the
 * Training Block grid below — is rendered here at hero scale, so the
 * celebration and the record are the same object.
 *
 * THE THREE BANDS. A seal alone reads as an empty award screen (Nike Training
 * Club's "3X in a week" is exactly that, and it is the sparsest of the pattern).
 * The ones that feel earned — Ladder, Elevate, Apple Fitness, komoot — all
 * stack the same three bands, and this does too:
 *
 *   1. the SEAL      — what was earned (the stamp + the mileage ratio)
 *   2. the EVIDENCE  — the week's other two contracts as NUMBERS, plus the run
 *                      that closed it
 *   3. the HORIZON   — the plan week and the streak it extends, in the eyebrow
 *
 * On band 2: the stamp's violet/cyan arcs encode quality/long as HIT or MISSED
 * — a binary. The numbers beside them carry the magnitude the arcs cannot
 * (5.9 short of 6.0 and 12.0 over 6.0 draw the same hollow/filled arc). That is
 * additive information, not the restated label DESIGN.md rules out, which is
 * also why a `✓ QUALITY ✓ LONG` tick row is deliberately NOT what is drawn. A
 * goal with no prescription that week renders no row at all rather than "0 / 0".
 *
 * Distances and pace are formatted here from RAW meters/seconds against the
 * runner's unit preference — `BankedInfo` deliberately hands over unformatted
 * values, because any `/mi` string baked upstream would lie to a km runner.
 *
 * THE STRIKE: on mount, one shared clock (`progress`, 0→1 over `STRIKE_MS`)
 * drives a single authored beat, not per-element tweens — the card fades in
 * as CONTEXT while the stamp (the subject) arrives oversized and dips
 * slightly under its resting scale before landing exactly on the shipped
 * `transform: [{ scale: 2.2 }]`: a seal pressed onto the page, not a fade-in.
 * This is this component's OWN entrance, separate from `WeekContractStamp`'s
 * internal `didMount`-gated settle/echo (guards its main use, a grid of many
 * stamps that must not all animate on scroll — untouched, see that file).
 * Reduce Motion seeds `progress` at 1 directly, so no timing call ever runs
 * and the moment appears at rest with zero intermediate frames.
 *
 * THE SHAPE: a scrimmed, content-sized centered overlay — what the modal audit
 * (docs/screen-atlas/modal-standardization.md) records for this surface, "a
 * valid acknowledgement overlay, not a sheet". It is deliberately NOT the app's
 * sheet grammar, which reads as "do a task" and belongs to editors and drills;
 * and deliberately not a full-screen takeover, because Due never owns the
 * finish-a-run flow a takeover would terminate — this fires when the runner
 * opens the Dash and finds it already true, so a takeover would be an
 * interstitial in front of what they came for.
 *
 * The overlay OWNS the screen while it is up: the scrim below dims the Dash and
 * absorbs taps, and tapping it dismisses (`onDismiss`). It previously carried
 * `pointerEvents="box-none"` with no scrim, on the theory that it was anchored
 * rather than modal — but the anchoring that was in service of (the design
 * spec's Tier 2: strike anchored to the contract card, then a destination
 * highlight in the Training Block grid) was never built, and at this card's
 * height it would cover most of the Dash anyway, making the anchor nominal.
 * That direction is retired, not deferred; this is the shape.
 *
 * Acknowledgement: View/Close call `onView`/`onDismiss` directly, and so does a
 * scrim tap. The runner can also LEAVE without tapping any of them (switch
 * tabs, navigate elsewhere) — `useFocusEffect`'s blur/unmount cleanup treats
 * that as a dismissal too. Without it, the moment would replay on every Dash
 * open for the 48h recency window purely because nobody ever tapped Close.
 *
 * KNOWN GAP: `useFocusEffect` only fires its cleanup on a navigation blur or
 * unmount — it does NOT fire on the app being backgrounded. A runner who sees
 * this, backgrounds the app, and the OS later kills the process never runs
 * this cleanup, so the moment replays on the next open within the 48h window.
 * Catching that would need an AppState listener; not built (out of scope for
 * this pass).
 *
 * Labels + numbers only — no narrated copy.
 */
import { useCallback, useEffect, useRef } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { ActionButton, ActionButtonLabel } from '@/components/ActionButton';
import { Divider } from '@/components/ui/Divider';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { GhostButton } from '@/components/ui/GhostButton';
import { WeekContractStamp } from '@/components/WeekContractStamp';
import { formatDistance, formatPace, metersToUnits, type Units } from '@/lib';
import { useAppPreferences } from '@/app-lib/preferences';
import type { GoalStat, WeekGoal } from '@/lib/kpi/weekGoals';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { dataRegular, display, fontSizes, motion, radius, SCRIM, space, type Tokens } from '@/theme/tokens';

// The moment's own entrance (see header comment). One clock, ONE authored
// beat — deliberately not a per-element choreography. Duration sits between
// the app's snappy press feedback (motion.pressMs/releaseMs, ~120-140ms) and
// the Dash gauge's ~600ms sweep (useGaugeTween.DURATION_MS): this is a
// one-shot reveal, not a persistent control, so it can afford a beat slower
// than a tap without reading sluggish. `motion.easeOut` is the house
// entering-UI bezier — reused rather than inventing a new curve.
const STRIKE_MS = 380;
const STRIKE_EASE = Easing.bezier(...motion.easeOut);
// The stamp arrives oversized (as if still swinging down), dips slightly
// UNDER its resting scale — the "touch of overshoot" a die makes compressing
// into paper, not a bouncy pop-in — then lands. The interpolation's own
// endpoints guarantee that landing is EXACTLY 1 (i.e. the shipped
// `stampScale` transform composes to precisely `scale: 2.2`, never
// asymptotically), which is what "ends there" requires.
const STAMP_OVERSIZE = 1.16;
const STAMP_UNDERSHOOT = 0.985;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** The run that closed the contract — the raw facts, formatted here (see header). */
export interface ClosingRun {
  /** Short uppercase kind, e.g. "TEMPO" / "LONG RUN" / "RACE" / "RUN". */
  label: string;
  distanceMeters: number;
  movingTimeS: number | null;
}

/**
 * "6.4 / 6.0" for a supporting goal, or null when the week prescribed none —
 * an unprescribed goal has nothing to report, and "0.0 / 0.0" would read as a
 * failure rather than an absence.
 */
function goalReading(stat: GoalStat, units: Units): string | null {
  if (!(stat.targetMeters > 0)) return null;
  const actual = metersToUnits(stat.actualMeters, units);
  const target = metersToUnits(stat.targetMeters, units);
  return `${actual.toFixed(1)} / ${target.toFixed(1)}`;
}

export function ContractMetMoment({
  week,
  run = null,
  streakWeeks = 1,
  onView,
  onDismiss,
}: {
  week: WeekGoal;
  /** Absent when the Dash can't identify the closing run — the line is dropped. */
  run?: ClosingRun | null;
  /**
   * Consecutive met weeks INCLUDING this one, so the first met week is 1. At 1
   * there is no streak to report and only the plan week is shown.
   */
  streakWeeks?: number;
  onView: () => void;
  onDismiss: () => void;
}) {
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { preferences } = useAppPreferences();
  const units = preferences.distance;
  const banked = metersToUnits(week.mileage.actualMeters, units);
  const target = metersToUnits(week.mileage.targetMeters, units);

  // Band 3 — the horizon. The plan week always; the streak only once there is
  // one, so "W1" doesn't get dressed up as "W1 · 1 IN A ROW".
  const ledger = streakWeeks > 1 ? `${week.label} · ${streakWeeks} IN A ROW` : week.label;

  // Band 2 — the supporting contracts, by magnitude. `qualText`/`cyanText` are
  // the text-safe variants of the same violet/cyan the stamp's arcs use, so
  // each row is visibly the arc it belongs to.
  const supporting = [
    { key: 'QUALITY', reading: goalReading(week.quality, units), color: C.qualText },
    { key: 'LONG', reading: goalReading(week.long, units), color: C.cyanText },
  ].filter((g): g is { key: string; reading: string; color: string } => g.reading != null);

  // Band 2 — the run that closed it. Pace is derived from the raw meters and
  // seconds so km runners see `/km` (see header comment).
  const runLine = (() => {
    if (!run) return null;
    const parts = [run.label, formatDistance(run.distanceMeters, units)];
    if (run.movingTimeS && run.movingTimeS > 0 && run.distanceMeters > 0) {
      parts.push(formatPace(run.movingTimeS / (run.distanceMeters / 1000), units));
    }
    return parts.join(' · ');
  })();

  // THE STRIKE — one clock for one authored beat (see header comment).
  // `useReducedMotion` (not the `AccessibilityInfo` listener CalendarTabs
  // uses) because this is the SAME family of motion as WeekContractStamp's
  // own settle/echo on the same object (WeekContractStamp.tsx:82) — reusing
  // that idiom stays consistent — and because this moment mounts once and
  // plays once: a live toggle mid-playback isn't a case worth the extra
  // listener plumbing. Reduce Motion seeds `progress` AT its finished value
  // rather than animating to it, so there is no intermediate frame to
  // suppress — the moment is simply drawn at rest.
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(reducedMotion ? 1 : 0);
  useEffect(() => {
    if (reducedMotion) return; // already seeded at rest — nothing to play
    progress.value = withTiming(1, { duration: STRIKE_MS, easing: STRIKE_EASE });
  }, [progress, reducedMotion]);
  // Card: context, not the subject — a plain fade tied to the SAME clock.
  const cardEntranceStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  // Scrim: same clock again, so the Dash recedes exactly as the seal lands
  // rather than blacking out first and revealing a card into an already-dark
  // screen. Its own opacity is baked into the colour (see `scrim` below), so
  // this only scales it in.
  const scrimEntranceStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  // Stamp: the subject — oversize -> undershoot -> exactly 1, composed on
  // top of (not replacing) the static `stampScale` transform below.
  const stampStrikeStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: interpolate(progress.value, [0, 0.6, 1], [STAMP_OVERSIZE, STAMP_UNDERSHOOT, 1], 'clamp') },
    ],
  }));

  // FIX 1 — acknowledge on leave, not just on tap. `useFocusEffect`'s cleanup
  // fires on BOTH blur and unmount, unlike a plain `useEffect` unmount-only
  // cleanup: expo-router's tab navigator keeps blurred tab screens MOUNTED
  // (no unmountOnBlur), so this component never unmounts just from switching
  // tabs — only a real navigation blur event catches that case. A guard ref
  // keeps this from double-firing when the runner already tapped View/Close
  // (harmless either way — `acknowledge` is idempotent — but one clear call
  // site per moment is easier to reason about and to test).
  //
  // `onDismiss` is read from a ref (same pattern as `onSettledRef` in
  // useArrivalMeters), not a `useCallback` dependency: the parent passes a
  // fresh closure most renders, and putting it in the dep array would make
  // `useFocusEffect` re-subscribe on every such render — which fires ITS
  // cleanup too, i.e. a spurious acknowledge on an ordinary re-render, not a
  // real leave. The ref always holds the LATEST `onDismiss` at the moment the
  // cleanup actually runs, with a stable effect identity in between.
  const ackedRef = useRef(false);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  useFocusEffect(
    useCallback(() => {
      ackedRef.current = false;
      return () => {
        if (ackedRef.current) return;
        ackedRef.current = true;
        onDismissRef.current();
      };
    }, []),
  );
  const handleView = () => {
    ackedRef.current = true;
    onView();
  };
  const handleDismiss = () => {
    ackedRef.current = true;
    onDismiss();
  };

  return (
    // A real RN Modal, not an in-tree overlay. The Dash renders INSIDE the tab
    // navigator, so an absolutely-positioned overlay stops at the screen's own
    // bounds and the TAB BAR stays fully lit on top of the scrim — the exact
    // half-modal tell this shape was fixed to remove. A Modal gets its own
    // window above the navigator, so the scrim actually covers everything.
    // `animationType="none"` because this component owns its entrance (the
    // strike); letting the Modal slide as well would be two entrances fighting.
    // `onRequestClose` wires Android's back gesture to the same dismissal as the
    // scrim — an affordance an in-tree overlay could not have had at all.
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={handleDismiss}>
      <View testID="contract-met-root" style={styles.root}>
        {/* Full-bleed and BEHIND the card, following the app's centered-overlay
            idiom (WorkoutEditorModal's `backdrop`): it dims the Dash, absorbs
            every tap that isn't on the card, and dismisses on tap. Exposed to
            assistive tech as a real control the same way that one is, rather
            than as an invisible tap zone. */}
        <AnimatedPressable
          testID="contract-met-scrim"
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          onPress={handleDismiss}
          style={[styles.scrim, scrimEntranceStyle]}
        />
        <Animated.View testID="contract-met-card" style={[styles.card, cardEntranceStyle]}>
          {/* `flexWrap` rather than truncation: at a large Dynamic Type scale (or
              a long "W23 · 18 IN A ROW") the ledger drops to its own line instead
              of eliding a number — a clipped streak is a wrong streak. */}
          <View style={styles.header}>
            <Eyebrow>CONTRACT MET</Eyebrow>
            <Text style={styles.ledger}>{ledger}</Text>
          </View>

          {/* The seal is the hero. Scaled, not re-drawn — the same motif as the
              grid below, where it comes to rest at natural size. `slotStyle` is
              set explicitly because the component's own default (`stampSlot`'s
              16.666% width) is meaningful only inside the six-column grid; this
              is the one place the stamp renders standalone, so it gets its real
              footprint (matching `sealFrame`'s fixed 44×44) instead. The strike
              (`stampStrikeStyle`) is a SEPARATE ancestor layer around the
              static `stampScale` transform, not a change to it — the shipped
              resting composition (2.2 × 1 = 2.2) is untouched. */}
          <View style={styles.stampWrap}>
            <Animated.View testID="contract-met-strike" style={stampStrikeStyle}>
              <View style={styles.stampScale}>
                <WeekContractStamp
                  week={week}
                  testIDPrefix="contract-met-stamp"
                  slotStyle={{ width: 44 }}
                />
              </View>
            </Animated.View>
          </View>

          <View style={styles.valueRow}>
            <Text style={styles.value}>{banked.toFixed(1)}</Text>
            <Text style={styles.of}>{` / ${target.toFixed(0)} ${units}`}</Text>
          </View>

          {supporting.length > 0 ? (
            <View testID="contract-met-supporting" style={styles.goals}>
              {supporting.map((g) => (
                <View
                  key={g.key}
                  style={styles.goalRow}
                  accessible
                  accessibilityLabel={`${g.key} ${g.reading} ${units}`}
                >
                  {/* Number carries the accent, key stays mute — the app-wide
                      triad encoding (PlanBlueprint, block panel, WeekGauges). */}
                  <Eyebrow>{g.key}</Eyebrow>
                  <Text style={[styles.goalValue, { color: g.color }]}>{g.reading}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {runLine ? (
            <>
              <Divider style={styles.rule} />
              <Text testID="contract-met-run" style={styles.runLine}>
                {runLine}
              </Text>
            </>
          ) : null}

          <View style={styles.actions}>
            <ActionButton
              color={C.yellow}
              accessibilityLabel="View run"
              onPress={handleView}
              style={styles.primary}
              contentStyle={styles.primaryFace}
            >
              <ActionButtonLabel>View run</ActionButtonLabel>
            </ActionButton>
            <GhostButton label="Close" onPress={handleDismiss} style={styles.dismiss} />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    root: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'center' },
    // The shared SCRIM. This was a locally-reasoned 0.72 ("centered overlays
    // need the page further back than sheets do") — defensible in isolation,
    // but it was one of five different hand-written scrim values across six
    // surfaces. How far the page goes back is one product decision, so it is
    // now one token.
    scrim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: SCRIM },
    card: {
      marginHorizontal: space.lg,
      padding: space.xl,
      borderRadius: radius.lg,
      backgroundColor: C.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.line,
      alignItems: 'center',
    },
    header: {
      alignSelf: 'stretch',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      columnGap: space.sm,
      rowGap: space.xxs,
    },
    // The horizon reads as a record, not a headline: same size as the eyebrow,
    // dimmer, on the numeric face because it is a week index and a count.
    ledger: { color: C.faint, fontSize: fontSizes.labelSm, fontFamily: dataRegular, letterSpacing: 0.5 },
    // The scaled node is `sealFrame` (fixed 44x44), not the 38pt SVG inside it —
    // 44 x 2.2 = 96.8pt. Height is rounded up to fully contain that box.
    stampWrap: { height: 97, alignItems: 'center', justifyContent: 'center', marginVertical: space.m },
    stampScale: { transform: [{ scale: 2.2 }] },
    valueRow: { flexDirection: 'row', alignItems: 'baseline' },
    value: { color: C.ink, fontSize: fontSizes.numeralXl, fontFamily: display, letterSpacing: -1 },
    of: { color: C.mute, fontSize: fontSizes.body, fontWeight: '700' },
    // Supporting contracts. `dataRegular` (not the bold `data`) on purpose:
    // these are secondary to the mileage hero above and bold numerals here
    // would read as a second primary metric.
    goals: { alignSelf: 'stretch', marginTop: space.md, gap: space.xs },
    goalRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    goalValue: { color: C.ink, fontSize: fontSizes.label, fontFamily: dataRegular },
    rule: { marginTop: space.lg },
    runLine: {
      color: C.mute,
      fontSize: fontSizes.metadata,
      fontFamily: dataRegular,
      letterSpacing: 0.3,
      textAlign: 'center',
      marginTop: space.md,
    },
    actions: { flexDirection: 'row', gap: space.sm, marginTop: space.lg, alignSelf: 'stretch' },
    primary: { flex: 1 },
    primaryFace: { alignItems: 'center', justifyContent: 'center', paddingVertical: space.s },
    // `minHeight: 0` overrides GhostButton's standalone 48pt face on purpose:
    // this secondary is one half of an action PAIR, and the row's height is set
    // by the ActionButton beside it. Leaving 48 in would push the row taller than
    // the primary's face and strand the yellow button at the top of it.
    dismiss: { flex: 1, minHeight: 0 },
  });
