import {
  buildSampleBlock,
  SAMPLE_PLAN_META,
  todayLocal,
  weekStartOf,
  type SampleWorkout,
} from '@/lib';

import { supabase } from './supabase';

/**
 * DEV SEED — remove when real Strava/import data flows.
 *
 * Ensures the current (anonymous dev) user has a realistic active plan so the
 * Dash has data to render: a plan resembling Jake's Chicago 2026 marathon block
 * with plan weeks, a modest set of workouts for the first few weeks, and fake
 * past activities so the plan-vs-actual chart and consistency heatmap show real
 * ACTUAL bars/cells.
 *
 * This is a thin wrapper around the pure `buildSampleBlock` shaper (tested under
 * the node jest project). All it does is decide whether to seed and translate
 * the shaped arrays into Supabase inserts. The DB trigger auto-creates the owner
 * `plan_members` row when the plan is inserted, so subsequent writes pass RLS.
 *
 * Idempotent: it no-ops if the user already has an active plan, and the fake
 * activities are guarded by a check for existing `seed-*` source ids.
 */

const SEED_SOURCE = 'manual';

/** The Monday ~18 weeks before today, so the block straddles "now". */
function startDateMonday(today: string): string {
  // Walk back 4 weeks from today's week-start so we're a few weeks in (realistic
  // mid-block Dash), then the 18-week block extends forward past the race date.
  const ws = weekStartOf(today, 'mon');
  const base = new Date(`${ws}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() - 7 * 4);
  return base.toISOString().slice(0, 10);
}

export interface EnsureSampleResult {
  planId: string;
  created: boolean;
}

export async function ensureSamplePlan(userId: string): Promise<EnsureSampleResult> {
  // 1. Already have an active plan? Use it (and top up seed activities if missing).
  const { data: existing, error: existingErr } = await supabase
    .from('plans')
    .select('id, race_name, created_via, start_date')
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1);
  if (existingErr) throw new Error(`ensureSamplePlan: read plans: ${existingErr.message}`);

  const today = todayLocal();
  const startDate = startDateMonday(today);

  if (existing && existing.length > 0) {
    const active = existing[0]!;
    const planId = active.id as string;
    if (
      active.race_name === SAMPLE_PLAN_META.raceName &&
      active.created_via === SAMPLE_PLAN_META.createdVia
    ) {
      await repairSampleQualityWorkouts(planId, (active.start_date as string | null) ?? startDate, today);
    }
    await ensureSeedActivities(userId, startDate, today);
    return { planId, created: false };
  }

  // 2. No active plan — create the full sample block.
  const block = buildSampleBlock({ startDate, today });

  // Insert the plan WITHOUT a returning representation. Read-access to a plan is
  // granted by the owner `plan_members` row that the `add_plan_owner` AFTER
  // trigger creates; an `INSERT ... RETURNING` (what `.select()` does) evaluates
  // the SELECT/RLS policy within the same statement, before that AFTER trigger
  // has committed the membership, so it fails the `plans_select` policy. We do a
  // plain insert, then read the plan back (the trigger has run by then).
  const { error: planErr } = await supabase.from('plans').insert({
    race_name: SAMPLE_PLAN_META.raceName,
    distance_kind: SAMPLE_PLAN_META.distanceKind,
    race_date: SAMPLE_PLAN_META.raceDate,
    goal_time: SAMPLE_PLAN_META.goalTime,
    start_date: startDate,
    num_weeks: SAMPLE_PLAN_META.numWeeks,
    created_via: SAMPLE_PLAN_META.createdVia,
    status: SAMPLE_PLAN_META.status,
  });
  if (planErr) {
    throw new Error(`ensureSamplePlan: insert plan: ${planErr.message}`);
  }

  // Read back the plan we just created (most recent active plan for this user).
  const { data: createdPlan, error: readErr } = await supabase
    .from('plans')
    .select('id')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (readErr || !createdPlan) {
    throw new Error(`ensureSamplePlan: read back plan: ${readErr?.message ?? 'no row'}`);
  }
  const planId = createdPlan.id as string;

  // 3. Plan weeks. Insert and read back ids so workouts can reference week_id.
  const { data: weekRows, error: weekErr } = await supabase
    .from('plan_weeks')
    .insert(
      block.weeks.map((w) => ({
        plan_id: planId,
        week_index: w.weekIndex,
        phase: w.phase,
        target_meters: w.targetMeters,
        original_target_meters: w.originalTargetMeters,
        quality_target_meters: w.qualityTargetMeters,
        long_target_meters: w.longTargetMeters,
        is_recovery: w.isRecovery,
      })),
    )
    .select('id, week_index');
  if (weekErr || !weekRows) {
    throw new Error(`ensureSamplePlan: insert plan_weeks: ${weekErr?.message ?? 'no rows'}`);
  }
  const weekIdByIndex = new Map<number, string>();
  for (const r of weekRows) weekIdByIndex.set(r.week_index as number, r.id as string);

  // 4. Workouts.
  if (block.workouts.length > 0) {
    const { error: woErr } = await supabase.from('workouts').insert(
      block.workouts.map((w: SampleWorkout) => ({
        plan_id: planId,
        week_id: weekIdByIndex.get(w.weekIndex) ?? null,
        date: w.date,
        type: w.type,
        title: w.title,
        planned_distance_meters: w.plannedDistanceMeters,
        structure: w.structure,
        is_quality: w.isQuality,
        notes: w.notes ?? null,
      })),
    );
    if (woErr) throw new Error(`ensureSamplePlan: insert workouts: ${woErr.message}`);
  }

  // 5. Fake past activities.
  await ensureSeedActivities(userId, startDate, today);

  return { planId, created: true };
}

async function repairSampleQualityWorkouts(
  planId: string,
  startDate: string,
  today: string,
): Promise<void> {
  const block = buildSampleBlock({ startDate, today });
  const qualityByDate = new Map(
    block.workouts.filter((w) => w.isQuality).map((w) => [w.date, w]),
  );
  if (qualityByDate.size === 0) return;

  const { data: rows, error } = await supabase
    .from('workouts')
    .select('id, date, title, structure, notes, is_quality, type')
    .eq('plan_id', planId)
    .or('is_quality.eq.true,type.eq.quality');
  if (error) throw new Error(`ensureSamplePlan: repair quality workouts: ${error.message}`);

  for (const row of rows ?? []) {
    const date = row.date as string | null;
    if (!date) continue;
    const shaped = qualityByDate.get(date);
    if (!shaped) continue;
    const structure = row.structure as unknown;
    const missingStructure = !Array.isArray(structure) || structure.length === 0;
    const missingNotes = typeof row.notes !== 'string' || row.notes.trim().length === 0;
    const genericTitle = !row.title || row.title === 'Quality session';
    if (!missingStructure && !missingNotes && !genericTitle) continue;

    const { error: updateErr } = await supabase
      .from('workouts')
      .update({
        title: genericTitle ? shaped.title : row.title,
        structure: missingStructure ? shaped.structure : row.structure,
        notes: missingNotes ? (shaped.notes ?? null) : row.notes,
      })
      .eq('id', row.id);
    if (updateErr) {
      throw new Error(`ensureSamplePlan: update quality workout: ${updateErr.message}`);
    }
  }
}

/**
 * DEV SEED — insert the fake past activities once. Guarded by checking for any
 * existing `seed-*` activity for this user.
 */
async function ensureSeedActivities(
  userId: string,
  startDate: string,
  today: string,
): Promise<void> {
  // A user with ANY real (non-manual) activity never gets seed activities.
  // Without this, the connect-time seed retirement is undone on next launch:
  // the seed-% guard below sees zero seed rows and re-injects fakes alongside
  // real Strava data (the dual-source double-count bug of 2026-06-04).
  const { count: realCount, error: realErr } = await supabase
    .from('activities')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .neq('source', 'manual');
  if (realErr) throw new Error(`ensureSamplePlan: read real activities: ${realErr.message}`);
  if ((realCount ?? 0) > 0) return;

  const { data: existingSeed, error: seedErr } = await supabase
    .from('activities')
    .select('id, source_id, moving_time_s, streams, stream_summary')
    .eq('user_id', userId)
    .like('source_id', 'seed-%');
  if (seedErr) throw new Error(`ensureSamplePlan: read activities: ${seedErr.message}`);

  const block = buildSampleBlock({ startDate, today });
  if (block.activities.length === 0) return;

  if (existingSeed && existingSeed.length > 0) {
    // Already seeded. Detect rows missing the latest enrichment (null
    // moving_time_s from the first pass, null streams from the streams pass, OR
    // null stream_summary from the quality-demo pass) and UPDATE those rows in
    // place rather than duplicating. Idempotent: once a row has moving_time_s,
    // streams, AND stream_summary set, it no-ops.
    const needsEnrichment = existingSeed.some(
      (r) => r.moving_time_s == null || r.streams == null || r.stream_summary == null,
    );
    if (!needsEnrichment) return;
    const bySourceId = new Map(block.activities.map((a) => [a.sourceId, a]));
    for (const row of existingSeed) {
      const a = bySourceId.get(row.source_id as string);
      if (!a) continue;
      const { error: updErr } = await supabase
        .from('activities')
        .update({
          start_date: a.startDate ?? `${a.localDate}T13:00:00Z`,
          distance_meters: a.distanceMeters,
          moving_time_s: a.movingTimeS ?? null,
          avg_hr: a.avgHr ?? null,
          avg_temp_c: a.avgTempC ?? null,
          best_efforts: a.bestEfforts ?? null,
          streams: a.streams ?? null,
          stream_summary: a.streamSummary ?? null,
          route: a.route ?? null,
        })
        .eq('user_id', userId)
        .eq('source_id', row.source_id as string);
      if (updErr) throw new Error(`ensureSamplePlan: enrich activity: ${updErr.message}`);
    }
    return;
  }

  const { error: insErr } = await supabase.from('activities').insert(
    block.activities.map((a) => ({
      user_id: userId,
      source: SEED_SOURCE,
      source_id: a.sourceId,
      local_date: a.localDate,
      start_date: a.startDate ?? `${a.localDate}T13:00:00Z`,
      distance_meters: a.distanceMeters,
      moving_time_s: a.movingTimeS ?? null,
      avg_hr: a.avgHr ?? null,
      avg_temp_c: a.avgTempC ?? null,
      best_efforts: a.bestEfforts ?? null,
      streams: a.streams ?? null,
      stream_summary: a.streamSummary ?? null,
      route: a.route ?? null,
      name: 'Run',
      sport_type: 'Run',
    })),
  );
  if (insErr) throw new Error(`ensureSamplePlan: insert activities: ${insErr.message}`);
}
