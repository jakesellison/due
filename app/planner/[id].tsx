/**
 * Reshape is the week's allocation workbench. The mileage contract stays fixed
 * and visually primary while remaining workouts can move between days. Banked
 * work is rendered as a locked fact and is never rewritten by this screen.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { initialWindowMetrics, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { LinearTransition, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { useQueryClient } from '@tanstack/react-query';

import { useSession } from '@/app-lib/auth';
import { useAppPreferences, type DistancePreference } from '@/app-lib/preferences';
import { resolveModalSafeInsets } from '@/app-lib/safeArea';
import { useActivePlan, useRacePrediction, useWeek, useWeeklyMileage } from '@/app-lib/queries';
import { saveWeekEdits } from '@/app-lib/weekEdit';
import {
  boardToWeekEdits,
  buildBoard,
  dayComposition,
  dominantWorkLabel,
  formatDurationApprox,
  metersToUnits,
  metersToMiles,
  prescribedQualityMeters,
  sumDayActuals,
  tilesOnDay,
  trayTiles,
  weekTotals,
  type BoardDayInput,
  type CalendarDay,
  type OriginalWorkout,
  type PlanTile,
  type TileType,
  type WorkoutTone,
  type WorkoutType,
} from '@/lib';
import { CalendarCell, type CellMark } from '@/components/dash/CalendarCell';
import { stripToneColor } from '@/components/dash/DayTab';
import { WorkoutRow } from '@/components/dash/WorkoutRow';
import type { BuiltWorkout } from '@/components/planner/WorkoutBuilder';
import { WorkoutEditorModal } from '@/components/planner/WorkoutEditorModal';
import { ReshapeSummary } from '@/components/planner/ReshapeSummary';
import { ActionButton, ActionButtonLabel } from '@/components/ActionButton';
import { ModalFooter } from '@/components/ModalFooter';
import { SheetHeader } from '@/components/SheetHeader';
import { Divider } from '@/components/ui/Divider';
import { statValueText } from '@/components/ui/Stat';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { display, fontSizes, radius, space, usesAccessibilityTextLayout, type Tokens } from '@/theme/tokens';
import { runnerRacePaces } from '@/lib/kpi/targetPace';

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const DOW_FULL = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const EDGE = space.md;
const GAP = 5;
const CELL_H = 48;
const GHOST_W = 150;
const GHOST_H = 46;
const TEXT_SCALE = 1.35;
const RANK: Record<TileType, number> = { quality: 4, long: 3, easy: 2, cross: 1 };

type SV = ReturnType<typeof useSharedValue<number>>;
const REFLOW_ROW_H = 61; // day bare row (~54) + gap (7); insertion-index granularity
const REFLOW_POOL_H = 66; // pool card row (~58, uniform now) + gap
interface DragCtx {
  ghostX: SV;
  ghostY: SV;
  ghostIn: SV;
  hoverZone: SV;
  dayTop: SV;
  dayBottom: SV;
  poolTop: SV;
  poolBottom: SV;
  /** Window-Y of the day's / pool's first row + row counts, so the drag can
   *  compute the insertion index the gap opens at, in whichever zone. */
  rowsTop: SV;
  dropCount: SV;
  poolRowsTop: SV;
  poolCount: SV;
  prevDropIdx: SV;
  setDrop: (zone: number, idx: number) => void;
  beginDrag: (tile: PlanTile, fromPool: boolean) => void;
  endDrag: () => void;
  /** Place `tileId` on `day` at insertion index `idx` (reflow drop). */
  placeAt: (tileId: string, day: number, idx: number) => void;
  /** Free `tileId` to the pool at insertion index `idx`. */
  freeAt: (tileId: string, idx: number) => void;
  /** The currently-selected day — where a pool drop lands. */
  targetDay: number;
}

/** Long-press-then-drag on a whole workout row (the standard reorderable-list
 *  pattern): a quick tap still opens the workout and a quick drag still scrolls,
 *  but a press-and-hold lifts the row. A POOL row dropped in the day panel
 *  places on the selected day; a DAY row dropped in the pool frees it. Zone
 *  math is inlined so the worklet needs no cross-thread callback. */
function buildDrag(tile: PlanTile, fromPool: boolean, ctx: DragCtx) {
  return Gesture.Pan()
    .activateAfterLongPress(180)
    .maxPointers(1)
    .onStart((e) => {
      ctx.ghostX.value = e.absoluteX;
      ctx.ghostY.value = e.absoluteY;
      ctx.ghostIn.value = withTiming(1, { duration: 120 });
      runOnJS(ctx.beginDrag)(tile, fromPool);
    })
    .onUpdate((e) => {
      ctx.ghostX.value = e.absoluteX;
      ctx.ghostY.value = e.absoluteY;
      const y = e.absoluteY;
      const z = y >= ctx.dayTop.value && y <= ctx.dayBottom.value ? 1 : y >= ctx.poolTop.value && y <= ctx.poolBottom.value ? 2 : 0;
      ctx.hoverZone.value = z;
      // Gap opens at the finger's row index in whichever zone (homescreen reflow).
      let idx = -1;
      if (z === 1) idx = Math.max(0, Math.min(ctx.dropCount.value, Math.round((y - ctx.rowsTop.value) / REFLOW_ROW_H)));
      else if (z === 2) idx = Math.max(0, Math.min(ctx.poolCount.value, Math.round((y - ctx.poolRowsTop.value) / REFLOW_POOL_H)));
      const enc = z * 1000 + idx;
      if (enc !== ctx.prevDropIdx.value) {
        ctx.prevDropIdx.value = enc;
        runOnJS(ctx.setDrop)(z, idx);
      }
    })
    .onEnd((e) => {
      const y = e.absoluteY;
      const z = y >= ctx.dayTop.value && y <= ctx.dayBottom.value ? 1 : y >= ctx.poolTop.value && y <= ctx.poolBottom.value ? 2 : 0;
      if (z === 1) {
        const idx = Math.max(0, Math.min(ctx.dropCount.value, Math.round((y - ctx.rowsTop.value) / REFLOW_ROW_H)));
        runOnJS(ctx.placeAt)(tile.id, ctx.targetDay, idx);
      } else if (z === 2) {
        const idx = Math.max(0, Math.min(ctx.poolCount.value, Math.round((y - ctx.poolRowsTop.value) / REFLOW_POOL_H)));
        runOnJS(ctx.freeAt)(tile.id, idx);
      }
    })
    .onFinalize(() => {
      ctx.ghostIn.value = withTiming(0, { duration: 110 });
      ctx.hoverZone.value = 0;
      ctx.prevDropIdx.value = -999;
      runOnJS(ctx.setDrop)(0, -1);
      runOnJS(ctx.endDrag)();
    });
}

const displayDistance = (meters: number, units: DistancePreference) => Math.round(metersToUnits(meters, units));
const toneOf = (t: TileType): WorkoutTone => (t === 'quality' ? 'quality' : t === 'long' ? 'long' : 'easy');
const TONE_ICON = { easy: 'figure.run', quality: 'bolt.fill', long: 'mountain.2.fill', cross: 'dumbbell.fill' } as const;
const typeLabel = (t: PlanTile) => (t.type === 'quality' ? 'Quality' : t.type === 'long' ? 'Long' : t.type === 'cross' ? 'Cross' : 'Easy');

export default function PlannerScreen() {
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { preferences } = useAppPreferences();
  const units = preferences.distance;
  const { fontScale } = useWindowDimensions();
  const accessibilityLayout = usesAccessibilityTextLayout(fontScale);
  const liveInsets = useSafeAreaInsets();
  const modalInsets = resolveModalSafeInsets(liveInsets, initialWindowMetrics?.insets);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId, ready } = useSession();
  const weekIndex = id != null ? Number(id) : null;
  const detail = useWeek(ready ? userId : null, Number.isFinite(weekIndex) ? weekIndex : null);
  const wm = useWeeklyMileage(ready ? userId : null);
  const racePrediction = useRacePrediction(ready ? userId : null, 'all', null);
  const racePaces = useMemo(() => {
    const marathonSeconds = racePrediction.byDistance.find((estimate) => estimate.meters === 42195)?.seconds ?? 0;
    return runnerRacePaces(marathonSeconds);
  }, [racePrediction.byDistance]);
  const queryClient = useQueryClient();
  const planId = useActivePlan(ready ? userId : null).data?.plan?.id ?? null;
  const [saving, setSaving] = useState(false);

  const weekDays = useMemo<CalendarDay[]>(
    () => (detail.weekStart ? wm.weekDaysFor(detail.weekStart) : []),
    [wm, detail.weekStart],
  );

  // This week's banked actuals + prescribed targets (the same KPI the Dash reads)
  // — quality here is DETECTED vs PRESCRIBED, so it's authoritative.
  const goal = useMemo(
    () => wm.weekGoals.find((g) => g.weekStart === detail.weekStart) ?? null,
    [wm.weekGoals, detail.weekStart],
  );

  // Was each day's planned session actually met? For a quality day that means the
  // quality was DETECTED (ran-easy ≠ satisfied); for any other day, something ran.
  const qualityMetByDate = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const cd of weekDays) m.set(cd.localDate, (cd.activities ?? []).some((a) => a.qualityDetected === true));
    return m;
  }, [weekDays]);

  const board = useMemo(() => {
    const weekStart = detail.weekStart;
    if (!weekStart) return null;
    const inputs: BoardDayInput[] = (detail.editableDays ?? []).map((dy) => {
      const date = dy.workout.date ?? weekStart;
      const ranSomething = dy.actual != null;
      const satisfied = dy.workout.is_quality ? (qualityMetByDate.get(date) ?? false) : ranSomething;
      return {
        workoutId: dy.workout.id,
        date,
        type: dy.workout.type ?? 'easy',
        title: dy.workout.title,
        isQuality: dy.workout.is_quality,
        plannedMeters: dy.workout.planned_distance_meters ?? 0,
        plannedDurationSeconds: dy.workout.planned_duration_s,
        structure: dy.workout.structure ?? [],
        prescribedQualityMeters: dy.workout.prescribed_quality_meters,
        actualMeters: dy.actual ? dy.actual.distanceMeters : null,
        isPast: dy.isPast,
        satisfied,
      };
    });
    return buildBoard(inputs, weekStart);
  }, [detail.editableDays, detail.weekStart, qualityMetByDate]);

  const [placement, setPlacement] = useState<Record<string, number | null> | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  // Workouts created in-session via "New workout" (workoutId null until saved).
  const [newTiles, setNewTiles] = useState<PlanTile[]>([]);
  // Existing tiles stay immutable in the query snapshot; prescription edits
  // layer over them until the single Save week commit.
  const [tileEdits, setTileEdits] = useState<Record<string, PlanTile>>({});
  const [composer, setComposer] = useState<{ kind: 'new' } | { kind: 'edit'; tileId: string } | null>(null);
  // Within-day display order (tile ids), so AM/PM reorder from the Sortable sticks.
  const [orderIds, setOrderIds] = useState<string[]>([]);
  const nextId = useRef(1);
  const pl = placement ?? board?.placement ?? {};
  const tiles = useMemo(
    () => [...(board?.tiles ?? []).map((tile) => tileEdits[tile.id] ?? tile), ...newTiles],
    [board?.tiles, newTiles, tileEdits],
  );
  const placementChanged = useMemo(() => {
    if (!placement || !board) return false;
    return board.tiles.some((tile) => (placement[tile.id] ?? null) !== (board.placement[tile.id] ?? null));
  }, [placement, board]);
  const hasDraftChanges = placementChanged || newTiles.length > 0 || Object.keys(tileEdits).length > 0;
  const hasUnplacedNewWorkout = newTiles.some((tile) => pl[tile.id] == null);
  const canSave = hasDraftChanges && !hasUnplacedNewWorkout && !saving && planId != null && detail.weekId != null;

  const closePlanner = useCallback(() => {
    if (!hasDraftChanges) {
      router.back();
      return;
    }
    Alert.alert(
      'Discard changes?',
      'Your weekly allocation will stay as it was.',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => router.back() },
      ],
    );
  }, [hasDraftChanges, router]);

  const resetChanges = useCallback(() => {
    setPlacement(null);
    setNewTiles([]);
    setTileEdits({});
    setOrderIds(board?.tiles.map((tile) => tile.id) ?? []);
  }, [board]);

  useEffect(() => {
    const ids = tiles.map((t) => t.id);
    setOrderIds((prev) => {
      const kept = prev.filter((id) => ids.includes(id));
      const missing = ids.filter((id) => !kept.includes(id));
      return missing.length || kept.length !== prev.length ? [...kept, ...missing] : prev;
    });
  }, [tiles]);

  const addNewWorkout = useCallback((w: BuiltWorkout) => {
    const id = `new-${nextId.current++}`;
    const type: TileType = w.type;
    const qualityMeters = type === 'quality' && w.structure.length
      ? prescribedQualityMeters(w.structure, w.distanceMeters, { paces: racePaces })
      : type === 'quality'
        ? w.distanceMeters
        : undefined;
    const label = w.title.trim() || (w.structure.length ? dominantWorkLabel(w.structure) ?? undefined : undefined);
    setNewTiles((prev) => [
      ...prev,
      {
        id,
        type,
        meters: w.distanceMeters,
        title: w.title.trim() || undefined,
        durationSeconds: w.durationSeconds,
        ...(qualityMeters != null ? { qualityMeters } : {}),
        structureLabel: label,
        structure: w.structure,
        workoutId: null,
        originPast: false,
      },
    ]);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, [racePaces]);

  const updateWorkout = useCallback((tileId: string, w: BuiltWorkout) => {
    const current = tiles.find((tile) => tile.id === tileId);
    if (!current) return;
    const type: TileType = w.type;
    const qualityMeters = type === 'quality' && w.structure.length
      ? prescribedQualityMeters(w.structure, w.distanceMeters, { paces: racePaces })
      : type === 'quality'
        ? w.distanceMeters
        : undefined;
    const updated: PlanTile = {
      ...current,
      type,
      meters: w.distanceMeters,
      title: w.title.trim() || current.title,
      durationSeconds: w.durationSeconds,
      qualityMeters,
      structureLabel: w.structure.length ? dominantWorkLabel(w.structure) ?? undefined : undefined,
      structure: w.structure,
      edited: current.workoutId != null,
    };
    if (current.workoutId == null) {
      setNewTiles((items) => items.map((tile) => tile.id === tileId ? updated : tile));
    } else {
      setTileEdits((items) => ({ ...items, [tileId]: updated }));
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, [racePaces, tiles]);

  const days = useMemo(() => {
    const ws = detail.weekStart;
    return Array.from({ length: 7 }, (_, i) => {
      const date = ws ? addDaysUTC(ws, i) : '';
      const num = ws ? new Date(`${ws}T12:00:00Z`).getUTCDate() + i : i + 1;
      const isToday = detail.today != null && date === detail.today;
      const isPast = detail.today != null && date !== '' && date < detail.today;
      return { idx: i, dow: DOW[i]!, num, date, isToday, isPast };
    });
  }, [detail.weekStart, detail.today]);

  const todayIdx = useMemo(() => days.findIndex((dy) => dy.isToday), [days]);
  // Resolve the first selection during render. The old post-paint effect showed
  // Monday/unselected for one frame, then popped to Today while the modal was
  // still arriving.
  const defaultSelectedIndex = useMemo(() => {
    if (!detail.weekStart || days.length === 0) return 0;
    const first = todayIdx >= 0 ? todayIdx : days.findIndex((dy) => !dy.isPast);
    return first >= 0 ? first : 0;
  }, [days, detail.weekStart, todayIdx]);
  const sel = selectedIndex ?? defaultSelectedIndex;


  // ── Grip-drag: pool row → day panel (place), day row → pool (free) ─────────
  const [drag, setDrag] = useState<{ tile: PlanTile; fromPool: boolean } | null>(null);
  // Where the gap opens during a drag: which zone (1 day · 2 pool) + insertion index.
  const [dropAt, setDropAt] = useState<{ zone: number; idx: number } | null>(null);
  const ghostX = useSharedValue(0);
  const ghostY = useSharedValue(0);
  const ghostIn = useSharedValue(0);
  const hoverZone = useSharedValue(0);
  const dayTop = useSharedValue(0);
  const dayBottom = useSharedValue(0);
  const poolTop = useSharedValue(0);
  const poolBottom = useSharedValue(0);
  const rowsTop = useSharedValue(0);
  const dropCount = useSharedValue(0);
  const poolRowsTop = useSharedValue(0);
  const poolCount = useSharedValue(0);
  const prevDropIdx = useSharedValue(-999);
  const dayRef = useRef<View>(null);
  const poolRef = useRef<View>(null);
  const rowsRef = useRef<View>(null);
  const poolRowsRef = useRef<View>(null);

  const selCount = tilesOnDay(tiles, pl, sel).length;
  const trayCount = trayTiles(tiles, pl).length;
  useEffect(() => {
    dropCount.value = selCount;
    poolCount.value = trayCount;
  }, [selCount, trayCount, dropCount, poolCount]);

  const measureZones = useCallback(() => {
    dayRef.current?.measureInWindow((_x, y, _w, h) => {
      dayTop.value = y;
      dayBottom.value = y + h; // no buffer — it used to overlap the pool's top slot
    });
    poolRef.current?.measureInWindow((_x, y, _w, h) => {
      poolTop.value = y;
      poolBottom.value = y + h;
    });
    rowsRef.current?.measureInWindow((_x, y) => {
      rowsTop.value = y;
    });
    poolRowsRef.current?.measureInWindow((_x, y) => {
      poolRowsTop.value = y;
    });
  }, [dayTop, dayBottom, poolTop, poolBottom, rowsTop, poolRowsTop]);

  useEffect(() => {
    if (!drag) return undefined;
    const frame = requestAnimationFrame(measureZones);
    return () => cancelAnimationFrame(frame);
  }, [drag, measureZones]);

  const beginDrag = useCallback(
    (tile: PlanTile, fromPool: boolean) => {
      measureZones();
      setDrag({ tile, fromPool });
      Haptics.selectionAsync().catch(() => {});
    },
    [measureZones],
  );
  const endDrag = useCallback(() => setDrag(null), []);
  const setDrop = useCallback((zone: number, idx: number) => setDropAt(idx < 0 ? null : { zone, idx }), []);

  // Reorder tile ids so `tileId` lands at index `idx` among the tiles matching
  // `keep` (its new home — a day, or the pool), preserving everything else.
  const reorderInto = useCallback(
    (tileId: string, idx: number, keep: (id: string) => boolean) => {
      setOrderIds((prev) => {
        const allIds = tiles.map((t) => t.id);
        const cur = prev.filter((id) => allIds.includes(id));
        for (const id of allIds) if (!cur.includes(id)) cur.push(id);
        const group = cur.filter((id) => id !== tileId && keep(id));
        group.splice(Math.max(0, Math.min(idx, group.length)), 0, tileId);
        const set = new Set(group);
        const firstPos = cur.findIndex((id) => set.has(id));
        const without = cur.filter((id) => !set.has(id));
        const at = firstPos < 0 ? without.length : Math.min(firstPos, without.length);
        return [...without.slice(0, at), ...group, ...without.slice(at)];
      });
    },
    [tiles],
  );

  const placeAt = useCallback(
    (tileId: string, day: number, idx: number) => {
      setPlacement((prev) => ({ ...(prev ?? board?.placement ?? {}), [tileId]: day }));
      reorderInto(tileId, idx, (id) => pl[id] === day);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    },
    [board, reorderInto, pl],
  );
  const freeAt = useCallback(
    (tileId: string, idx: number) => {
      setPlacement((prev) => ({ ...(prev ?? board?.placement ?? {}), [tileId]: null }));
      reorderInto(tileId, idx, (id) => pl[id] == null);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    },
    [board, reorderInto, pl],
  );

  const ctx: DragCtx = useMemo(
    () => ({
      ghostX,
      ghostY,
      ghostIn,
      hoverZone,
      dayTop,
      dayBottom,
      poolTop,
      poolBottom,
      rowsTop,
      dropCount,
      poolRowsTop,
      poolCount,
      prevDropIdx,
      setDrop,
      beginDrag,
      endDrag,
      placeAt,
      freeAt,
      targetDay: sel,
    }),
    [ghostX, ghostY, ghostIn, hoverZone, dayTop, dayBottom, poolTop, poolBottom, rowsTop, dropCount, poolRowsTop, poolCount, prevDropIdx, setDrop, beginDrag, endDrag, placeAt, freeAt, sel],
  );

  const ghostStyle = useAnimatedStyle(() => ({
    opacity: ghostIn.value,
    transform: [
      { translateX: ghostX.value - GHOST_W / 2 },
      { translateY: ghostY.value - GHOST_H / 2 },
      { scale: 0.92 + 0.08 * ghostIn.value },
    ],
  }));

  // Historical contracts are evidence, not editable intent. The Week sheet is
  // the review surface; Reshape must stay closed even when reached by a stale
  // link or an old navigation state.
  if (detail.bar && !detail.bar.isCurrent && !detail.bar.isFuture) {
    // edges={[]} + explicit topInset, NOT edges={['top']}: this
    // fullScreenModal reports zero insets on its first frame (see the
    // planner-safe-frame comment below), which is how "Week 11" ended up
    // rendered over the system clock in a capture.
    return (
      <SafeAreaView style={styles.root} edges={[]}>
        <Header onClose={() => router.back()} title={weekLabel(weekIndex)} topInset={modalInsets.top} />
        <View style={styles.empty}>
          <Text maxFontSizeMultiplier={TEXT_SCALE} style={styles.emptyTxt}>Past weeks are read-only</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!board) {
    // edges={[]} + explicit topInset, NOT edges={['top']}: this
    // fullScreenModal reports zero insets on its first frame (see the
    // planner-safe-frame comment below), which is how "Week 11" ended up
    // rendered over the system clock in a capture.
    return (
      <SafeAreaView style={styles.root} edges={[]}>
        <Header onClose={() => router.back()} title={weekLabel(weekIndex)} topInset={modalInsets.top} />
        <View style={styles.empty}>
          <Text maxFontSizeMultiplier={TEXT_SCALE} style={styles.emptyTxt}>{!ready || detail.loading ? 'Loading week…' : 'No week to plan'}</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Revised total = BANKED (what ran) + SCHEDULED (placed tiles on days ahead);
  // the ghost target is the prescribed plan. Reschedule the pool onto days and
  // the fill climbs toward the ghost.
  const scheduled = weekTotals(tiles, pl);
  const banked = { miles: goal?.mileage.actualMeters ?? 0, quality: goal?.quality.actualMeters ?? 0, long: goal?.long.actualMeters ?? 0 };
  // The plan's BUDGET (the immutable week target the projection is measured
  // against) and the PROJECTION (banked actuals + scheduled workouts — what
  // you'll finish at if you complete the remaining plan as it stands).
  const original = { miles: goal?.mileage.targetMeters ?? 0, quality: goal?.quality.targetMeters ?? 0, long: goal?.long.targetMeters ?? 0 };
  const revised = {
    miles: banked.miles + scheduled.miles,
    quality: banked.quality + scheduled.quality,
    long: Math.max(banked.long, scheduled.long),
  };
  // Every leg that ran on a date folds into one banked figure — see
  // `dayComposition.ts` for why this sums rather than replaces.
  const actualsByDay = new Map<number, { meters: number; deviated: boolean }>();
  for (const idx of new Set(board.actuals.map((a) => a.dayIdx))) {
    const summed = sumDayActuals(board.actuals.filter((a) => a.dayIdx === idx));
    if (summed) actualsByDay.set(idx, summed);
  }
  const tray = trayTiles(tiles, pl);

  // Persist the reshaped week: translate the board (tiles + current placement)
  // into saveWeekEdits' net EditableDay[] + ops. Closes the screen on success; on
  // failure it stays open so the in-progress edits aren't lost.
  const onSave = async () => {
    if (!canSave || planId == null || detail.weekId == null) return;
    const originals: OriginalWorkout[] = (detail.editableDays ?? []).map((dy) => ({
      workoutId: dy.workout.id,
      date: dy.workout.date ?? (detail.weekStart ?? ''),
      title: dy.workout.title ?? 'Run',
      type: (dy.workout.type ?? 'easy') as WorkoutType,
      isQuality: dy.workout.is_quality,
      plannedMeters: dy.workout.planned_distance_meters ?? 0,
      plannedDurationSeconds: dy.workout.planned_duration_s,
      prescribedQualityMeters: dy.workout.prescribed_quality_meters,
      structure: dy.workout.structure ?? [],
    }));
    const { finalDays, ops } = boardToWeekEdits({
      tiles,
      placement: pl,
      originalPlacement: board.placement,
      dayDates: days.map((d) => d.date),
      originals,
    });
    if (finalDays.length === 0) {
      router.back();
      return;
    }
    setSaving(true);
    try {
      await saveWeekEdits({
        planId,
        weekId: detail.weekId,
        finalDays,
        ops,
        queryClient,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.back();
    } catch (e) {
      setSaving(false);
      console.warn('planner save failed', e);
    }
  };

  // Per-day cell display: date + neutral mileage. Workout type lives in the
  // shared TypeMarks lane used by the Week calendar and Plan rows.
  const cellFor = (idx: number) => {
    const cd = weekDays[idx];
    const meta = days[idx]!;
    const act = actualsByDay.get(idx);
    const placed = tilesOnDay(tiles, pl, idx);
    // BANKED + STILL SCHEDULED, never one or the other — see `dayComposition`.
    let marks: CellMark[] = [];
    const { totalMeters: meters } = dayComposition({
      bankedMeters: act?.meters ?? null,
      scheduledMeters: placed.reduce((s, t) => s + t.meters, 0),
      isPast: meta.isPast,
    });
    const seen = new Set<string>();
    // What RAN marks first (quality if detected). Easy is the quiet default and
    // therefore intentionally unmarked app-wide.
    if (act && (cd?.activities ?? []).some((a) => a.qualityDetected === true)) {
      seen.add('quality');
      marks.push({ color: stripToneColor(C, 'quality') ?? C.qual });
    }
    for (const tile of [...placed].sort((a, b) => RANK[b.type] - RANK[a.type])) {
      const tone = toneOf(tile.type);
      if (tone === 'easy' || seen.has(tone)) continue;
      seen.add(tone);
      const color = stripToneColor(C, tone);
      if (color == null) continue;
      const banksQuality = tile.type !== 'quality' && (tile.qualityMeters ?? 0) > 0;
      marks.push(banksQuality ? { color, split: C.qualText } : { color });
    }
    marks = marks.slice(0, 3);
    const missed = meters <= 0 && cd?.state === 'missed';
    const rest = meters <= 0 && cd?.state === 'rest';
    const hollow = meters <= 0 && !missed && !rest && !meta.isPast;
    return {
      dom: cd ? Number(cd.localDate.slice(8, 10)) : meta.num,
      isToday: meta.isToday,
      miles: meters > 0 ? displayDistance(meters, units) : 0,
      marks,
      missed,
      rest,
      hollow,
    };
  };

  const selMeta = days[sel]!;
  const selCd = weekDays[sel];
  const selAct = actualsByDay.get(sel);
  // How the selected day presents itself: banked row, live rows, or the past's
  // verdict — and, on a partially-run two-a-day, the banked row AND live rows.
  const selDay = dayComposition({
    bankedMeters: selAct?.meters ?? null,
    scheduledMeters: tilesOnDay(tiles, pl, sel).reduce((sum, t) => sum + t.meters, 0),
    isPast: selMeta.isPast,
  });
  const selRanQuality = (selCd?.activities ?? []).some((a) => a.qualityDetected === true);
  const orderRank = (id: string) => {
    const i = orderIds.indexOf(id);
    return i < 0 ? 9999 : i;
  };
  const dayTiles = tilesOnDay(tiles, pl, sel).sort((a, b) => orderRank(a.id) - orderRank(b.id));
  const openWorkout = (t: PlanTile) => setComposer({ kind: 'edit', tileId: t.id });

  const dowOf = (idx?: number) => (idx != null && idx >= 0 && idx < 7 ? DOW_FULL[idx] : '');

  // Reflow: the dragged row collapses to 0-height (stays MOUNTED so its gesture
  // survives — unmounting mid-drag freezes it) while the rest slide to open a gap
  // at the finger's index; a faint ghost sits IN the gap showing where it lands.
  const draggedDayId = drag && !drag.fromPool ? drag.tile.id : null;
  const draggedPoolId = drag && drag.fromPool ? drag.tile.id : null;
  const dayVisibleCount = dayTiles.filter((t) => t.id !== draggedDayId).length;
  const dayGapAt = drag != null && dropAt?.zone === 1 ? Math.max(0, Math.min(dropAt.idx, dayVisibleCount)) : -1;
  const gapNode = (key: string, card: boolean) =>
    drag ? (
      <Animated.View key={key} layout={LinearTransition}>
        <GapGhost tile={drag.tile} card={card} C={C} styles={styles} easyBaseline={wm.easyBaseline} units={units} />
      </Animated.View>
    ) : null;

  /** `hasBanked` — the day already shows a locked actual above these rows, so an
   *  empty list is "nothing left to run", not "Rest". */
  const renderDayRows = (hasBanked = false) => {
    if (dayTiles.length === 0 && dayGapAt < 0) {
      if (hasBanked) return null;
      return (
        <View style={styles.ghostRow}>
          <SymbolView name="moon.zzz.fill" size={15} tintColor={C.faint} resizeMode="scaleAspectFit" />
          <Text maxFontSizeMultiplier={TEXT_SCALE} style={styles.ghostTxt}>Rest</Text>
        </View>
      );
    }
    const rows: React.ReactNode[] = [];
    let vis = 0;
    for (const t of dayTiles) {
      if (t.id === draggedDayId) {
        rows.push(
          <Animated.View key={t.id} layout={LinearTransition} style={styles.reflowCollapsed}>
            <EditorRow tile={t} C={C} styles={styles} easyBaseline={wm.easyBaseline} units={units} bare ctx={ctx} fromPool={false} dragging onPress={() => openWorkout(t)} />
          </Animated.View>,
        );
        continue;
      }
      if (vis === dayGapAt) rows.push(gapNode('__gap', false));
      rows.push(
        <Animated.View key={t.id} layout={LinearTransition}>
          <EditorRow tile={t} C={C} styles={styles} easyBaseline={wm.easyBaseline} units={units} bare ctx={ctx} fromPool={false} dragging={false} onPress={() => openWorkout(t)} />
        </Animated.View>,
      );
      vis++;
    }
    if (vis === dayGapAt) rows.push(gapNode('__gap', false));
    return rows;
  };

  const renderPoolRows = () => {
    const poolTiles = [...tray].sort((a, b) => orderRank(a.id) - orderRank(b.id));
    const poolVisibleCount = poolTiles.filter((t) => t.id !== draggedPoolId).length;
    const poolGapAt = drag != null && dropAt?.zone === 2 ? Math.max(0, Math.min(dropAt.idx, poolVisibleCount)) : -1;
    const rows: React.ReactNode[] = [];
    let vis = 0;
    for (const t of poolTiles) {
      const note = t.originPast ? `Missed · ${dowOf(t.originDay)}` : undefined;
      if (t.id === draggedPoolId) {
        rows.push(
          <Animated.View key={t.id} layout={LinearTransition} style={styles.reflowCollapsed}>
            <EditorRow tile={t} C={C} styles={styles} easyBaseline={wm.easyBaseline} units={units} note={note} ctx={ctx} fromPool dragging onPress={() => openWorkout(t)} />
          </Animated.View>,
        );
        continue;
      }
      if (vis === poolGapAt) rows.push(gapNode('__poolgap', true));
      rows.push(
        <Animated.View key={t.id} layout={LinearTransition}>
          <EditorRow tile={t} C={C} styles={styles} easyBaseline={wm.easyBaseline} units={units} note={note} ctx={ctx} fromPool dragging={false} onPress={() => openWorkout(t)} />
        </Animated.View>,
      );
      vis++;
    }
    if (vis === poolGapAt) rows.push(gapNode('__poolgap', true));
    return rows;
  };

  const editingTile = composer?.kind === 'edit'
    ? tiles.find((tile) => tile.id === composer.tileId) ?? null
    : null;
  const initialWorkout: BuiltWorkout | null = editingTile
    ? {
        type: editingTile.type,
        title: editingTile.title ?? '',
        distanceMeters: editingTile.meters,
        durationSeconds: editingTile.durationSeconds ?? null,
        structure: editingTile.structure ?? [],
      }
    : null;

  return (
    <GestureHandlerRootView style={styles.root}>
    {/* Full-screen native presentations can report zero insets on their first
        frame. Use the root provider's live values with launch metrics as the
        portrait-safe floor instead of shadowing it with a nested provider. */}
    <View
      testID="planner-safe-frame"
      style={[
        styles.root,
        {
          paddingTop: modalInsets.top,
          paddingRight: modalInsets.right,
          paddingBottom: modalInsets.bottom,
          paddingLeft: modalInsets.left,
        },
      ]}
    >
      <Header
        onClose={closePlanner}
        title="Adjust week"
        context={`${weekLabel(weekIndex)}${detail.weekStart ? ` · ${formatWeekRange(detail.weekStart)}` : ''}`}
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.pad}>
          <ReshapeSummary banked={banked} projected={revised} contract={original} />

          {/* Allocation is the task here, so the shared week rail acts as the
              day selector. Like the main Week screen, selection is contained
              by the day cell and the detail panel remains a separate surface. */}
          <View style={styles.headRow}>
            {DOW.map((w, i) => (
              <Text key={i} maxFontSizeMultiplier={1.2} style={styles.headCell}>
                {w}
              </Text>
            ))}
          </View>
          <View style={styles.weekRow}>
            {days.map((day) => (
              <View key={day.idx} style={styles.dayCellSlot}>
                <CalendarCell
                  {...cellFor(day.idx)}
                  unit={units}
                  selected={day.idx === sel}
                  simplified={accessibilityLayout}
                  height={CELL_H}
                  onPress={() => setSelectedIndex(day.idx)}
                  testID={`planner-day-${day.idx}`}
                />
              </View>
            ))}
          </View>
        </View>

        {/* Selected-day desk. Drop zone #1 places a holding-area row here. */}
        <View style={styles.panelPad}>
          <View ref={dayRef} style={styles.panel}>
            <View style={styles.dayDeskHead}>
              <Text maxFontSizeMultiplier={TEXT_SCALE} style={styles.dayDeskDate}>{formatDayLabel(selMeta.date, sel)}</Text>
            </View>
            {/* Inset to the desk's own gutter so the rule lines up with the
                date above it rather than running edge to edge. */}
            <Divider inset={space.md} />
            {/* What RAN is banked and locked; what is still PLANNED stays live
                beside it. These are two independent facts about the day, and
                collapsing them into one branch is what made the unrun half of a
                two-a-day unreachable — the AM's actual replaced the whole desk,
                so the PM's tile (which the board correctly still places here)
                was never rendered. A day is resolved per WORKOUT, not per day.

                The banked row deliberately sits OUTSIDE `rowsRef`: that ref
                anchors the drag layer's drop-index math
                (`round((y - rowsTop) / REFLOW_ROW_H)`), so a non-draggable row
                inside it would shift every slot by one. */}
            <View style={styles.dayDeskRows}>
              {selDay.showsBanked && selAct ? (
                <WorkoutRow
                  style={styles.bareRow}
                  accent={selRanQuality ? C.qual : stripToneColor(C, 'easy') ?? C.mute}
                  icon={selRanQuality ? 'bolt.fill' : 'figure.run'}
                  title={selRanQuality ? 'Quality' : 'Easy'}
                  typeLine="Banked actual"
                  distLabel={displayDistance(selAct.meters, units)}
                  distanceUnit={units}
                  accessory={<SymbolView name="lock.fill" size={12} tintColor={C.faint} resizeMode="scaleAspectFit" style={styles.lockAcc} />}
                />
              ) : null}
              {selDay.showsGhost ? (
                <View style={styles.ghostRow}>
                  <SymbolView name={selCd?.state === 'rest' ? 'moon.zzz.fill' : 'xmark.circle'} size={15} tintColor={C.faint} resizeMode="scaleAspectFit" />
                  <Text maxFontSizeMultiplier={TEXT_SCALE} style={styles.ghostTxt}>{selCd?.state === 'rest' ? 'Rest' : 'Missed'}</Text>
                </View>
              ) : null}
              {selDay.showsEditableRows ? (
                <View ref={rowsRef} style={styles.reflowList}>{renderDayRows(selDay.showsBanked)}</View>
              ) : null}
            </View>
          </View>
        </View>

        {/* Holding area. Drop zone #2 frees a placed row back to the pool. */}
        <View ref={poolRef} style={[styles.pad, styles.poolZone, drag && styles.poolZoneDragging]}>
          <View style={styles.holdingHead}>
            <View style={styles.holdingTitleRow}>
              <Text maxFontSizeMultiplier={TEXT_SCALE} style={styles.holdingTitle}>Unscheduled</Text>
              {tray.length > 0 ? (
                <Text maxFontSizeMultiplier={TEXT_SCALE} style={styles.holdingCount}>{`${tray.length} ${tray.length === 1 ? 'workout' : 'workouts'}`}</Text>
              ) : null}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Add an unscheduled workout" onPress={() => setComposer({ kind: 'new' })} style={styles.addInline}>
              <SymbolView name="plus" size={12} tintColor={C.mute} resizeMode="scaleAspectFit" />
              <Text maxFontSizeMultiplier={TEXT_SCALE} style={styles.addInlineText}>Add workout</Text>
            </Pressable>
          </View>
          {tray.length === 0 && dropAt?.zone !== 2 ? (
            drag ? (
              <View style={[styles.poolDropWell, dropAt?.zone === 2 && styles.poolDropWellActive]}>
                <SymbolView name="arrow.down" size={13} tintColor={C.faint} weight="bold" resizeMode="scaleAspectFit" />
                <Text maxFontSizeMultiplier={TEXT_SCALE} style={styles.poolDropText}>Drop here</Text>
              </View>
            ) : null
          ) : (
            <View ref={poolRowsRef} style={styles.reflowList}>{renderPoolRows()}</View>
          )}
        </View>
        <View style={{ height: 24 }} />
      </ScrollView>

      {/* Floating drag ghost. */}
      {drag ? (
        <Animated.View pointerEvents="none" style={[styles.ghost, ghostStyle]}>
          <View style={[styles.ghostTok, { backgroundColor: tintHex(stripToneColor(C, toneOf(drag.tile.type)) ?? C.mute, 0.16) }]}>
            <SymbolView name={TONE_ICON[drag.tile.type]} size={15} tintColor={stripToneColor(C, toneOf(drag.tile.type)) ?? C.mute} resizeMode="scaleAspectFit" />
          </View>
          <Text maxFontSizeMultiplier={TEXT_SCALE} style={styles.ghostTitle}>{typeLabel(drag.tile)}</Text>
          <View style={{ flex: 1 }} />
          <Text maxFontSizeMultiplier={TEXT_SCALE} style={styles.ghostMi}>
            {displayDistance(drag.tile.meters, units)}
            <Text maxFontSizeMultiplier={TEXT_SCALE} style={styles.ghostMiU}> {units}</Text>
          </Text>
        </Animated.View>
      ) : null}

      {/* The Save/Reset bar hides while the sheet is up so its yellow never
          bleeds under the content-height modal. */}
      {composer ? null : (
        <ModalFooter style={styles.foot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reset week changes"
            accessibilityState={{ disabled: !hasDraftChanges || saving }}
            disabled={!hasDraftChanges || saving}
            onPress={resetChanges}
            style={[styles.btnG, (!hasDraftChanges || saving) && styles.btnGDisabled]}
          >
            <Text maxFontSizeMultiplier={TEXT_SCALE} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.btnGTxt, (!hasDraftChanges || saving) && styles.btnGTxtDisabled]}>Reset</Text>
          </Pressable>
          <ActionButton
            color={C.yellow}
            accessibilityLabel={hasUnplacedNewWorkout ? 'Place new workouts before saving' : 'Save week changes'}
            loadingAccessibilityLabel="Saving week changes"
            loadingLabel="Saving…"
            onPress={onSave}
            disabled={!canSave && !saving}
            loading={saving}
            variant="commit"
            style={styles.btnPOuter}
          >
            <ActionButtonLabel maxFontSizeMultiplier={TEXT_SCALE} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={!canSave ? styles.btnPTxtDisabled : undefined}>Save week</ActionButtonLabel>
          </ActionButton>
        </ModalFooter>
      )}

      <WorkoutEditorModal
        visible={composer != null}
        onClose={() => setComposer(null)}
        onSubmit={(workout) => {
          if (composer?.kind === 'edit') updateWorkout(composer.tileId, workout);
          else addNewWorkout(workout);
        }}
        easyBaseline={wm.easyBaseline}
        racePaces={racePaces}
        initialWorkout={initialWorkout}
        submitLabel={composer?.kind === 'edit' ? 'Apply changes' : undefined}
        editorKey={composer?.kind === 'edit' ? `edit-${composer.tileId}` : 'new'}
      />
    </View>
    </GestureHandlerRootView>
  );
}

// ── A workout row — the shared WorkoutRow (same as the Dash), as a card with a
//    drag grip. Grip-drag lands in Phase B. ────────────────────────────────
function EditorRow({
  tile,
  C,
  styles,
  easyBaseline,
  units,
  note,
  ctx,
  fromPool,
  dragging,
  bare,
  divider,
  onPress,
}: {
  tile: PlanTile;
  C: Tokens;
  styles: ReturnType<typeof makeStyles>;
  easyBaseline: number;
  units: DistancePreference;
  note?: string;
  ctx: DragCtx;
  fromPool: boolean;
  dragging: boolean;
  /** Bare row inside the day panel (no card), split by a hairline divider. */
  bare?: boolean;
  divider?: boolean;
  onPress?: () => void;
}) {
  const color = stripToneColor(C, toneOf(tile.type)) ?? C.mute;
  const est = easyBaseline > 0 ? formatDurationApprox(metersToMiles(tile.meters) * easyBaseline) : undefined;
  const pan = useMemo(() => buildDrag(tile, fromPool, ctx), [tile, fromPool, ctx]);
  return (
    <GestureDetector gesture={pan}>
      <View style={[bare ? undefined : styles.rowGap, dragging && styles.dragging]}>
        <WorkoutRow
          card={!bare}
          style={bare ? styles.bareRow : undefined}
          accent={color}
          icon={TONE_ICON[tile.type]}
          title={typeLabel(tile)}
          typeLine={tile.structureLabel}
          distLabel={displayDistance(tile.meters, units)}
          distanceUnit={units}
          secondary={est ? { label: est, icon: 'clock' } : undefined}
          note={note}
          onPress={onPress}
          accessory={
            <View style={styles.gripHit}>
              <View style={styles.grip}>
                <View style={styles.gripBar} />
                <View style={styles.gripBar} />
                <View style={styles.gripBar} />
              </View>
            </View>
          }
        />
        {divider ? <View style={styles.dayDivider} /> : null}
      </View>
    </GestureDetector>
  );
}

// ── The faint preview that sits in the reflow gap (where the tile will land). ─
function GapGhost({
  tile,
  card,
  C,
  styles,
  easyBaseline,
  units,
}: {
  tile: PlanTile;
  card: boolean;
  C: Tokens;
  styles: ReturnType<typeof makeStyles>;
  easyBaseline: number;
  units: DistancePreference;
}) {
  const color = stripToneColor(C, toneOf(tile.type)) ?? C.mute;
  const est = easyBaseline > 0 ? formatDurationApprox(metersToMiles(tile.meters) * easyBaseline) : undefined;
  return (
    <View style={styles.gapGhost} pointerEvents="none">
      <WorkoutRow
        card={card}
        style={card ? undefined : styles.bareRow}
        accent={color}
        icon={TONE_ICON[tile.type]}
        title={typeLabel(tile)}
        typeLine={tile.structureLabel}
        distLabel={displayDistance(tile.meters, units)}
        distanceUnit={units}
        secondary={est ? { label: est, icon: 'clock' } : undefined}
      />
    </View>
  );
}

/** hex → rgba at alpha a. */
function tintHex(hex: string, a: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function Header({ onClose, title, context, topInset }: { onClose: () => void; title: string; context?: string; topInset?: number }) {
  return <SheetHeader onClose={onClose} title={title} context={context} topInset={topInset} />;
}

function weekLabel(idx: number | null): string {
  return idx != null && Number.isFinite(idx) ? `Week ${idx}` : 'Week';
}

function formatWeekRange(weekStart: string): string {
  const start = new Date(`${weekStart}T12:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const startLabel = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const endLabel = end.toLocaleDateString('en-US', {
    month: start.getUTCMonth() === end.getUTCMonth() ? undefined : 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  return `${startLabel}–${endLabel}`;
}

function formatDayLabel(date: string, dayIndex: number): string {
  if (!date) return DOW_FULL[dayIndex] ?? 'Day';
  const label = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  return label;
}

function addDaysUTC(date: string, n: number): string {
  const dt = new Date(`${date}T12:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    empty: { alignItems: 'center', paddingTop: 80 },
    emptyTxt: { color: C.mute, fontSize: fontSizes.labelLg, fontWeight: '600' },

    scroll: { paddingTop: space.xs, paddingBottom: space.md },
    pad: { paddingHorizontal: space.l },
    panelPad: { paddingHorizontal: space.l, paddingTop: space.md },

    headRow: { flexDirection: 'row', gap: GAP, paddingTop: space.lg, paddingBottom: GAP, paddingHorizontal: EDGE },
    headCell: { flex: 1, textAlign: 'center', color: C.faint, fontSize: fontSizes.micro, fontWeight: '800', letterSpacing: 0.5 },
    weekRow: { flexDirection: 'row', gap: GAP, paddingHorizontal: EDGE },
    dayCellSlot: { flex: 1, height: CELL_H },

    // The selected day and its desk are separate surfaces, matching Week.
    panel: {
      overflow: 'hidden',
      backgroundColor: C.panel,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.line,
    },
    dayDeskHead: { minHeight: 46, justifyContent: 'center', paddingHorizontal: space.md, paddingVertical: space.sm },
    dayDeskDate: { color: C.ink, fontSize: fontSizes.labelLg, fontWeight: '800', letterSpacing: -0.15 },
    dayDeskRows: { paddingHorizontal: space.md, paddingTop: space.xs, paddingBottom: space.sm },

    rowGap: { marginBottom: space.sm },
    dragging: { opacity: 0.3 },
    bareRow: { paddingHorizontal: 0, paddingVertical: space.sm, alignItems: 'center' },
    // Rows use container `gap` (no trailing margin after the last row, so top +
    // bottom panel padding read symmetric).
    reflowList: { gap: space.sm },
    reflowCollapsed: { height: 0, overflow: 'hidden' },
    gapGhost: { opacity: 0.34 },
    dayDivider: { height: StyleSheet.hairlineWidth, backgroundColor: C.line, marginLeft: 48 },
    gripHit: { alignSelf: 'center', paddingVertical: space.sm, paddingLeft: space.sm, paddingRight: space.xxs },
    lockAcc: { alignSelf: 'center', marginLeft: space.xs },
    grip: { gap: 2.5 },
    gripBar: { width: 14, height: 2, borderRadius: 2, backgroundColor: C.faint },

    poolZone: { position: 'relative', paddingTop: space.lg },
    poolZoneDragging: { minHeight: 112 },
    poolDropWell: {
      minHeight: 56,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: space.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.line,
      borderRadius: radius.md,
      backgroundColor: C.recess,
    },
    poolDropWellActive: { borderColor: C.faint, backgroundColor: C.panel },
    poolDropText: { color: C.mute, fontSize: fontSizes.metadata, fontWeight: '800' },

    ghost: {
      position: 'absolute',
      top: 0,
      left: 0,
      width: GHOST_W,
      height: GHOST_H,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.m,
      paddingHorizontal: space.md,
      borderRadius: radius.md,
      backgroundColor: C.panel,
      borderWidth: 1,
      borderColor: C.ink,
      shadowColor: '#000',
      shadowOpacity: 0.45,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 7 },
      elevation: 14,
    },
    ghostTok: { width: 26, height: 26, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
    ghostTitle: { color: C.ink, fontSize: fontSizes.labelLg, fontWeight: '800' },
    ghostMi: { ...statValueText(C, 'labelLg', 'system'), fontWeight: '800' },
    ghostMiU: { color: C.faint, fontSize: fontSizes.micro, fontWeight: '700' },

    // Rest / Missed reads as a recessed well (same de-dent as the drop slot), not a dashed box.
    ghostRow: { flexDirection: 'row', alignItems: 'center', gap: space.m, backgroundColor: C.recess, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line, borderRadius: radius.md, paddingVertical: space.l, paddingHorizontal: space.l },
    ghostTxt: { color: C.faint, fontSize: fontSizes.label, fontWeight: '700' },

    holdingHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, marginBottom: space.sm },
    holdingTitleRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'baseline', gap: space.s },
    holdingTitle: { color: C.ink, fontSize: fontSizes.labelLg, fontWeight: '800', letterSpacing: -0.15 },
    holdingCount: { color: C.mute, fontSize: fontSizes.labelSm, fontWeight: '700' },
    addInline: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: space.s, paddingHorizontal: space.xs },
    addInlineText: { color: C.mute, fontSize: fontSizes.labelSm, fontWeight: '800' },

    foot: { flexDirection: 'row', gap: space.md },
    btnG: { flex: 0.4, minHeight: 52, justifyContent: 'center', backgroundColor: C.fill, borderWidth: 1, borderColor: C.line, borderRadius: radius.md, alignItems: 'center' },
    btnGDisabled: { backgroundColor: 'transparent' },
    btnGTxt: { color: C.ink, fontSize: fontSizes.labelLg, fontWeight: '800' },
    btnGTxtDisabled: { color: C.faint },
    btnPOuter: { flex: 1 },
    btnPTxtDisabled: { color: C.mute },
  });
