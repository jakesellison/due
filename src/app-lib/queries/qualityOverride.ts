import { useMutation, useQueryClient } from '@tanstack/react-query';

import { supabase } from '../supabase';
import type { ActivityRow } from './rows';
import type { QualityOverride } from '../../lib/kpi/resolveQuality';

/**
 * Persist (or clear) the runner's pinned interpretation for one activity — the
 * run-detail granularity slider / "not a workout" / "match plan" choice. Writes
 * `activities.quality_override` (null clears it, back to the computed default).
 *
 * Optimistically patches the cached detail row so the run-detail reflects the
 * choice immediately, then invalidates the detail + activities-list caches so
 * every credit read (weekly mileage, goals, day panel) re-resolves through
 * resolveQuality with the new override.
 */
export function useSetQualityOverride(activityId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (override: QualityOverride | null) => {
      if (!activityId) return;
      const { error } = await supabase
        .from('activities')
        .update({ quality_override: override })
        .eq('id', activityId);
      if (error) throw error;
    },
    onMutate: (override) => {
      if (!activityId) return;
      qc.setQueryData<ActivityRow | null>(['activity', activityId], (prev) =>
        prev ? { ...prev, quality_override: override } : prev,
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['activity', activityId] });
      qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}
