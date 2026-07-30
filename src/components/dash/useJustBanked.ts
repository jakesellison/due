/**
 * useJustBanked — resolve the Dash "just banked" celebration card's state.
 *
 * Picks the newest banked run, shows the card while it's RECENT (≤48h) and
 * UNSEEN (start instant newer than the last acknowledged one, read from
 * AsyncStorage), and exposes `acknowledge()` — called when the runner taps
 * through to the run — which records it as seen so the card quiets and won't
 * re-fire on the next Dash visit. A genuinely newer run re-arms it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { getLastSeenBanked, setLastSeenBanked } from '@/app-lib/bankedCard';
import {
  describeBanked,
  isRecentlyBanked,
  pickNewestBanked,
  type BankableActivity,
  type BankedInfo,
} from '@/lib/kpi/justBanked';

export function useJustBanked(
  userId: string | null,
  activities: BankableActivity[] | undefined,
  longTargetMeters: number,
): { banked: BankedInfo | null; acknowledge: () => void } {
  // The last acknowledged run's start instant (null until AsyncStorage loads,
  // or never acknowledged). `loaded` gates the card so it doesn't flash before
  // we know whether the newest run was already seen.
  const [seenIso, setSeenIso] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!userId) {
      setLoaded(false);
      setSeenIso(null);
      return;
    }
    let alive = true;
    setLoaded(false);
    getLastSeenBanked(userId).then((v) => {
      if (!alive) return;
      setSeenIso(v);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [userId]);

  const candidate = useMemo(() => pickNewestBanked(activities ?? []), [activities]);

  const isNew =
    loaded &&
    candidate?.start_date != null &&
    isRecentlyBanked(candidate.start_date, Date.now()) &&
    (seenIso == null || candidate.start_date > seenIso);

  const acknowledge = useCallback(() => {
    if (!userId || !candidate?.start_date) return;
    setSeenIso(candidate.start_date); // quiet immediately (before AsyncStorage round-trips)
    void setLastSeenBanked(userId, candidate.start_date);
  }, [userId, candidate]);

  const banked = useMemo(
    () => (isNew && candidate ? describeBanked(candidate, longTargetMeters) : null),
    [isNew, candidate, longTargetMeters],
  );

  return { banked, acknowledge };
}
