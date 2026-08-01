-- Expo push tokens per user/device, for the "run banked" push notification.
-- One row per (user, token) — multi-device supported. Written by the client on
-- opt-in (You-screen toggle / after Strava connect); read by the ingest webhook
-- via the service-role admin client (bypasses RLS) to send the push.
--
-- RLS is OWNER-ONLY (auth.uid() = user_id) rather than the plan-shareable
-- auth_can_read_user() helper the other user-scoped tables use: a device push
-- token is sensitive and must never be visible to plan members.
create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, token)
);
create index if not exists push_tokens_user_idx on public.push_tokens(user_id);

alter table public.push_tokens enable row level security;

drop policy if exists push_tokens_select on public.push_tokens;
create policy push_tokens_select on public.push_tokens
  for select using (auth.uid() = user_id);
drop policy if exists push_tokens_insert on public.push_tokens;
create policy push_tokens_insert on public.push_tokens
  for insert with check (auth.uid() = user_id);
drop policy if exists push_tokens_update on public.push_tokens;
create policy push_tokens_update on public.push_tokens
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists push_tokens_delete on public.push_tokens;
create policy push_tokens_delete on public.push_tokens
  for delete using (auth.uid() = user_id);

-- Idempotency guard for the ingest push: stamped when a run's "banked" push is
-- sent, so an `update` webhook re-running ingest never double-fires.
alter table public.activities add column if not exists push_sent_at timestamptz;
