-- 0003_activity_streams.sql — per-activity STREAMS + route columns on activities.
-- Idempotent / re-runnable: add column if not exists.
--
--   streams — columnar, downsampled time-series for this activity (<=200 samples).
--             jsonb, shape:
--               { "t":  number[]            -- seconds from activity start
--               , "d":  number[]            -- cumulative distance, meters
--               , "v":  number[]            -- velocity, meters/second
--               , "hr": (number|null)[]     -- heart rate, bpm (nulls when absent)
--               , "alt": number[] | null    -- altitude, meters (null when absent)
--               }
--             All arrays share the same length and index alignment as `t`.
--
--   route   — simplified GPS polyline for this activity (<=120 points). jsonb,
--             shape: [[lat, lng], ...] (lat/lng decimal degrees).

alter table public.activities add column if not exists streams jsonb;
alter table public.activities add column if not exists route jsonb;
