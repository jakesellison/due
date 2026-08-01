/**
 * Week calendar navigator — a temporary month sheet over the Week screen.
 *
 * It answers one question only: where in the plan do you want to go? Choosing
 * a date dismisses the sheet and returns the Week screen to that date's week.
 * Weekly goals stay on the Week screen; this sheet never invents month-level
 * mileage, quality, or long-run contracts.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';

import { useSession } from '@/app-lib/auth';
import { useWeeklyMileage } from '@/app-lib/queries';
import { addDays, type CalendarDay } from '@/lib';
import { CalendarMonth } from '@/components/dash/CalendarMonth';
import { SheetHeader } from '@/components/SheetHeader';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { fontSizes, radius, space, type Tokens } from '@/theme/tokens';
import { PoweredByStrava } from '@/components/StravaAttribution';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-');
  return `${MONTHS[Number(month) - 1] ?? ''} ${year ?? ''}`.trim();
}

export default function WeekCalendarScreen() {
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { selectedDate } = useLocalSearchParams<{ selectedDate?: string }>();
  const { userId } = useSession();
  const weekly = useWeeklyMileage(userId);

  const totalWeeks = Math.max(1, weekly.plan?.num_weeks ?? 1);
  const planStartMonday = useMemo(
    () => addDays(weekly.currentWeekStart, -(Math.max(1, weekly.currentWeekIndex) - 1) * 7),
    [weekly.currentWeekIndex, weekly.currentWeekStart],
  );
  const days = useMemo(() => {
    const out: CalendarDay[] = [];
    if (!weekly.plan) return out;
    for (let week = 0; week < totalWeeks; week++) {
      out.push(...weekly.weekDaysFor(addDays(planStartMonday, week * 7)));
    }
    return out;
  }, [planStartMonday, totalWeeks, weekly.plan, weekly.weekDaysFor]);

  const todayIndex = useMemo(() => {
    const index = days.findIndex((day) => day.isToday);
    return index >= 0 ? index : 0;
  }, [days]);
  const selectedIndex = useMemo(() => {
    const requested = typeof selectedDate === 'string'
      ? days.findIndex((day) => day.localDate === selectedDate)
      : -1;
    return requested >= 0 ? requested : todayIndex;
  }, [days, selectedDate, todayIndex]);
  const [viewWeek, setViewWeek] = useState(Math.floor(selectedIndex / 7));

  useEffect(() => {
    setViewWeek(Math.floor(selectedIndex / 7));
  }, [selectedIndex]);

  const monthKeyForWeek = useCallback(
    (week: number) => (days[week * 7 + 3]?.localDate ?? days[week * 7]?.localDate ?? '').slice(0, 7),
    [days],
  );
  const monthKeys = useMemo(() => {
    const keys: string[] = [];
    for (let week = 0; week < totalWeeks; week++) {
      const key = monthKeyForWeek(week);
      if (key && keys[keys.length - 1] !== key) keys.push(key);
    }
    return keys;
  }, [monthKeyForWeek, totalWeeks]);
  const activeMonth = monthKeyForWeek(viewWeek);
  const activeMonthIndex = Math.max(0, monthKeys.indexOf(activeMonth));

  const chooseDate = useCallback((localDate: string) => {
    void Haptics.selectionAsync();
    router.dismissTo({ pathname: '/(tabs)', params: { calendarDate: localDate } });
  }, [router]);

  const moveMonth = useCallback((delta: number) => {
    const nextKey = monthKeys[activeMonthIndex + delta];
    if (!nextKey) return;
    const homeWeek = Array.from({ length: totalWeeks }, (_, week) => week)
      .find((week) => monthKeyForWeek(week) === nextKey);
    if (homeWeek != null) setViewWeek(homeWeek);
  }, [activeMonthIndex, monthKeyForWeek, monthKeys, totalWeeks]);

  if (weekly.loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={C.mute} />
      </View>
    );
  }

  if (weekly.error || !weekly.plan || days.length === 0) {
    return (
      <SafeAreaView style={styles.root} edges={['bottom']}>
        <SheetHeader onClose={() => router.back()} title="Choose a week" style={styles.sheetHeader} />
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>Calendar unavailable</Text>
          <Text style={styles.errorBody}>{weekly.error?.message ?? 'Your active plan could not be loaded.'}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
      <SheetHeader
        onClose={() => router.back()}
        title="Choose a week"
        style={styles.sheetHeader}
        right={(
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Return to today"
            onPress={() => chooseDate(weekly.today)}
            style={({ pressed }) => [styles.todayButton, pressed && styles.pressed]}
          >
            <Text style={styles.todayText}>Today</Text>
          </Pressable>
        )}
      />

      <View style={styles.monthHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          disabled={activeMonthIndex <= 0}
          onPress={() => moveMonth(-1)}
          style={({ pressed }) => [
            styles.monthButton,
            activeMonthIndex <= 0 && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <SymbolView name="chevron.left" size={15} tintColor={C.ink} weight="semibold" resizeMode="scaleAspectFit" />
        </Pressable>
        <Text style={styles.monthTitle} accessibilityRole="header">{monthLabel(activeMonth)}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next month"
          disabled={activeMonthIndex >= monthKeys.length - 1}
          onPress={() => moveMonth(1)}
          style={({ pressed }) => [
            styles.monthButton,
            activeMonthIndex >= monthKeys.length - 1 && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <SymbolView name="chevron.right" size={15} tintColor={C.ink} weight="semibold" resizeMode="scaleAspectFit" />
        </Pressable>
      </View>

      <View style={styles.calendar}>
        <CalendarMonth
          days={days}
          totalWeeks={totalWeeks}
          selectedIndex={selectedIndex}
          viewWeek={viewWeek}
          expanded
          onSelectDay={(index) => {
            const day = days[index];
            if (day) chooseDate(day.localDate);
          }}
          onViewWeek={setViewWeek}
        />
      </View>
      <PoweredByStrava compact />
    </SafeAreaView>
  );
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, backgroundColor: C.bg },
    sheetHeader: { paddingTop: space.lg },
    pressed: { opacity: 0.58 },
    todayButton: {
      minWidth: 58,
      height: 44,
      paddingHorizontal: space.md,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.pill,
    },
    todayText: { color: C.yellowText, fontSize: fontSizes.labelLg, fontWeight: '800' },
    monthHeader: {
      minHeight: 48,
      paddingHorizontal: space.lg,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    monthButton: {
      width: 44,
      height: 44,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: C.fill,
    },
    disabled: { opacity: 0.25 },
    monthTitle: { color: C.ink, fontSize: fontSizes.sectionTitle, fontWeight: '800', fontVariant: ['tabular-nums'] },
    calendar: { flex: 1, paddingHorizontal: space.lg, paddingTop: space.xs },
    errorTitle: { color: C.ink, fontSize: fontSizes.sectionTitle, fontWeight: '800', marginBottom: space.sm },
    errorBody: { color: C.mute, fontSize: fontSizes.labelLg, lineHeight: 20, textAlign: 'center' },
  });
