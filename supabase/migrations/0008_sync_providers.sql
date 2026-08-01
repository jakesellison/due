-- 0008_sync_providers.sql — widen sync provider/source enums for direct watch vendors.
--
-- The original schema already had a provider concept, but COROS was not allowed
-- by the CHECK constraints. Keep these constraints text-based for Supabase
-- compatibility and update them in-place.

alter table public.integration_connections
  drop constraint if exists integration_connections_provider_check;

alter table public.integration_connections
  add constraint integration_connections_provider_check
  check (provider in ('strava', 'healthkit', 'garmin', 'coros'));

alter table public.activities
  drop constraint if exists activities_source_check;

alter table public.activities
  add constraint activities_source_check
  check (source in ('strava', 'healthkit', 'garmin', 'coros', 'manual'));
