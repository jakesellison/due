-- 0009_shoes.sql — shoe (gear) tracking.
--
-- A shoe belongs to one user, optionally wears a photo (storage bucket
-- `shoe-photos`, path `<user_id>/<shoe_id>.jpg`), and accumulates mileage as
-- the sum of the activities assigned to it plus `starting_meters` (miles
-- already on the shoe when it was added). One shoe per user may be the
-- default: a BEFORE INSERT trigger on activities assigns it whenever an
-- incoming row (Strava webhook, backfill, manual entry) carries no shoe, so
-- every insert path gets auto-assignment without app-side duplication. The
-- per-run shoe can then be reassigned from the run screen.
--
-- Idempotent / re-runnable, owner-only RLS via auth_can_read_user — same
-- shape as routes (0007).

create table if not exists public.shoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  photo_path text,                       -- storage path in `shoe-photos`, null = no photo
  starting_meters integer not null default 0,
  is_default boolean not null default false,
  retired_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.shoes enable row level security;

drop policy if exists shoes_all on public.shoes;
create policy shoes_all on public.shoes for all
  using (public.auth_can_read_user(user_id)) with check (public.auth_can_read_user(user_id));

create index if not exists idx_shoes_user on public.shoes (user_id, created_at);

-- At most one live default per user (clear the old default before setting a new one).
create unique index if not exists idx_shoes_one_default
  on public.shoes (user_id) where (is_default and retired_at is null);

-- The per-run assignment. SET NULL so deleting a shoe never deletes runs.
alter table public.activities
  add column if not exists shoe_id uuid references public.shoes(id) on delete set null;

create index if not exists idx_activities_shoe on public.activities (shoe_id);

-- Auto-assign the user's live default shoe to any inserted activity that has
-- none. SECURITY DEFINER + pinned search_path: the webhook inserts via the
-- service role and users insert under RLS; both must see the shoes row.
create or replace function public.assign_default_shoe()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.shoe_id is null then
    select id into new.shoe_id
      from public.shoes
      where user_id = new.user_id and is_default and retired_at is null
      limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_default_shoe on public.activities;
create trigger trg_assign_default_shoe
  before insert on public.activities
  for each row execute function public.assign_default_shoe();

-- A user's first live shoe becomes the default automatically (no client-side
-- "is the list empty?" guess — every insert path converges on one default).
create or replace function public.ensure_default_shoe()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.retired_at is null and not new.is_default and not exists (
    select 1 from public.shoes
    where user_id = new.user_id and is_default and retired_at is null
  ) then
    new.is_default := true;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ensure_default_shoe on public.shoes;
create trigger trg_ensure_default_shoe
  before insert on public.shoes
  for each row execute function public.ensure_default_shoe();

-- Mileage ledger: starting miles + assigned-run sum. security_invoker so the
-- querying user's RLS on shoes/activities applies.
create or replace view public.shoe_mileage
with (security_invoker = on) as
select
  s.id as shoe_id,
  (s.starting_meters + coalesce(sum(a.distance_meters), 0))::integer as total_meters,
  count(a.id)::integer as activity_count
from public.shoes s
left join public.activities a on a.shoe_id = s.id
group by s.id;

-- Photo storage: public-read bucket; writes restricted to the owner's folder
-- (path convention `<user_id>/<shoe_id>.jpg`).
insert into storage.buckets (id, name, public)
  values ('shoe-photos', 'shoe-photos', true)
  on conflict (id) do nothing;

drop policy if exists shoe_photos_select on storage.objects;
create policy shoe_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'shoe-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists shoe_photos_insert on storage.objects;
create policy shoe_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'shoe-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists shoe_photos_update on storage.objects;
create policy shoe_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'shoe-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists shoe_photos_delete on storage.objects;
create policy shoe_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'shoe-photos' and (storage.foldername(name))[1] = auth.uid()::text);
