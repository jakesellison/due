import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useShareIntent } from 'expo-share-intent';

import { setPendingPlanText } from '@/lib/plan/pendingShare';

/**
 * Bridges an incoming iOS/Android share into the plan-import flow. A shared FILE
 * reuses the existing `?src=` file-URI path the install screen already reads; a
 * shared TEXT payload is stashed in-memory (too big for a URL param) and the
 * screen picks it up on mount. Renders nothing.
 */
export function ShareIntentGate(): null {
  const router = useRouter();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();

  useEffect(() => {
    if (!hasShareIntent) return;

    const file = shareIntent?.files?.[0];
    if (file?.path) {
      router.navigate({ pathname: '/plans/install', params: { src: file.path } });
      resetShareIntent();
      return;
    }

    const text = shareIntent?.text;
    if (typeof text === 'string' && text.trim().length > 0) {
      setPendingPlanText(text);
      router.navigate('/plans/install');
      resetShareIntent();
      return;
    }

    resetShareIntent(); // nothing usable — clear so it can't re-fire
  }, [hasShareIntent, shareIntent, resetShareIntent, router]);

  return null;
}
