-- 0002_activity_enrichment.sql — Trends-screen data enrichment columns on activities.
-- Idempotent / re-runnable: add column if not exists.
--
--   avg_temp_c   — average temperature in Celsius for the activity (from Strava
--                  average_temp, or backfilled via open-meteo archive). numeric.
--   best_efforts — Strava-style best-effort segments for this activity. jsonb,
--                  shape: array of
--                    { name: '1k'|'1 mile'|'5k'|'10k'|...,
--                      distance_m: number,
--                      elapsed_s: number,
--                      start_date: iso }

alter table public.activities add column if not exists avg_temp_c numeric;
alter table public.activities add column if not exists best_efforts jsonb;
