import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { useAppPreferences, type DistancePreference } from '@/app-lib/preferences';
import { metersToUnits } from '@/lib';
import { ContractMileageTrack } from '@/components/dash/ContractMileageTrack';
import { hairlineBottom, hairlineTop } from '@/components/ui/Divider';
import { eyebrowText } from '@/components/ui/Eyebrow';
import { statValueText } from '@/components/ui/Stat';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { display, fontSizes, radius, space, type Tokens } from '@/theme/tokens';

const TEXT_SCALE = 1.35;
const ONE_MILE = 1609.344;

export type WeeklyDimensions = {
  miles: number;
  quality: number;
  long: number;
};

/**
 * The fixed facts above Reshape's allocation workbench. Each number appears
 * once: the projection leads, the contract is its reference, and the two
 * supporting goals stay subordinate to weekly mileage.
 */
export function ReshapeSummary({
  banked,
  projected,
  contract,
}: {
  banked: WeeklyDimensions;
  projected: WeeklyDimensions;
  contract: WeeklyDimensions;
}) {
  const C = useTheme();
  const { preferences } = useAppPreferences();
  const units = preferences.distance;
  const unitWord = units === 'mi' ? 'miles' : 'kilometers';
  const styles = useThemedStyles(makeStyles);
  const { fontScale } = useWindowDimensions();
  const usesAccessibilityLayout = fontScale >= 1.6;
  const scheduledMiles = Math.max(0, projected.miles - banked.miles);
  const delta = projected.miles - contract.miles;
  const deltaLabel = projectionDelta(delta, units);
  const keyWorkExceptions = [
    { key: 'quality', label: 'Quality', state: supportState(projected.quality, contract.quality, units), color: C.qualText },
    { key: 'long', label: 'Long run', state: supportState(projected.long, contract.long, units), color: C.cyanText },
  ].filter(({ state }) => state.endsWith('open'));
  const exceptionLabel = keyWorkExceptions.map(({ label, state }) => `${label} ${state}`).join(', ');
  // A short projection should read against the contract as the literal end of
  // the rail. Reserve headroom only when the projection actually runs beyond
  // the contract, so an overshoot can remain visible past the target marker.
  const scaleMax = projected.miles > contract.miles
    ? Math.max(projected.miles, ONE_MILE) * 1.06
    : Math.max(contract.miles, ONE_MILE);
  const fraction = (value: number) => Math.max(0, Math.min(1, value / scaleMax));
  const actualFraction = fraction(Math.min(banked.miles, projected.miles));
  const projectedFraction = fraction(projected.miles);
  const targetFraction = fraction(contract.miles);

  return (
    <View
      accessible
      accessibilityRole="summary"
      accessibilityLabel={`${formatDistance(projected.miles, units)} ${unitWord} projected, ${formatDistance(contract.miles, units)} ${unitWord} contract, ${formatDistance(banked.miles, units)} ${unitWord} banked, ${formatDistance(scheduledMiles, units)} ${unitWord} scheduled, ${deltaLabel}${exceptionLabel ? `, ${exceptionLabel}` : ''}`}
      style={styles.block}
      testID="reshape-contract"
    >
      <View style={[styles.top, usesAccessibilityLayout && styles.topAccessible]}>
        <View style={styles.valueRow}>
          <Text maxFontSizeMultiplier={TEXT_SCALE} style={styles.value}>{formatDistance(projected.miles, units)}</Text>
          <Text maxFontSizeMultiplier={TEXT_SCALE} style={styles.valueLabel}>{units} projected</Text>
        </View>
        <View style={[styles.contract, usesAccessibilityLayout && styles.contractAccessible]}>
          <Text maxFontSizeMultiplier={TEXT_SCALE} style={styles.contractValue}>{formatDistance(contract.miles, units)}</Text>
          <Text maxFontSizeMultiplier={TEXT_SCALE} style={styles.contractLabel}>{units} contract</Text>
        </View>
      </View>

      <ContractMileageTrack
        actualFraction={actualFraction}
        projectedFraction={projectedFraction}
        targetMarkFraction={contract.miles > 0 ? targetFraction : undefined}
        style={styles.track}
        testID="reshape-contract-mileage-track"
      />

      <View style={[styles.meta, usesAccessibilityLayout && styles.metaAccessible]}>
        <Text maxFontSizeMultiplier={TEXT_SCALE} style={styles.breakdown}>
          {`${formatDistance(banked.miles, units)} ${units} banked  ·  ${formatDistance(scheduledMiles, units)} ${units} scheduled`}
        </Text>
        {deltaLabel === 'On contract' ? null : (
          <Text maxFontSizeMultiplier={TEXT_SCALE} style={styles.delta}>{deltaLabel}</Text>
        )}
      </View>

      {keyWorkExceptions.length > 0 ? (
        <View style={styles.exceptions}>
          {keyWorkExceptions.map(({ key, label, state, color }, index) => (
            <View key={key} style={styles.exceptionItem}>
              {index > 0 ? <View style={styles.exceptionDot} /> : null}
              <Text maxFontSizeMultiplier={TEXT_SCALE} style={styles.exception}>
                <Text style={{ color }} testID={`reshape-exception-${key}-label`}>{label}</Text>
                {` ${state}`}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function projectionDelta(deltaMeters: number, units: DistancePreference = 'mi'): string {
  if (Math.abs(deltaMeters) < ONE_MILE * 0.05) return 'On contract';
  if (deltaMeters > 0) return `${formatDistance(deltaMeters, units)} ${units} over`;
  return `${formatDistance(Math.abs(deltaMeters), units)} ${units} short`;
}

export function supportState(projectedMeters: number, targetMeters: number, units: DistancePreference = 'mi'): string {
  if (targetMeters <= 0) return 'No target';
  const difference = projectedMeters - targetMeters;
  if (difference >= -ONE_MILE * 0.05) return 'Covered';
  return `${formatDistance(Math.abs(difference), units)} ${units} open`;
}

function formatDistance(meters: number, units: DistancePreference): string {
  const distance = metersToUnits(meters, units);
  const rounded = Math.round(distance);
  return Math.abs(distance - rounded) < 0.05 ? String(rounded) : distance.toFixed(1);
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    block: {
      paddingTop: space.md,
      paddingBottom: space.lg,
      ...hairlineTop(C),
      ...hairlineBottom(C),
    },
    top: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.lg },
    topAccessible: { flexDirection: 'column', alignItems: 'flex-start', gap: space.sm },
    valueRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
    value: { color: C.ink, fontFamily: display, fontSize: fontSizes.numeralLg, lineHeight: 39, letterSpacing: -0.9, fontVariant: ['tabular-nums'] },
    // The two keys keep their own weight/tracking on top of the eyebrow: this
    // block is the fixed reference above the workbench, and its labels were
    // tuned to sit under a 34pt projection without competing with it.
    valueLabel: { ...eyebrowText(C, 'labelSm'), },
    contract: { alignItems: 'flex-end', paddingBottom: space.xxs },
    contractAccessible: { alignItems: 'flex-start' },
    contractValue: { ...statValueText(C, 'sectionTitle', 'system'), fontWeight: '800', letterSpacing: -0.25 },
    contractLabel: { ...eyebrowText(C, 'micro'), marginTop: 1 },
    delta: { ...statValueText(C, 'labelSm', 'system'), color: C.mute, fontWeight: '800', textAlign: 'right' },
    track: { marginTop: space.sm },
    meta: { marginTop: space.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
    metaAccessible: { flexDirection: 'column', alignItems: 'flex-start', gap: space.xs },
    breakdown: { ...statValueText(C, 'labelSm', 'system'), flexShrink: 1, color: C.mute, lineHeight: 16, fontWeight: '700' },
    exceptions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
    exceptionItem: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    exceptionDot: { width: 3, height: 3, borderRadius: radius.pill, backgroundColor: C.faint },
    exception: { ...statValueText(C, 'labelSm', 'system'), fontWeight: '800' },
  });
