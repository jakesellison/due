-- Strava API Policy §6.2/§5.5 compliance: raw Strava Data (raw/streams/route/
-- laps/suffer_score) becomes a ≤7-day transient cache (purged by a later
-- scheduled job, not run here). These two columns are OURS — computed once at
-- ingest from the raw payload — so they stay durable across that purge.
-- See docs/superpowers/specs/2026-07-17-strava-7day-compliance-design.md.
alter table public.activities add column if not exists route_simplified jsonb;
alter table public.activities add column if not exists hr_load numeric;

comment on column public.activities.route_simplified is 'Derived ≤50-pt coarse trace (ours) for the Routes matcher; survives the 7-day raw purge.';
comment on column public.activities.hr_load is 'Derived TRIMP training-load (ours); survives the 7-day raw purge.';
