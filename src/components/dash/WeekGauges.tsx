/**
 * WeekGauges — the mileage-led contract for the browsed week.
 *
 * Mileage is deliberately the dominant vessel: it is the week's primary
 * verdict. Quality and Long run stay visible as independent supporting goals,
 * but they cannot visually (or semantically) erase mileage already banked.
 * Actual/target pairs remain authoritative from the per-week goal data.
 *
 * The solid mileage fill is banked work. In the live week, its softer extension
 * is the current projection (banked + still-scheduled); any remainder after the
 * projection is the shortfall. The status row owns the pace judgment, so the
 * rail does not repeat it as an unexplained elapsed-plan marker.
 * Values glide between browsed weeks via `useGaugeTween`.
 */
import { memo } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { useAppPreferences, type DistancePreference } from '@/app-lib/preferences';
import { ContractGoalRing } from '@/components/ContractGoalRing';
import { cardSurface } from '@/components/Card';
import { Divider, hairlineTop } from '@/components/ui/Divider';
import { eyebrowText } from '@/components/ui/Eyebrow';
import { statValueText } from '@/components/ui/Stat';
import { metersToUnits } from '@/lib';
import { preRunMeters } from '@/lib/kpi/justBanked';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { display, fontSizes, radius, space, usesAccessibilityTextLayout, type Tokens } from '@/theme/tokens';
import { ContractVerdictMark } from './ContractVerdictMark';
import { ContractMileageTrack } from './ContractMileageTrack';
import { useArrivalMeters } from './useArrivalMeters';
import { useGaugeTween } from './useGaugeTween';

export interface PillarStat {
  actualMeters: number;
  targetMeters: number;
  /** Whether this supporting goal met its own threshold. */
  hit?: boolean;
  /** "Should be banked by now" meters (in-progress week only). */
  paceMeters?: number;
  /** Banked + still-scheduled meters (in-progress week only). */
  projectedMeters?: number;
  /** This supporting workout is prescribed today. */
  scheduledToday?: boolean;
}

export interface GaugeStats {
  mileage: PillarStat;
  quality: PillarStat;
  long: PillarStat;
}

export interface WeekContractStatus {
  /**
   * `behind` and `over-allocated` are mirrors — the remaining plan misses the
   * contract, or overshoots it — and they are deliberately NOT styled alike.
   * Behind is orange because something needs fixing before the week closes;
   * over-allocated is green because the runner is ahead and merely holds a plan
   * that no longer matches. One is a warning, the other an invitation.
   */
  state: 'on-pace' | 'behind' | 'over-allocated' | 'complete' | 'planned';
  headline: string;
  detail?: string;
  /** Healthy live weeks keep the action row without manufacturing a verdict. */
  quiet?: boolean;
  onAdjust?: () => void;
  actionLabel?: string;
  actionAccessibilityLabel?: string;
}

export type WeekPeriod = 'past' | 'current' | 'future';

const clampFrac = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);
const distance1 = (m: number, units: DistancePreference) => metersToUnits(m, units).toFixed(1);
const STAGGER_MS = 70;
const SUPPORT_COMPLETE_EPS_METERS = 80; // ~0.05 mi; avoids a rounded "0.0 mi left".
const SUPPORT_RING_SIZE = 18;
const SEMANTIC_TEXT_SCALE = 2;
const DISPLAY_TEXT_SCALE = 1.6;

/** One quantitative grammar for both supporting goals. Timing belongs to the
 * calendar/workout card, not these attainment cells. */
function supportingSummary(
  stat: PillarStat,
  period: WeekPeriod,
  units: DistancePreference,
): string | null {
  if (stat.targetMeters <= 0) return null;
  if (period === 'future') return null; // The value already says "planned".
  const remaining = Math.max(0, stat.targetMeters - stat.actualMeters);
  if (remaining <= SUPPORT_COMPLETE_EPS_METERS) return 'Goal met';
  return `${distance1(remaining, units)} ${units} ${period === 'past' ? 'short' : 'left'}`;
}

function SupportingGoal({
  id,
  label,
  color,
  stat,
  actualMeters,
  fraction,
  targetForward,
  period,
  accessibilityLayout,
  units,
}: {
  id: string;
  label: string;
  color: string;
  stat: PillarStat;
  actualMeters: number;
  fraction: number;
  targetForward: boolean;
  period: WeekPeriod;
  accessibilityLayout: boolean;
  units: DistancePreference;
}) {
  const styles = useThemedStyles(makeStyles);
  const hasTarget = stat.targetMeters > 0;
  const targetDistance = Math.round(metersToUnits(stat.targetMeters, units));
  const summary = supportingSummary(stat, period, units);
  const unitWord = units === 'mi' ? 'miles' : 'kilometers';

  return (
    <View
      testID={`supporting-goal-${id}`}
      style={styles.supportGoal}
      accessible
      accessibilityLabel={
        hasTarget
          ? period === 'future'
            ? `${label}: ${targetDistance} ${unitWord} planned`
            : `${label}: ${distance1(stat.actualMeters, units)} of ${targetDistance} ${unitWord}${summary ? `, ${summary}` : ''}`
          : `${label}: no goal this period`
      }
    >
      <View style={[styles.supportHead, accessibilityLayout && styles.supportHeadAccessible]}>
        <ContractGoalRing id={`supporting-goal-${id}`} fraction={fraction} color={color} />
        {/* The triad colours the NUMBER, not the key — the app-wide encoding
            (PlanBlueprint, the block panel). Colouring the label here made the
            same three values flip encoding between tabs. The ring still
            carries the accent, so the key stays anchored to its colour. */}
        <Text style={styles.supportLabel} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}>{label}</Text>
        {summary && summary !== 'Goal met' ? (
          <Text style={[styles.supportSummary, accessibilityLayout && styles.supportSummaryAccessible]} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}>{summary}</Text>
        ) : null}
      </View>
      {hasTarget && targetForward ? (
        <Text style={styles.supportTarget} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}>{`${targetDistance} ${units} planned`}</Text>
      ) : hasTarget ? (
        <View style={[styles.supportValueRow, accessibilityLayout && styles.supportValueRowAccessible]}>
          <Text style={[styles.supportValue, { color }]} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}>{distance1(actualMeters, units)}</Text>
          <Text style={styles.supportOf} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}>{` / ${targetDistance} ${units}`}</Text>
        </View>
      ) : (
        <Text style={styles.supportNone} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}>No goal</Text>
      )}
    </View>
  );
}

function WeekGaugesInner({
  stats,
  weekKey = 'week',
  weekRangeLabel,
  reduceMotion = false,
  period = 'current',
  status,
  arrivalMeters,
  onArrivalSettled,
  arrivalHoldMs,
  arrivalSweepMs,
}: {
  stats: GaugeStats;
  /** Whether the browsed week is settled, live, or upcoming. */
  period?: WeekPeriod;
  /** Identity of the browsed week; retained for caller/debug identity. */
  weekKey?: string;
  /** Civil date range identifying the selected weekly contract. */
  weekRangeLabel?: string;
  /** Reduce Motion snaps values straight to their final state. */
  reduceMotion?: boolean;
  /** Current-week pace verdict and the one tactical adjustment entry. */
  status?: WeekContractStatus;
  /** Meters a just-banked run contributed — stages the two-part arrival. */
  arrivalMeters?: number | null;
  /** Fired once when the arrival finishes; the Dash uses it to acknowledge. */
  onArrivalSettled?: () => void;
  /**
   * Lab-only overrides for the arrival hold/sweep timing, forwarded verbatim
   * to `useArrivalMeters`. The Dash never passes these; `app/lab/
   * run-arrival.tsx` is the only caller that does, so it can retune the feel
   * live without a second implementation of the staging logic.
   */
  arrivalHoldMs?: number;
  arrivalSweepMs?: number;
}) {
  const C = useTheme();
  const { preferences } = useAppPreferences();
  const units = preferences.distance;
  const unitWord = units === 'mi' ? 'miles' : 'kilometers';
  const styles = useThemedStyles(makeStyles);
  const { fontScale } = useWindowDimensions();
  const accessibilityLayout = usesAccessibilityTextLayout(fontScale);
  // The action carries the state's colour, and only for the two states that
  // have one: orange when the week needs rescuing, green when the plan is
  // simply richer than the contract. Everything else keeps the neutral ink.
  const actionInk =
    status?.state === 'behind'
      ? C.warningText
      : status?.state === 'over-allocated'
        ? C.positiveText
        : null;
  const fracOf = (s: PillarStat) => (s.targetMeters > 0 ? clampFrac(s.actualMeters / s.targetMeters) : 0);

  // A just-banked run animates in two stages (see useArrivalMeters): the mount
  // sweep lands on the PRE-RUN value, then the new miles are released. Feeding
  // the staged target to the existing tween is the whole mechanism.
  const arrival = useArrivalMeters({
    actualMeters: stats.mileage.actualMeters,
    arrivalMeters: arrivalMeters ?? null,
    reduceMotion,
    onSettled: onArrivalSettled,
    holdMs: arrivalHoldMs,
    sweepMs: arrivalSweepMs,
  });
  const stagedMileage: PillarStat = { ...stats.mileage, actualMeters: arrival.meters };

  const [mMeters = 0, mFrac = 0] = useGaugeTween(
    [stagedMileage.actualMeters, fracOf(stagedMileage)],
    reduceMotion,
    0,
  );
  const [qMeters = 0, qFrac = 0] = useGaugeTween(
    [stats.quality.actualMeters, fracOf(stats.quality)],
    reduceMotion,
    STAGGER_MS,
  );
  const [lMeters = 0, lFrac = 0] = useGaugeTween(
    [stats.long.actualMeters, fracOf(stats.long)],
    reduceMotion,
    STAGGER_MS * 2,
  );

  // Only a genuinely future week leads with its plan. The live week always
  // reports banked progress — including Monday at zero — so its hero grammar
  // remains stable from first mile through close.
  const targetForward = period === 'future';
  const live = period === 'current';
  const mileageHasTarget = stats.mileage.targetMeters > 0;
  const mileageTarget = Math.round(metersToUnits(stats.mileage.targetMeters, units));
  const mileageActual = metersToUnits(mMeters, units);
  const remaining = Math.max(0, metersToUnits(stats.mileage.targetMeters - stats.mileage.actualMeters, units));
  const over = Math.max(0, metersToUnits(stats.mileage.actualMeters - stats.mileage.targetMeters, units));
  const actualFraction = mileageHasTarget ? clampFrac(mFrac) : 0;
  const projectionFraction = mileageHasTarget
    ? clampFrac((stats.mileage.projectedMeters ?? stats.mileage.actualMeters) / stats.mileage.targetMeters)
    : 0;
  const projectedDelta = Math.max(0, projectionFraction - actualFraction);
  const projectionDistance = stats.mileage.projectedMeters == null
    ? null
    : Math.round(metersToUnits(stats.mileage.projectedMeters, units));
  const progressLabel = mileageHasTarget ? null : 'Set in your plan';
  const showProjection = live && projectionDistance != null;
  const sideValue = over > 0 ? `+${over.toFixed(1)}` : remaining.toFixed(1);
  const sideLabel = over > 0
    ? `${units} over`
    : remaining <= 0
      ? 'target met'
      : period === 'past'
        ? `${units} short`
        : `${units} left`;

  const mileageAccessibility = mileageHasTarget
    ? period === 'future'
      ? `Mileage: ${mileageTarget} ${unitWord} planned`
      : `${period === 'past' ? 'Mileage recap' : 'Mileage'}: ${distance1(stats.mileage.actualMeters, units)} of ${mileageTarget} ${unitWord}${
          projectionDistance == null ? '' : `, ${projectionDistance} ${unitWord} projected`
        }`
    : 'Mileage: no target this period';

  return (
    <View style={styles.root} testID={`week-contract-${weekKey}`}>
      <View testID="mileage-primary" style={styles.mileage}>
        <View
          style={styles.contractCore}
          accessible
          accessibilityLabel={`${weekRangeLabel ? `${weekRangeLabel}. ` : ''}${mileageAccessibility}`}
        >
          <View style={[styles.mileageHead, accessibilityLayout && styles.mileageHeadAccessible]}>
            <Text style={styles.eyebrow} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}>
              {weekRangeLabel && mileageHasTarget
                ? `Weekly contract · ${mileageTarget} ${units}`
                : 'Weekly contract'}
            </Text>
            {!weekRangeLabel ? (
              <Text style={styles.contractLabel} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}>
                {mileageHasTarget ? `${mileageTarget} ${units}` : 'No mileage target'}
              </Text>
            ) : null}
          </View>

          {mileageHasTarget && targetForward ? (
            <View style={[styles.targetForwardRow, accessibilityLayout && styles.targetForwardRowAccessible]}>
              <Text style={styles.mileageValue} maxFontSizeMultiplier={DISPLAY_TEXT_SCALE}>{mileageTarget}</Text>
              <Text style={styles.mileageUnit} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}>{units} planned</Text>
            </View>
          ) : mileageHasTarget ? (
            <View testID="mileage-value-row" style={[styles.mileageValueRow, accessibilityLayout && styles.mileageValueRowAccessible]}>
              <View style={[styles.mileageBankedValue, accessibilityLayout && styles.mileageBankedValueAccessible]}>
                <Text
                  style={styles.mileageValue}
                  numberOfLines={accessibilityLayout ? undefined : 1}
                  adjustsFontSizeToFit={!accessibilityLayout}
                  minimumFontScale={0.75}
                  maxFontSizeMultiplier={DISPLAY_TEXT_SCALE}
                >
                  {mileageActual.toFixed(1)}
                </Text>
                <Text style={styles.mileageUnit} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}>{units} banked</Text>
              </View>
              <View style={[styles.mileageSideValue, accessibilityLayout && styles.mileageSideValueAccessible]}>
                <Text style={styles.mileageSideNumber} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}>{sideValue}</Text>
                <Text style={styles.mileageSideLabel} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}>{sideLabel}</Text>
              </View>
            </View>
          ) : (
            <View style={[styles.targetForwardRow, accessibilityLayout && styles.targetForwardRowAccessible]}>
              <Text style={styles.mileageValue} maxFontSizeMultiplier={DISPLAY_TEXT_SCALE}>—</Text>
              <Text style={styles.mileageUnit} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}>no mileage target</Text>
            </View>
          )}

          <ContractMileageTrack
            actualFraction={actualFraction}
            projectedFraction={actualFraction + projectedDelta}
            arrivingFromFraction={
              arrival.arriving && stats.mileage.targetMeters > 0
                ? clampFrac(
                    preRunMeters(stats.mileage.actualMeters, arrivalMeters ?? 0) /
                      stats.mileage.targetMeters,
                  )
                : null
            }
            testID="week-contract-mileage-track"
          />

          {progressLabel || showProjection ? (
            <View style={[styles.mileageMeta, accessibilityLayout && styles.mileageMetaAccessible]}>
            {progressLabel ? (
              <Text style={styles.mileageMetaText} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}>
                {progressLabel}
              </Text>
            ) : null}
            {showProjection ? (
              <Text style={[styles.projectionText, accessibilityLayout && styles.projectionTextAccessible]} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}>
                {actualFraction >= 1
                  ? 'Target banked'
                  : projectionFraction >= 1
                    ? 'Rest of week allocated'
                    : `${projectionDistance} ${units} projected`}
              </Text>
            ) : null}
            </View>
          ) : null}
        </View>

        <View style={styles.supportBand}>
          <View testID="supporting-goals-row" style={[styles.supportRow, accessibilityLayout && styles.supportRowAccessible]} accessibilityLabel="Supporting weekly goals">
            <SupportingGoal
              id="quality"
              label="Quality"
              color={C.qualText}
              stat={stats.quality}
              actualMeters={qMeters}
              fraction={qFrac}
              targetForward={targetForward}
              period={period}
              accessibilityLayout={accessibilityLayout}
              units={units}
            />
            {/* The column rule between the two supporting goals. At an
                accessibility text size the row stacks, so the same rule turns
                horizontal and spans the full width. */}
            <Divider vertical style={accessibilityLayout ? styles.supportDividerAccessible : null} />
            <SupportingGoal
              id="long"
              label="Long run"
              color={C.cyanText}
              stat={stats.long}
              actualMeters={lMeters}
              fraction={lFrac}
              targetForward={targetForward}
              period={period}
              accessibilityLayout={accessibilityLayout}
              units={units}
            />
          </View>
        </View>

        {status ? (
          <View testID="week-contract-status" style={[styles.statusRow, accessibilityLayout && styles.statusRowAccessible]}>
            <View
              style={styles.statusCopy}
              accessible
              accessibilityLabel={[status.headline, status.detail].filter(Boolean).join('. ')}
            >
              {!status.quiet ? (
                <ContractVerdictMark
                  testID="week-contract-status-mark"
                  tone={status.state === 'behind' ? 'short' : status.state === 'planned' ? 'planned' : 'positive'}
                />
              ) : null}
              <View style={styles.statusText}>
                <Text
                  style={[styles.statusHeadline, status.quiet && styles.statusQuietHeadline]}
                  maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}
                >
                  {status.headline}
                </Text>
                {status.detail ? (
                  <Text style={styles.statusDetail} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}>{status.detail}</Text>
                ) : null}
              </View>
            </View>
            {status.onAdjust ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={status.actionAccessibilityLabel ?? 'Adjust this week'}
                hitSlop={4}
                onPress={status.onAdjust}
                style={({ pressed }) => [styles.adjustAction, accessibilityLayout && styles.adjustActionAccessible, pressed && styles.adjustActionPressed]}
              >
                <Text
                style={[styles.adjustActionText, actionInk ? { color: actionInk } : null]}
                maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}
                >
                  {status.actionLabel ?? 'Adjust'}
                </Text>
                <SymbolView
                  name="chevron.right"
                  size={10}
                  tintColor={actionInk ?? C.ink}
                  weight="bold"
                  resizeMode="scaleAspectFit"
                />
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

export const WeekGauges = memo(WeekGaugesInner);

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    root: { paddingTop: space.xxs, paddingBottom: space.l },
    mileage: {
      ...cardSurface(C),
    },
    contractCore: { gap: space.sm },
    mileageHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    mileageHeadAccessible: { flexDirection: 'column', alignItems: 'flex-start', gap: space.xs },
    // Ink rather than the eyebrow's default mute: this kicker names the card's
    // whole contract, so it sits at the top of the panel's hierarchy.
    eyebrow: { ...eyebrowText(C, 'labelSm'), color: C.ink },
    contractLabel: { color: C.mute, fontSize: fontSizes.labelSm, fontWeight: '700' },
    mileageValueRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: space.l, minWidth: 0 },
    mileageValueRowAccessible: { flexDirection: 'column', alignItems: 'stretch', gap: space.sm },
    mileageBankedValue: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, minWidth: 0, flexShrink: 1 },
    mileageBankedValueAccessible: { flexDirection: 'column', alignItems: 'flex-start', gap: space.xxs },
    mileageSideValue: { alignItems: 'flex-end', paddingBottom: space.xxs },
    mileageSideValueAccessible: { alignItems: 'flex-start', paddingBottom: 0 },
    mileageSideNumber: { color: C.ink, fontSize: fontSizes.numeralSm, fontWeight: '800', letterSpacing: -0.4, fontVariant: ['tabular-nums'] },
    mileageSideLabel: { ...eyebrowText(C, 'micro'), marginTop: 1 },
    targetForwardRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
    targetForwardRowAccessible: { flexDirection: 'column', alignItems: 'flex-start', gap: space.xxs },
    mileageValue: { color: C.ink, fontFamily: display, fontSize: fontSizes.numeralLg, lineHeight: 38, letterSpacing: -1.1, fontVariant: ['tabular-nums'] },
    mileageUnit: eyebrowText(C, 'labelSm'),
    mileageMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.s },
    mileageMetaAccessible: { flexDirection: 'column', alignItems: 'flex-start' },
    mileageMetaText: { ...statValueText(C, 'labelSm', 'system'), fontWeight: '800' },
    projectionText: { ...statValueText(C, 'labelSm', 'system'), marginLeft: 'auto', color: C.mute, fontWeight: '700' },
    projectionTextAccessible: { marginLeft: 0 },
    statusRow: {
      // Any rendered row reserves the action's 44pt target. A completed live
      // week omits the row entirely because the rail already closes the story.
      minHeight: 56,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      marginTop: space.md,
      paddingTop: space.md,
      ...hairlineTop(C),
    },
    statusRowAccessible: { flexDirection: 'column', alignItems: 'stretch', minHeight: 0 },
    statusCopy: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space.sm },
    statusText: { flex: 1, minWidth: 0 },
    statusHeadline: { color: C.ink, fontSize: fontSizes.label, fontWeight: '800', letterSpacing: -0.15 },
    statusQuietHeadline: { color: C.mute, fontWeight: '700' },
    statusDetail: { color: C.mute, fontSize: fontSizes.labelSm, fontWeight: '700', marginTop: 1 },
    adjustAction: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: space.xs,
      paddingHorizontal: space.xs,
    },
    adjustActionAccessible: { alignSelf: 'flex-start', paddingHorizontal: 0 },
    adjustActionPressed: { opacity: 0.6 },
    adjustActionText: { color: C.ink, fontSize: fontSizes.metadata, fontWeight: '800' },
    supportBand: {
      ...hairlineTop(C),
      marginTop: space.md,
      paddingTop: space.md,
    },
    supportRow: { flexDirection: 'row', alignItems: 'stretch', gap: space.md },
    supportRowAccessible: { flexDirection: 'column' },
    supportGoal: { flex: 1, minWidth: 0, gap: space.s },
    supportDividerAccessible: { width: '100%', height: StyleSheet.hairlineWidth },
    supportHead: { minHeight: SUPPORT_RING_SIZE, flexDirection: 'row', alignItems: 'center', gap: space.s },
    supportHeadAccessible: { flexWrap: 'wrap', alignItems: 'flex-start' },
    // The colour is the goal's own type token (violet / cyan), set at the call site.
    supportLabel: eyebrowText(C, 'micro'),
    supportSummary: { ...statValueText(C, 'micro', 'system'), marginLeft: 'auto', color: C.mute, fontWeight: '800' },
    supportSummaryAccessible: { marginLeft: 0, flexBasis: '100%' },
    supportValueRow: { flexDirection: 'row', alignItems: 'baseline', minWidth: 0 },
    supportValueRowAccessible: { flexWrap: 'wrap' },
    supportValue: { ...statValueText(C, 'sectionTitle', 'system'), fontWeight: '800' },
    supportOf: { ...statValueText(C, 'labelSm', 'system'), color: C.mute, fontWeight: '700' },
    supportTarget: { ...statValueText(C, 'label', 'system'), fontWeight: '800' },
    supportNone: { color: C.mute, fontSize: fontSizes.label, fontWeight: '700' },
  });
