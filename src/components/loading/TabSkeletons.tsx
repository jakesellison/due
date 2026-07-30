import { StyleSheet, View } from 'react-native';

import { TAB_BAR_INSET } from '@/components/GlassTabBar';
import { cardSurface } from '@/components/Card';
import { useThemedStyles } from '@/theme/ThemeProvider';
import { radius, space, type Tokens } from '@/theme/tokens';

import { SkeletonBlock, SkeletonGroup } from './Skeleton';

export function TabHeaderActionSkeleton({ accessibilityLabel }: { accessibilityLabel: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <SkeletonGroup accessibilityLabel={accessibilityLabel} style={styles.headerAction}>
      <SkeletonBlock height={32} width={32} style={styles.pill} />
    </SkeletonGroup>
  );
}

/** The Week tab's final geometry: contract, calendar rail, today's workout. */
export function WeekTabSkeleton() {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.weekViewport}>
      <SkeletonGroup
        accessibilityLabel="Loading your week"
        style={styles.weekGroup}
        testID="week-loading-skeleton"
      >
        <View style={styles.weekHeader}>
          <SkeletonBlock height={13} width="48%" />
          <SkeletonBlock height={32} width={82} style={styles.pill} />
        </View>

        <View style={styles.weekContract}>
          <SkeletonBlock height={12} width="54%" />
          <View style={styles.contractMetric}>
            <SkeletonBlock height={48} width="48%" />
            <SkeletonBlock height={34} width="22%" />
          </View>
          <SkeletonBlock height={12} />
          <View style={styles.contractGoals}>
            <View style={styles.goal}>
              <SkeletonBlock height={12} width="54%" />
              <SkeletonBlock height={26} width="72%" />
            </View>
            <View style={styles.goal}>
              <SkeletonBlock height={12} width="54%" />
              <SkeletonBlock height={26} width="72%" />
            </View>
          </View>
          <View style={styles.contractStatus}>
            <SkeletonBlock height={10} width={10} style={styles.pill} />
            <View style={styles.contractStatusCopy}>
              <SkeletonBlock height={14} width="46%" />
              <SkeletonBlock height={10} width="34%" />
            </View>
          </View>
        </View>

        <View style={styles.dayRail}>
          {Array.from({ length: 7 }, (_, index) => (
            <View key={index} style={styles.day}>
              <SkeletonBlock height={8} width={12} />
              <SkeletonBlock height={20} width={24} />
              <SkeletonBlock height={8} width={30} />
            </View>
          ))}
        </View>

        <View style={styles.workout}>
          <View style={styles.workoutTop}>
            <SkeletonBlock height={42} width={42} style={styles.workoutIcon} />
            <View style={styles.workoutCopy}>
              <SkeletonBlock height={18} width="58%" />
              <SkeletonBlock height={10} width="36%" />
              <SkeletonBlock height={10} width="46%" />
            </View>
            <SkeletonBlock height={34} width={68} />
          </View>
          <SkeletonBlock height={1} />
          <SkeletonBlock height={12} width="62%" />
          <SkeletonBlock height={8} />
        </View>

        <View style={styles.blockRail}>
          <View style={styles.blockRailHead}>
            <SkeletonBlock height={12} width="34%" />
            <SkeletonBlock height={10} width="28%" />
          </View>
          <View style={styles.blockDots}>
            {Array.from({ length: 6 }, (_, index) => (
              <SkeletonBlock key={index} height={42} width={42} style={styles.pill} />
            ))}
          </View>
        </View>
      </SkeletonGroup>
    </View>
  );
}

/** The Plan tab keeps its real large title while its blueprint resolves. */
export function PlanTabSkeleton() {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.planViewport}>
      <SkeletonGroup
        accessibilityLabel="Loading your plan"
        style={styles.planGroup}
        testID="plan-loading-skeleton"
      >
        <SkeletonBlock height={26} width="62%" />
        <View style={styles.planContext}>
          <SkeletonBlock height={11} width="48%" />
          <SkeletonBlock height={11} width="36%" />
        </View>

        <View style={styles.profile}>
          <View style={styles.profileHead}>
            <SkeletonBlock height={18} width="34%" />
            <SkeletonBlock height={11} width="29%" />
          </View>
          <View style={styles.profileMetric}>
            <View style={styles.profileMetricMain}>
              <SkeletonBlock height={10} width="48%" />
              <SkeletonBlock height={48} width="72%" />
              <SkeletonBlock height={12} width="54%" />
            </View>
            <View style={styles.profileMetricSide}>
              <SkeletonBlock height={24} width={76} />
              <SkeletonBlock height={10} width={96} />
            </View>
          </View>
          <View style={styles.profileBars}>
            {Array.from({ length: 14 }, (_, index) => (
              <SkeletonBlock
                key={index}
                height={44 + ((index * 17) % 58)}
                style={styles.profileBar}
              />
            ))}
          </View>
          <SkeletonBlock height={1} />
          <View style={styles.profileFooter}>
            <View style={styles.profileFooterCell}>
              <SkeletonBlock height={12} width="38%" />
              <SkeletonBlock height={8} />
              <SkeletonBlock height={10} width="46%" />
            </View>
            <View style={styles.profileFooterCell}>
              <SkeletonBlock height={12} width="38%" />
              <SkeletonBlock height={8} />
              <SkeletonBlock height={10} width="46%" />
            </View>
          </View>
        </View>

        <View style={styles.trainingHead}>
          <SkeletonBlock height={18} width="38%" />
          <SkeletonBlock height={10} width="20%" />
        </View>
        <View style={styles.trainingCard}>
          <SkeletonBlock height={22} width="42%" />
          <SkeletonBlock height={11} width="56%" />
          <SkeletonBlock height={1} />
          <SkeletonBlock height={22} width="46%" />
          <SkeletonBlock height={11} width="62%" />
        </View>
      </SkeletonGroup>
    </View>
  );
}

/** Reserved space for today's card while a background activity refresh settles. */
export function DayPanelSkeleton() {
  const styles = useThemedStyles(makeStyles);
  return (
    <SkeletonGroup
      accessibilityLabel="Updating today’s workout"
      style={styles.dayPanel}
      testID="day-panel-loading-skeleton"
    >
      <View style={styles.workoutTop}>
        <SkeletonBlock height={42} width={42} style={styles.workoutIcon} />
        <View style={styles.workoutCopy}>
          <SkeletonBlock height={18} width="58%" />
          <SkeletonBlock height={10} width="36%" />
          <SkeletonBlock height={10} width="46%" />
        </View>
        <SkeletonBlock height={34} width={68} />
      </View>
      <SkeletonBlock height={1} />
      <SkeletonBlock height={12} width="62%" />
      <SkeletonBlock height={8} />
    </SkeletonGroup>
  );
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    weekViewport: {
      flex: 1,
      overflow: 'hidden',
    },
    weekGroup: {
      paddingHorizontal: space.lg,
      paddingTop: space.sm,
      paddingBottom: TAB_BAR_INSET,
    },
    weekHeader: {
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    pill: { borderRadius: radius.pill },
    headerAction: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    weekContract: {
      minHeight: 246,
      gap: space.lg,
      padding: space.lg,
      borderRadius: radius.md,
      backgroundColor: C.card,
    },
    contractMetric: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: space.lg,
    },
    contractGoals: {
      flexDirection: 'row',
      gap: space.lg,
    },
    goal: {
      flex: 1,
      gap: space.md,
      paddingVertical: space.sm,
    },
    contractStatus: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      paddingTop: space.sm,
    },
    contractStatusCopy: { flex: 1, gap: space.s },
    dayRail: {
      minHeight: 88,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: space.md,
    },
    day: {
      width: 38,
      alignItems: 'center',
      gap: space.sm,
    },
    workout: {
      minHeight: 148,
      gap: space.md,
      padding: space.lg,
      borderRadius: radius.md,
      backgroundColor: C.card,
    },
    dayPanel: {
      ...cardSurface(C),
      minHeight: 148,
      gap: space.md,
      marginBottom: space.l,
    },
    workoutTop: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
    },
    workoutIcon: { borderRadius: radius.md },
    workoutCopy: { flex: 1, minWidth: 0, gap: space.s },
    blockRail: {
      minHeight: 94,
      marginTop: space.lg,
      gap: space.lg,
      padding: space.lg,
      borderRadius: radius.md,
      backgroundColor: C.card,
    },
    blockRailHead: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    blockDots: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },

    planViewport: {
      flex: 1,
      overflow: 'hidden',
    },
    planGroup: {
      gap: space.md,
      paddingHorizontal: space.lg,
      paddingTop: space.lg,
      paddingBottom: TAB_BAR_INSET,
    },
    planContext: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: space.lg,
    },
    profile: {
      minHeight: 390,
      gap: space.lg,
      marginTop: space.sm,
      padding: space.lg,
      borderRadius: radius.md,
      backgroundColor: C.card,
    },
    profileHead: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    profileMetric: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: space.lg,
    },
    profileMetricMain: { flex: 1, minWidth: 0, gap: space.sm },
    profileMetricSide: { alignItems: 'flex-end', gap: space.sm },
    profileBars: {
      height: 118,
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: space.xs,
    },
    profileBar: {
      flex: 1,
      minWidth: 0,
      borderRadius: radius.xs,
    },
    profileFooter: {
      flexDirection: 'row',
      gap: space.xl,
    },
    profileFooterCell: { flex: 1, gap: space.sm },
    trainingHead: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: space.lg,
    },
    trainingCard: {
      minHeight: 150,
      gap: space.md,
      padding: space.lg,
      borderRadius: radius.md,
      backgroundColor: C.card,
    },
  });
