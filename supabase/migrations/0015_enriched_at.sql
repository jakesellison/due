-- Stamped every time a detail-fetch enrich attempt completes (streams present
-- or not — the ATTEMPT is what's recorded), so the backfill enrich predicate
-- (api/strava/backfill.ts runEnrich) can tell "never attempted" apart from
-- "attempted, streams still absent" (manual entries, devices with no streams,
-- Strava 404s) and terminate instead of refetching the same rows forever.
alter table public.activities add column if not exists enriched_at timestamptz;

-- One-time stamp for rows enriched BEFORE this column existed: anything that
-- already carries a quality verdict has demonstrably been through the new
-- enrich pipeline. Without this, every pre-existing enriched row would burn
-- one wasteful (though terminating) re-enrich pass. Idempotent.
update public.activities
set enriched_at = now()
where enriched_at is null
  and stream_summary->'quality' is not null;
