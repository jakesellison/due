-- 0007_routes.sql — the route builder store.
--
-- A MapMyRun-style route the user draws by tapping waypoints on a map. We keep
-- both the raw clicked `points` (the editable waypoints) and the rendered `path`
-- (the snapped/full polyline, when path-snapping was used) so the viewer draws
-- exactly what was saved and the builder can reload the original waypoints to
-- edit. `distance_meters` is the rendered length (snapped path when present,
-- else the straight haversine sum of the points).
--
-- Idempotent / re-runnable: table + policy + index are all create-if-not-exists
-- (policy is drop-then-create). Owner-only RLS, same shape as other user data:
-- `auth_can_read_user(user_id)` for both USING and CHECK.

create table if not exists public.routes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  points jsonb not null,           -- [[lat,lng],...] the clicked waypoints
  path jsonb,                      -- snapped/full polyline [[lat,lng],...] when snapping used
  distance_meters integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.routes enable row level security;

drop policy if exists routes_all on public.routes;
create policy routes_all on public.routes for all
  using (public.auth_can_read_user(user_id)) with check (public.auth_can_read_user(user_id));

create index if not exists idx_routes_user on public.routes (user_id, updated_at desc);
