import { useMemo, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SymbolView } from 'expo-symbols';

import { useAppPreferences, type DistancePreference } from '@/app-lib/preferences';
import { metersToUnits, type PlanIdentity } from '@/lib';
import { PlanArtwork, type PlanArtworkKind } from '@/components/plan/PlanArtwork';
import { hairlineBottom, hairlineLeft, hairlineTop } from '@/components/ui/Divider';
import { statValueText } from '@/components/ui/Stat';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { data, dataRegular, display, fontSizes, radius, space, usesAccessibilityTextLayout, type Tokens } from '@/theme/tokens';

export interface PlanIdentityState {
  /** Plain-language state, e.g. “Current plan”. */
  label: string;
  /** Aligned instance context, e.g. “Build · Week 11”. */
  detail?: string | null;
  /** 1-based plan week. The only yellow allowed in the identity graphic. */
  currentWeekIndex?: number | null;
}

export interface PlanIdentityCardProps {
  identity: PlanIdentity;
  variant?: 'feature' | 'compact';
  state?: PlanIdentityState | null;
  onPress?: () => void;
  onMenu?: () => void;
  accessory?: ReactNode;
  /** Optional compact context when the distance would merely repeat the title. */
  context?: string;
  grouped?: boolean;
  first?: boolean;
  /** Optional cover. It renders THIS identity's mileage arc; text stays live UI below it. */
  artworkKind?: PlanArtworkKind | null;
  /** Feature covers default to a mobile-friendly wide crop. */
  artworkAspectRatio?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * The canonical native rendering of a plan identity. Templates stay cold:
 * neutral outline, neutral type, one violet quality label, and no yellow.
 * Installed instances may add one yellow baseline notch for the current week.
 */
export function PlanIdentityCard({
  identity,
  variant = 'feature',
  state,
  onPress,
  onMenu,
  accessory,
  context,
  grouped = false,
  first = false,
  artworkKind,
  artworkAspectRatio = 16 / 9,
  style,
}: PlanIdentityCardProps) {
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { preferences } = useAppPreferences();
  const units = preferences.distance;
  const { fontScale } = useWindowDimensions();
  const accessible = usesAccessibilityTextLayout(fontScale);
  const compact = variant === 'compact';
  const compactAccessory = accessory ?? (onMenu ? <View style={styles.menuSpacer} /> : undefined);
  // The cover draws this plan's OWN arc — the same week targets the metric row
  // summarises as average and peak, at poster scale.
  const arc = useMemo(() => identity.weeks.map((week) => week.targetMeters), [identity.weeks]);

  const content = compact ? (
    <CompactIdentity identity={identity} state={state} accessory={compactAccessory} context={context} accessible={accessible} units={units} />
  ) : (
    <FeatureIdentity identity={identity} state={state} context={context} accessible={accessible} hasMenu={Boolean(onMenu)} units={units} />
  );

  const cardStyle = [
    compact ? styles.compactCard : styles.featureCard,
    grouped && styles.groupedCard,
    grouped && !first && styles.groupedDivider,
    style,
  ];
  const accessibilityLabel = identityAccessibilityLabel(identity, state, units);
  const mainStyle = compact ? styles.compactMain : styles.featureArtworkMain;
  const mainContent = compact ? content : (
    <>
      {artworkKind ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.artworkFrame, { aspectRatio: artworkAspectRatio }]}
        >
          <PlanArtwork kind={artworkKind} weeks={arc} aspectRatio={artworkAspectRatio} />
        </View>
      ) : null}
      <View style={styles.featureMain}>{content}</View>
    </>
  );

  return (
    <View style={cardStyle}>
      {onPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          onPress={onPress}
          style={({ pressed }) => [mainStyle, pressed && styles.pressed]}
        >
          {mainContent}
        </Pressable>
      ) : (
        <View style={mainStyle}>{mainContent}</View>
      )}
      {onMenu ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${identity.name} options`}
          hitSlop={8}
          onPress={onMenu}
          style={({ pressed }) => [
            styles.menu,
            pressed && styles.pressed,
          ]}
        >
          <SymbolView name="ellipsis" size={17} tintColor={C.mute} weight="bold" resizeMode="scaleAspectFit" />
        </Pressable>
      ) : null}
    </View>
  );
}

function FeatureIdentity({
  identity,
  state,
  context,
  accessible,
  hasMenu,
  units,
}: {
  identity: PlanIdentity;
  state?: PlanIdentityState | null;
  context?: string;
  accessible: boolean;
  hasMenu: boolean;
  units: DistancePreference;
}) {
  const styles = useThemedStyles(makeStyles);
  const totalDistance = formatDistance(totalPlannedMeters(identity), units);
  const unitWord = units === 'mi' ? 'miles' : 'kilometers';
  return (
    <>
      <View style={styles.featureHead}>
        {state?.label ? <StateLabel state={state} compact={false} hasMenu={hasMenu} /> : null}
        <View style={[styles.featureReadout, accessible && styles.featureReadoutAccessible]}>
          <View style={styles.featureCopy}>
            <Text style={styles.featureTitle} numberOfLines={accessible ? undefined : 2}>{identity.name}</Text>
            <Text style={styles.distance}>{context ?? identity.distanceLabel}</Text>
          </View>
          <View
            accessibilityLabel={`${totalDistance} total planned ${unitWord}`}
            style={[styles.totalMetric, accessible && styles.totalMetricAccessible]}
            testID="plan-total-mileage"
          >
            <Text style={styles.totalValue} numberOfLines={1}>{totalDistance}</Text>
            <Text style={styles.totalLabel} numberOfLines={1}>{units.toUpperCase()} PLAN</Text>
          </View>
        </View>
      </View>

      <PlanMetricRow
        metrics={[
          { value: String(identity.numWeeks), label: 'weeks' },
          { value: formatDistance(identity.averageWeeklyMeters, units), label: `${units}/wk avg` },
          { value: formatDistance(identity.peakWeeklyMeters, units), label: `${units} peak` },
        ]}
        feature
      />
    </>
  );
}

function CompactIdentity({ identity, state, accessory, context, accessible, units }: { identity: PlanIdentity; state?: PlanIdentityState | null; accessory?: ReactNode; context?: string; accessible: boolean; units: DistancePreference }) {
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);
  const copy = (
    <View style={styles.compactDetail}>
      <View style={[styles.compactHead, accessible && styles.compactHeadAccessible]}>
        <View style={styles.compactCopy}>
          <Text style={styles.compactTitle} numberOfLines={accessible ? undefined : 1}>{identity.name}</Text>
          {state?.label ? (
            <StateLabel state={state} compact />
          ) : (
            <Text style={styles.compactContext} numberOfLines={accessible ? undefined : 1}>
              {context ?? identity.distanceLabel}
            </Text>
          )}
        </View>
        {accessory ?? <SymbolView name="chevron.right" size={11} tintColor={C.mute} resizeMode="scaleAspectFit" />}
      </View>
      <PlanMetricRow
        metrics={[
          { value: formatDistance(totalPlannedMeters(identity), units), label: `plan ${units}` },
          { value: formatDistance(identity.averageWeeklyMeters, units), label: `${units}/wk avg` },
          { value: formatDistance(identity.peakWeeklyMeters, units), label: `${units} peak` },
        ]}
      />
    </View>
  );
  return (
    copy
  );
}

function StateLabel({ state, compact, hasMenu = false }: { state: PlanIdentityState; compact: boolean; hasMenu?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.stateRow, compact && styles.stateRowCompact, hasMenu && styles.stateRowWithMenu]}>
      <View style={styles.stateIdentity}>
        {state.currentWeekIndex != null ? <View testID="plan-current-week-marker" style={styles.currentMarker} /> : null}
        <Text style={compact ? styles.compactContext : styles.stateLabel}>{state.label}</Text>
      </View>
      {state.detail ? <Text style={styles.stateDetail}>{state.detail}</Text> : null}
    </View>
  );
}

function PlanMetricRow({
  metrics,
  feature = false,
}: {
  metrics: Array<{ value: string; label: string }>;
  feature?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.metricRow, feature && styles.metricRowFeature]}>
      {metrics.map((metric, index) => (
        <View key={metric.label} style={[styles.metric, index > 0 && styles.metricDivider]}>
          <Text style={[styles.metricValue, feature && styles.metricValueFeature]} numberOfLines={1}>
            {metric.value}
          </Text>
          <Text style={styles.metricLabel} numberOfLines={1}>{metric.label}</Text>
        </View>
      ))}
    </View>
  );
}

function formatDistance(meters: number, units: DistancePreference): string {
  return Math.round(metersToUnits(meters, units)).toLocaleString('en-US');
}

function totalPlannedMeters(identity: PlanIdentity): number {
  return identity.weeks.reduce((sum, week) => sum + week.targetMeters, 0);
}

function identityAccessibilityLabel(identity: PlanIdentity, state: PlanIdentityState | null | undefined, units: DistancePreference): string {
  const unitWord = units === 'mi' ? 'miles' : 'kilometers';
  const parts = [
    identity.name,
    identity.distanceLabel,
    `${identity.numWeeks} weeks`,
    `${formatDistance(totalPlannedMeters(identity), units)} total planned ${unitWord}`,
    `${formatDistance(identity.averageWeeklyMeters, units)} average ${unitWord} per week`,
    `${formatDistance(identity.peakWeeklyMeters, units)} peak ${unitWord}`,
  ];
  if (state?.label) parts.splice(2, 0, state.label);
  return parts.join(', ');
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    pressed: { opacity: 0.62 },
    featureCard: {
      position: 'relative',
      overflow: 'hidden',
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.line,
      backgroundColor: C.card,
    },
    featureMain: { padding: space.xl },
    featureArtworkMain: { padding: 0 },
    artworkFrame: {
      ...hairlineBottom(C),
      width: '100%',
      overflow: 'hidden',
      backgroundColor: C.panel,
    },
    compactCard: {
      position: 'relative',
      overflow: 'hidden',
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.line,
      backgroundColor: C.card,
    },
    compactMain: { paddingHorizontal: space.lg, paddingVertical: space.l },
    groupedCard: { borderWidth: 0, borderRadius: 0 },
    groupedDivider: hairlineTop(C),
    menu: {
      position: 'absolute',
      top: space.sm,
      right: space.sm,
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    menuSpacer: { width: 44, height: 1 },

    featureHead: {},
    featureReadout: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.lg,
    },
    featureReadoutAccessible: {
      flexDirection: 'column',
      alignItems: 'stretch',
    },
    featureCopy: { flex: 1, minWidth: 0 },
    featureTitle: {
      color: C.ink,
      fontFamily: display,
      fontSize: 24,
      lineHeight: 30,
      letterSpacing: -0.45,
    },
    distance: { marginTop: space.xs, color: C.mute, fontSize: fontSizes.label, lineHeight: 18, fontWeight: '700' },
    stateLabel: { color: C.mute, fontFamily: dataRegular, fontSize: fontSizes.labelSm, lineHeight: 16 },
    stateRow: { marginBottom: space.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
    stateRowCompact: { marginTop: 1, marginBottom: 0 },
    stateRowWithMenu: { paddingRight: 44 },
    stateIdentity: { flexDirection: 'row', alignItems: 'center', gap: space.s, minWidth: 0 },
    stateDetail: { color: C.faint, fontFamily: dataRegular, fontSize: fontSizes.micro, lineHeight: 15, textAlign: 'right' },
    currentMarker: { width: 6, height: 6, borderRadius: radius.pill, backgroundColor: C.yellow },

    totalMetric: {
      ...hairlineLeft(C),
      minWidth: 78,
      alignItems: 'flex-end',
      justifyContent: 'center',
      paddingLeft: space.lg,
    },
    totalMetricAccessible: {
      ...hairlineTop(C),
      minWidth: 0,
      alignItems: 'flex-start',
      marginTop: space.lg,
      paddingTop: space.md,
      paddingLeft: 0,
      // The column rule becomes a row rule when the readout stacks.
      borderLeftWidth: 0,
    },
    totalValue: {
      color: C.ink,
      fontFamily: dataRegular,
      fontSize: 24,
      lineHeight: 29,
      fontVariant: ['tabular-nums'],
    },
    totalLabel: {
      marginTop: 1,
      color: C.faint,
      fontFamily: data,
      fontSize: fontSizes.micro,
      lineHeight: 12,
      letterSpacing: 0.55,
    },
    metricRow: {
      ...hairlineTop(C),
      flexDirection: 'row',
      alignItems: 'stretch',
      marginTop: space.md,
      paddingTop: space.md,
    },
    metricRowFeature: {
      marginTop: space.xl,
      paddingTop: space.lg,
    },
    metric: {
      flex: 1,
      minWidth: 0,
      alignItems: 'center',
      paddingHorizontal: space.s,
    },
    metricDivider: hairlineLeft(C),
    metricValue: {
      ...statValueText(C, 'label', 'dataRegular'),
      lineHeight: 18,
    },
    metricValueFeature: { fontSize: fontSizes.body, lineHeight: 20 },
    metricLabel: {
      marginTop: space.xxs,
      color: C.faint,
      fontFamily: data,
      fontSize: fontSizes.micro,
      lineHeight: 11,
      letterSpacing: 0.4,
      textTransform: 'uppercase',
    },

    compactDetail: { flex: 1, minWidth: 0 },
    compactHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
    compactHeadAccessible: { alignItems: 'flex-start' },
    compactCopy: { flex: 1, minWidth: 0 },
    compactTitle: { color: C.ink, fontFamily: display, fontSize: fontSizes.sectionTitle, lineHeight: 23, letterSpacing: -0.3 },
    compactContext: { marginTop: space.xs, color: C.mute, fontSize: fontSizes.metadata, lineHeight: 16, fontWeight: '700' },
  });
