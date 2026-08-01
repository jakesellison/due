-- 0011_activity_photos.sql — photos attached to individual activities.
--
-- Activity photos are user-owned attachments for a run: shoe-on-feet shots,
-- finish-line photos, route/context images, etc. Storage path convention:
-- `activity-photos/<user_id>/<activity_id>/<random>.jpg`.

create table if not exists public.activity_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  activity_id uuid not null references public.activities(id) on delete cascade,
  storage_path text not null,
  caption text,
  created_at timestamptz not null default now()
);

alter table public.activity_photos enable row level security;

drop policy if exists activity_photos_all on public.activity_photos;
create policy activity_photos_all on public.activity_photos for all
  using (public.auth_can_read_user(user_id)) with check (public.auth_can_read_user(user_id));

create index if not exists idx_activity_photos_activity on public.activity_photos (activity_id, created_at desc);
create index if not exists idx_activity_photos_user on public.activity_photos (user_id, created_at desc);

-- Guard against attaching a photo row to someone else's activity even if the
-- caller guesses an activity UUID. The app supplies user_id explicitly so RLS
-- can stay simple and fast.
create or replace function public.ensure_activity_photo_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.activities a
    where a.id = new.activity_id and a.user_id = new.user_id
  ) then
    raise exception 'activity photo must belong to the same user as the activity';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_activity_photo_owner on public.activity_photos;
create trigger trg_activity_photo_owner
  before insert or update on public.activity_photos
  for each row execute function public.ensure_activity_photo_owner();

-- PRIVATE bucket: run photos are personal. Reads go through time-limited signed
-- URLs (createSignedUrl), governed by the owner-only storage.objects policies
-- below — never a public/guessable URL. `on conflict do update` flips an
-- already-created bucket to private on re-run.
insert into storage.buckets (id, name, public)
  values ('activity-photos', 'activity-photos', false)
  on conflict (id) do update set public = false;

drop policy if exists activity_photos_storage_select on storage.objects;
create policy activity_photos_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'activity-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists activity_photos_storage_insert on storage.objects;
create policy activity_photos_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'activity-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists activity_photos_storage_update on storage.objects;
create policy activity_photos_storage_update on storage.objects for update to authenticated
  using (bucket_id = 'activity-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists activity_photos_storage_delete on storage.objects;
create policy activity_photos_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'activity-photos' and (storage.foldername(name))[1] = auth.uid()::text);
