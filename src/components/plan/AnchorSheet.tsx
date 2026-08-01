/**
 * AnchorSheet — the single control for turning a dateless starter `RelativePlan`
 * into a dated block: pick whether the plan is anchored by its RACE date or its
 * START date, then choose that date. It is purely presentational — it owns no
 * anchor state; the parent holds the `PlanAnchor` and re-derives the plan on
 * every `onChange`. Reused by the install-flow reframe (Task 12), so it stays
 * screen-agnostic: it renders as a bottom sheet (a local `<Modal>` styled like
 * the realign sheet) and reports every edit up through `onChange`.
 *
 * The too-close verdict is computed by the caller (`anchorPlan`) and passed in
 * as `tooClose`; the sheet only renders the plain notice. Copy stays in the
 * labels-and-numbers register — no narrated sentences.
 */
import { useCallback } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';

import { nextMondayIso, todayIsoDate, type AnchorTooClose, type PlanAnchor } from '@/lib/plan/anchor';
import type { RelativePlan } from '@/lib/plan/relative';
import { SheetHeader } from '@/components/SheetHeader';
import { eyebrowText } from '@/components/ui/Eyebrow';
import { statValueText } from '@/components/ui/Stat';
import { useScheme, useThemedStyles } from '@/theme/ThemeProvider';
import { fontSizes, radius, SCRIM, space, type Tokens } from '@/theme/tokens';

const DAY_MS = 86400 * 1000;
const noon = (iso: string) => Date.parse(`${iso}T12:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(noon(iso) + n * DAY_MS).toISOString().slice(0, 10);

/** A sensible default race date for a fresh switch: the plan's full length out,
 *  landing on the Saturday of race week. */
function defaultRaceDate(plan: RelativePlan): string {
  const monday = nextMondayIso(todayIsoDate());
  return addDays(monday, (plan.plan.numWeeks - 1) * 7 + 5);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Sat Oct 11" from a 'YYYY-MM-DD'. */
export function formatAnchorDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export interface AnchorSheetProps {
  plan: RelativePlan;
  anchor: PlanAnchor;
  onChange: (a: PlanAnchor) => void;
  tooClose: AnchorTooClose | null;
  /** Presentation — the parent owns visibility so the sheet stays reusable. */
  visible?: boolean;
  onClose?: () => void;
}

export function AnchorSheet({ plan, anchor, onChange, tooClose, visible = false, onClose }: AnchorSheetProps) {
  const scheme = useScheme();
  const styles = useThemedStyles(makeStyles);

  const kind = anchor.kind;
  const currentDate = anchor.kind === 'race' ? anchor.raceDate : anchor.startDate;

  const selectKind = useCallback(
    (next: PlanAnchor['kind']) => {
      if (next === kind) return;
      if (next === 'race') {
        onChange({ kind: 'race', raceDate: anchor.kind === 'race' ? anchor.raceDate : defaultRaceDate(plan) });
      } else {
        onChange({ kind: 'start', startDate: anchor.kind === 'start' ? anchor.startDate : nextMondayIso(todayIsoDate()) });
      }
    },
    [anchor, kind, onChange, plan],
  );

  const onPickDate = useCallback(
    (_e: DateTimePickerEvent, date?: Date) => {
      if (!date) return;
      const iso = toIso(date);
      onChange(kind === 'race' ? { kind: 'race', raceDate: iso } : { kind: 'start', startDate: iso });
    },
    [kind, onChange],
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.scrim}>
        <Pressable style={styles.scrimFill} accessibilityRole="button" accessibilityLabel="Dismiss" onPress={onClose} />
        <SafeAreaView style={styles.sheet} edges={['bottom']}>
          <View style={styles.grabber} />
          <SheetHeader title="Anchor" onClose={() => onClose?.()} style={styles.head} />

          {/* Segmented: what dates the block is pinned to. */}
          <View style={styles.segment}>
            {(['race', 'start'] as const).map((k) => {
              const on = k === kind;
              return (
                <Pressable
                  key={k}
                  accessibilityRole="button"
                  accessibilityLabel={k === 'race' ? 'Race date' : 'Start date'}
                  accessibilityState={{ selected: on }}
                  onPress={() => selectKind(k)}
                  style={[styles.segBtn, on && styles.segBtnOn]}
                >
                  <Text style={[styles.segText, on && styles.segTextOn]}>{k === 'race' ? 'Race date' : 'Start date'}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.dateRow}>
            <Text style={styles.dateLabel}>{kind === 'race' ? 'Race day' : 'First Monday'}</Text>
            <Text style={styles.dateValue}>{formatAnchorDate(currentDate)}</Text>
          </View>

          <View style={styles.pickerWrap}>
            <DateTimePicker
              value={new Date(`${currentDate}T12:00:00Z`)}
              mode="date"
              display="inline"
              onChange={onPickDate}
              minimumDate={new Date(`${todayIsoDate()}T12:00:00Z`)}
              themeVariant={scheme === 'light' ? 'light' : 'dark'}
            />
          </View>

          {tooClose ? (
            <View style={styles.notice}>
              <Text style={styles.noticeEyebrow}>TOO CLOSE</Text>
              <View style={styles.noticeStats}>
                <View style={styles.noticeStat}>
                  <Text style={styles.noticeStatVal}>{tooClose.weeksAvailable}</Text>
                  <Text style={styles.noticeStatLab}>AVAILABLE</Text>
                </View>
                <View style={styles.noticeStat}>
                  <Text style={styles.noticeStatVal}>{tooClose.minWeeks}</Text>
                  <Text style={styles.noticeStatLab}>MINIMUM</Text>
                </View>
              </View>
            </View>
          ) : null}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: SCRIM },
    scrimFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    sheet: {
      backgroundColor: C.bg,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      paddingHorizontal: space.xl,
      paddingBottom: space.lg,
    },
    grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: C.line, marginTop: space.m, marginBottom: space.s },
    head: { paddingHorizontal: 0 },

    segment: { flexDirection: 'row', backgroundColor: C.fill, borderRadius: radius.sm, padding: space.nudge, marginTop: space.m },
    segBtn: { flex: 1, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
    segBtnOn: { backgroundColor: C.card, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
    segText: { fontSize: fontSizes.labelLg, fontWeight: '800', color: C.mute },
    segTextOn: { color: C.ink },

    dateRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: space.lg },
    dateLabel: eyebrowText(C, 'metadata'),
    dateValue: statValueText(C, 'lg'),

    pickerWrap: { marginTop: space.s, alignItems: 'center' },

    notice: {
      marginTop: space.md,
      padding: space.lg,
      borderRadius: radius.md,
      backgroundColor: C.fill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.line,
    },
    noticeEyebrow: { ...eyebrowText(C, 'labelSm'), color: C.pink },
    noticeStats: { flexDirection: 'row', gap: space.xl, marginTop: space.m },
    noticeStat: { alignItems: 'flex-start' },
    noticeStatVal: statValueText(C, 'xl'),
    noticeStatLab: { ...eyebrowText(C, 'micro'), marginTop: space.xxs },
  });
