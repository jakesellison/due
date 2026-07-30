/**
 * stravaDescription.ts — write Due's plan-progress block into a run's Strava
 * description (opt-in). Called from the webhook ingest for a fresh run: computes
 * the run's WEEK three-pillar progress (mileage always; quality/long when the
 * plan prescribes them), builds the block, merges it below the athlete's own
 * text, and PUTs it back to Strava (needs the activity:write scope).
 *
 * Best-effort throughout: any failure (no plan, no scope, Strava error) is
 * swallowed/logged and MUST NOT break ingest.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { weekStartOf, type WeekStart } from '../lib/time/week';
import { resolveQuality, type QualityOverride } from '../lib/kpi/resolveQuality';
import { buildDescriptionBlock, mergeDescription, type DescriptionInput } from '../lib/strava/description';
import { deriveSupportingContractTargets } from '../lib/plan/supportingContracts';
import { METERS_PER_MILE } from '../lib/units';
import type { WorkoutStructure } from '../lib/workout/types';
import type { QualitySummary } from '../lib/run/streamSummary';
import { hasStravaScope } from './strava';

/** 'YYYY-MM-DD' + n days, via UTC noon to dodge DST/tz edges. */
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The run's week three-pillar progress for the description, or null when there's
 * no active plan / no targets for the week (nothing meaningful to show).
 */
export async function computeWeekProgress(
  admin: SupabaseClient,
  userId: string,
  localDate: string,
  weekStart: WeekStart,
): Promise<DescriptionInput | null> {
  const { data: memberships, error: membershipsError } = await admin
    .from('plan_members')
    .select('plan_id')
    .eq('user_id', userId);
  if (membershipsError) throw new Error(`plan membership lookup failed: ${membershipsError.message}`);
  const planIds = ((memberships ?? []) as { plan_id: string }[]).map((m) => m.plan_id);
  if (planIds.length === 0) return null;
  const { data: plans, error: plansError } = await admin
    .from('plans')
    .select('id, num_weeks')
    .in('id', planIds)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1);
  if (plansError) throw new Error(`active plan lookup failed: ${plansError.message}`);
  const plan = plans?.[0] as { id: string; num_weeks: number | null } | undefined;
  if (!plan) return null;

  const ws = weekStartOf(localDate, weekStart);
  const we = addDays(ws, 6);

  // Targets from the plan week's workouts.
  const { data: workoutRows, error: workoutsError } = await admin
    .from('workouts')
    .select('date, type, planned_distance_meters, structure, is_quality, prescribed_quality_meters, week_id')
    .eq('plan_id', plan.id)
    .gte('date', ws)
    .lte('date', we);
  if (workoutsError) throw new Error(`week workout lookup failed: ${workoutsError.message}`);
  const workouts = (workoutRows ?? []) as {
    date: string | null;
    type: string | null;
    planned_distance_meters: number | null;
    structure: WorkoutStructure | null;
    is_quality: boolean;
    prescribed_quality_meters: number | null;
    week_id: string | null;
  }[];
  let weekId: string | null = null;
  for (const w of workouts) {
    weekId = weekId ?? w.week_id;
  }

  const fallbackTargets = deriveSupportingContractTargets(workouts.map((w) => ({
    type: w.type,
    isQuality: w.is_quality,
    plannedDistanceMeters: w.planned_distance_meters,
    structure: w.structure ?? [],
    prescribedQualityMeters: w.prescribed_quality_meters,
  })));

  // The stored weekly contract is authoritative. Derivation exists only for
  // pre-migration rows that do not yet carry supporting-contract columns.
  let mileageTargetM = 0;
  let qualityTargetM = fallbackTargets.qualityTargetMeters;
  let longTargetM = fallbackTargets.longTargetMeters;
  let weekNumber = 0;
  let phase: string | null = null;
  if (weekId) {
    const { data: pw, error: planWeekError } = await admin
      .from('plan_weeks')
      .select('target_meters, week_index, phase, is_recovery, quality_target_meters, long_target_meters')
      .eq('id', weekId)
      .eq('plan_id', plan.id)
      .maybeSingle();
    if (planWeekError) throw new Error(`week contract lookup failed: ${planWeekError.message}`);
    const row = pw as {
      target_meters: number | null;
      week_index: number | null;
      phase: string | null;
      is_recovery: boolean | null;
      quality_target_meters?: number | null;
      long_target_meters?: number | null;
    } | null;
    mileageTargetM = row?.target_meters ?? 0;
    qualityTargetM = row?.quality_target_meters ?? qualityTargetM;
    longTargetM = row?.long_target_meters ?? longTargetM;
    weekNumber = row?.week_index ?? 0; // week_index is 1-based (verified)
    phase = row?.is_recovery ? 'recovery' : row?.phase ?? null;
  }

  // Actuals from the week's runs.
  const { data: actRows, error: activitiesError } = await admin
    .from('activities')
    .select('local_date, distance_meters, stream_summary, quality_override')
    .eq('user_id', userId)
    .gte('local_date', ws)
    .lte('local_date', we);
  if (activitiesError) throw new Error(`week activity lookup failed: ${activitiesError.message}`);
  const acts = (actRows ?? []) as {
    local_date: string | null;
    distance_meters: number | null;
    stream_summary: { quality?: QualitySummary | null } | null;
    quality_override: QualityOverride | null;
  }[];
  let mileageM = 0;
  let qualityM = 0;
  let longM = 0;
  let dayM = 0;
  for (const a of acts) {
    const d = a.distance_meters ?? 0;
    mileageM += d;
    if (a.local_date === localDate) dayM += d;
    longM = Math.max(longM, d);
    const q = a.stream_summary?.quality;
    if (q) qualityM += resolveQuality(q, a.quality_override).qualityMi * METERS_PER_MILE;
  }

  if (mileageTargetM <= 0 && qualityTargetM <= 0 && longTargetM <= 0) return null;

  const dayWorkouts = workouts.filter((w) => w.date === localDate && w.type !== 'rest');
  const dayTargetM = dayWorkouts.reduce((sum, workout) => sum + (workout.planned_distance_meters ?? 0), 0);
  const hasQuality = dayWorkouts.some((w) => w.is_quality || w.type === 'quality');
  const hasLong = dayWorkouts.some((w) => w.type === 'long');
  const onlyEasy = dayWorkouts.length > 0 && dayWorkouts.every((w) => w.type === 'easy');
  const allocationLabel = hasLong && hasQuality
    ? 'Long + quality'
    : hasQuality
      ? 'Quality day'
      : hasLong
        ? 'Long run'
        : onlyEasy && dayWorkouts.length > 1
          ? 'Easy double'
          : onlyEasy
            ? 'Easy run'
            : 'Unscheduled run';

  const pillars: DescriptionInput['pillars'] = { mileage: { actualMi: mileageM / METERS_PER_MILE, targetMi: mileageTargetM / METERS_PER_MILE } };
  if (qualityTargetM > 0) pillars.quality = { actualMi: qualityM / METERS_PER_MILE, targetMi: qualityTargetM / METERS_PER_MILE };
  if (longTargetM > 0) pillars.long = { actualMi: longM / METERS_PER_MILE, targetMi: longTargetM / METERS_PER_MILE };

  return {
    weekNumber: Math.max(1, weekNumber),
    totalWeeks: Math.max(1, plan.num_weeks ?? weekNumber),
    phase,
    allocation: {
      label: allocationLabel,
      actualMi: dayM / METERS_PER_MILE,
      targetMi: dayTargetM / METERS_PER_MILE,
    },
    pillars,
  };
}

/** PUT the merged description back to Strava (needs activity:write). */
async function putActivityDescription(accessToken: string, activityId: number | string, description: string): Promise<boolean> {
  try {
    // Digits only: this id is interpolated into the API path, and WHATWG URL
    // resolves dot segments — a non-numeric id would retarget this authenticated
    // PUT (see `assertNumericId` in strava.ts).
    const id = String(activityId);
    if (!/^\d+$/.test(id)) {
      console.warn('[strava-desc] refusing non-numeric activity id', JSON.stringify(id));
      return false;
    }
    const res = await fetch(`https://www.strava.com/api/v3/activities/${id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description }),
    });
    if (res.ok) return true;
    console.warn('[strava-desc] update failed', res.status, await res.text());
    return false;
  } catch (err) {
    console.warn('[strava-desc] update failed', err);
    return false;
  }
}

export type RunDescriptionWriteOutcome =
  | 'written'
  | 'unchanged'
  | 'opted_out'
  | 'missing_scope'
  | 'no_plan_context'
  | 'failed';

/**
 * If the user opted in, write the plan-progress block into this run's Strava
 * description (merged below their own text). No-op when opted out, no plan, or
 * nothing changed. Best-effort — never throws into ingest.
 */
export async function maybeWriteRunDescription(
  admin: SupabaseClient,
  userId: string,
  accessToken: string,
  activityId: number | string,
  localDate: string,
  existingDescription: string | null | undefined,
  grantedScope?: string | null,
): Promise<RunDescriptionWriteOutcome> {
  const { data: u, error: userError } = await admin.from('users').select('settings, week_start').eq('id', userId).maybeSingle();
  if (userError) {
    console.warn('[strava-desc] settings lookup failed', userError);
    return 'failed';
  }
  const row = u as { settings: { strava_description?: boolean } | null; week_start: string | null } | null;
  if (!row?.settings?.strava_description) return 'opted_out';
  if (!hasStravaScope(grantedScope, 'activity:write')) return 'missing_scope';

  const weekStart: WeekStart = row.week_start === 'sun' ? 'sun' : 'mon';
  let progress: DescriptionInput | null = null;
  try {
    progress = await computeWeekProgress(admin, userId, localDate, weekStart);
  } catch (err) {
    console.warn('[strava-desc] plan context failed', err);
    return 'failed';
  }
  if (!progress) return 'no_plan_context';

  const merged = mergeDescription(existingDescription, buildDescriptionBlock(progress));
  if (merged === (existingDescription ?? '')) return 'unchanged';

  return (await putActivityDescription(accessToken, activityId, merged)) ? 'written' : 'failed';
}
