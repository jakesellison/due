-- Precomputed, small per-activity summaries so list/corpus queries never load
-- raw streams. Shape:
--   { "pace_curve": [ { "distanceMeters": n, "paceSecPerKm": n, "speed": n, "coarse": bool } ],
--     "early_miles": { "m1": { "paceSecPerKm": n, "avgHr": n|null }|null,
--                      "m2": { "paceSecPerKm": n, "avgHr": n|null }|null } | null }
-- Computed at ingest from the full-resolution stream (see src/server/streams.ts
-- computeStreamSummary). Null until an activity is (re-)enriched.
alter table public.activities add column if not exists stream_summary jsonb;
