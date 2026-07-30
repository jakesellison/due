/**
 * Plan history — the whole-plan change log. A feed (newest first) of every
 * `plan_changes` event: a quiet date header (+ an "Auto-adjust" tag when the
 * engine made the change), then the event's icon-led change rows (shared
 * ChangeRow). No "You · N changes" noise, no arrows. Opened from the Plan tab
 * (header glyph + "Recent changes" teaser). Reads via `usePlanChangeLog`.
 */
import React, { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { useSession } from '@/app-lib/auth';
import { usePlanChangeLog } from '@/app-lib/queries';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { fontSizes, radius, space, type Tokens } from '@/theme/tokens';
import { ChangeRow, changeShortDate } from '@/components/plan/ChangeRow';
import { hairlineBottom } from '@/components/ui/Divider';
import { statValueText } from '@/components/ui/Stat';
import { SheetHeader } from '@/components/SheetHeader';
import { ErrorState } from '@/components/ErrorState';

export default function PlanHistoryScreen() {
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { userId } = useSession();
  const { planId } = useLocalSearchParams<{ planId?: string }>();
  const { events, isLoading, error, refetch } = usePlanChangeLog(userId, planId ?? null);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <SheetHeader variant="sheet" onClose={() => router.back()} title="Plan history" />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.mute} />}
      >
        {error && events.length === 0 ? (
          <View style={styles.error}>
            <ErrorState
              title="Couldn’t load plan history"
              message={error.message}
              onRetry={() => { void refetch(); }}
            />
          </View>
        ) : events.length === 0 ? (
          <View style={styles.empty}>
            <SymbolView name="clock.arrow.circlepath" size={26} tintColor={C.mute} resizeMode="scaleAspectFit" />
            <Text style={styles.emptyTxt}>{isLoading ? 'Loading…' : 'No plan changes yet'}</Text>
            {!isLoading ? <Text style={styles.emptyBody}>Weekly adjustments and plan revisions will appear here.</Text> : null}
          </View>
        ) : (
          <View style={styles.ledger}>
            {events.map((e, eventIndex) => (
              <View key={e.id} style={[styles.event, eventIndex === events.length - 1 && styles.eventLast]}>
                <View style={styles.eventHead}>
                  <Text style={styles.date}>{changeShortDate(e.createdAt)}</Text>
                  {e.actor === 'auto' ? <Text style={styles.autoTxt}>Auto-adjust</Text> : null}
                </View>
                <View style={styles.rows}>
                  {e.changes.map((c, i) => <ChangeRow key={i} change={c} />)}
                </View>
              </View>
            ))}
          </View>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    scroll: { paddingHorizontal: space.lg, paddingTop: space.xs },
    error: { minHeight: 320, alignItems: 'center', justifyContent: 'center' },
    empty: { alignItems: 'center', gap: space.md, paddingTop: 80 },
    emptyTxt: { color: C.mute, fontSize: fontSizes.labelLg, fontWeight: '600' },
    emptyBody: { maxWidth: 280, color: C.faint, fontSize: fontSizes.metadata, lineHeight: 18, fontWeight: '600', textAlign: 'center' },
    ledger: { backgroundColor: C.card, borderColor: C.line, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, overflow: 'hidden' },
    event: { paddingHorizontal: space.lg, paddingVertical: space.lg, ...hairlineBottom(C) },
    eventLast: { borderBottomWidth: 0 },
    eventHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, marginBottom: space.s },
    date: { ...statValueText(C, 'label', 'system'), fontWeight: '800' },
    autoTxt: { color: C.cyanText, fontSize: fontSizes.micro, fontWeight: '800' },
    rows: { gap: space.xs },
  });
