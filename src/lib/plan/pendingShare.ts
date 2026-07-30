/**
 * Hand a shared plan's TEXT from the share-intent gate to the install screen
 * in-memory (a plan is too large for a URL param). Take-once: reading clears it
 * so a stale share can't re-fire on the next navigation.
 */
let pending: string | null = null;

export function setPendingPlanText(text: string): void {
  pending = text;
}

export function takePendingPlanText(): string | null {
  const t = pending;
  pending = null;
  return t;
}
