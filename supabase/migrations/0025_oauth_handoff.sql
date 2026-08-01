-- 0025_oauth_handoff.sql — device-bound handoff for Strava sign-in.
--
-- WHY (security audit P1, login-CSRF / session fixation):
-- The sign-in callback used to hand the freshly-minted magic-link token back to
-- the app by putting it directly in the `duerunning://strava-auth?token_hash=…`
-- deep link. Combined with an OAuth `state` that was a CONSTANT for every
-- sign-in (a deterministic HMAC of the literal 'signin'), that meant an attacker
-- could:
--   1. run the sign-in flow once and read the permanently-valid signed state,
--   2. obtain an authorization `code` for their OWN Strava account,
--   3. craft `…/api/strava/callback?code=<theirs>&state=<the constant>` and get
--      a victim to open it — whereupon the victim's app received the ATTACKER's
--      token and silently signed in as them.
--
-- The fix binds the flow to the DEVICE that started it. `POST /api/strava/auth`
-- mints a random `handoff` secret, returns it to that app instance only, and
-- signs its HASH into the state. The callback stores the minted token against
-- that hash instead of putting it in the URL; the app then CLAIMS it by
-- presenting the handoff it holds. An attacker-crafted callback deposits its
-- token against the attacker's own row, which the victim's app never claims.
--
-- Only the HASH is stored, so a read of this table yields nothing claimable.
create table if not exists public.oauth_handoffs (
  -- sha256(handoff) hex. The handoff secret itself is never persisted.
  handoff_hash  text primary key,
  provider      text not null default 'strava',
  -- 'signin' | 'link'. Recorded so a link-flow row can never satisfy a
  -- sign-in claim (a link row never receives a token_hash at all).
  mode          text not null check (mode in ('signin', 'link')),
  -- The one-time Supabase magic-link token, written by the callback on success.
  -- Null until then, and nulled again the moment it is claimed.
  token_hash    text,
  claimed_at    timestamptz,
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now()
);

-- Expiry sweep (the claim path also deletes opportunistically).
create index if not exists oauth_handoffs_expires_at_idx
  on public.oauth_handoffs (expires_at);

-- RLS on, ZERO policies — same posture as `integration_connections`. This table
-- holds sign-in material, so it must be unreachable by the anon/authenticated
-- roles; only the service role (which bypasses RLS) may touch it. Intentionally
-- no policies: do not add any.
alter table public.oauth_handoffs enable row level security;
