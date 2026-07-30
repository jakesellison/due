import type { RunStreams } from '@/lib';

/** A run stream is usable for charting only when it has aligned t + v samples. */
export function hasUsableStreams(s: RunStreams | null | undefined): s is RunStreams {
  return (
    !!s &&
    Array.isArray(s.t) &&
    Array.isArray(s.v) &&
    s.t.length >= 3 &&
    s.v.length >= 3
  );
}
