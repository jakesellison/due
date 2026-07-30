/**
 * bankedCard.ts — per-user persistence for the Dash "just banked" card.
 *
 * Stores the start-instant of the most recent banked run the user has
 * acknowledged (tapped through / viewed), so the celebration card fires once
 * per new run and quiets after it's seen — surviving app relaunches. Same
 * AsyncStorage-per-concern pattern as the quality-override / dismissal /
 * interrupted-mode helpers (there is no central store to extend).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

function lastSeenBankedKey(userId: string): string {
  return `banked-seen-${userId}`;
}

/** The start-instant (UTC ISO) of the newest run the user has acknowledged, if any. */
export async function getLastSeenBanked(userId: string): Promise<string | null> {
  return AsyncStorage.getItem(lastSeenBankedKey(userId));
}

/** Record that the user has seen the run banked at `startIso` — the card quiets for it. */
export async function setLastSeenBanked(userId: string, startIso: string): Promise<void> {
  await AsyncStorage.setItem(lastSeenBankedKey(userId), startIso);
}
