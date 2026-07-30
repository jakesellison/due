import { useQuery } from '@tanstack/react-query';

import {
  isoDaysAgo,
  RECENT_WINDOW_DAYS,
  weeklyMilesFromRows,
  type ActivityMileageRow,
} from '@/lib/plan/starter/recentMileage';

import { useSession } from '../auth';
import { supabase } from '../supabase';

/** Today as a local `YYYY-MM-DD` (matches how `local_date` is stored). */
function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Average weekly mileage over the trailing 28 days, for the starter picker's
 * tier suggestion. Reads `activities` (RLS-scoped to the signed-in user) and
 * feeds the rows through the pure `weeklyMilesFromRows`. `weeklyMiles` is `null`
 * until loaded, or when the user has no activity in the window.
 */
export function useRecentWeeklyMiles(): { weeklyMiles: number | null; isLoading: boolean } {
  const { userId } = useSession();
  const query = useQuery<number | null>({
    queryKey: ['recentWeeklyMiles', userId],
    enabled: !!userId,
    queryFn: async () => {
      const today = todayIso();
      const since = isoDaysAgo(today, RECENT_WINDOW_DAYS);
      const { data, error } = await supabase
        .from('activities')
        .select('local_date, distance_meters')
        .gte('local_date', since);
      if (error) throw error;
      return weeklyMilesFromRows((data ?? []) as ActivityMileageRow[], today);
    },
  });
  return { weeklyMiles: query.data ?? null, isLoading: query.isLoading };
}
