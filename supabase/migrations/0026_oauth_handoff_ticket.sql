-- 0026_oauth_handoff_ticket.sql — close the handoff RELAY (overnight audit, high).
--
-- 0025 bound the sign-in flow to the device that STARTED it, which closes the
-- direction it was written for: a callback crafted by an attacker deposits its
-- token against the attacker's own row, so a victim's app never claims it.
--
-- The REVERSE direction stayed open, because possession of the handoff was the
-- sole credential and nothing proved who actually consented:
--   1. attacker calls POST /api/strava/auth themselves, keeps {authUrl, handoff},
--   2. sends authUrl to the victim — a genuine strava.com consent link with a
--      valid signed state, not a spoofed page,
--   3. victim consents; the callback resolves the VICTIM's athlete id and
--      deposits the VICTIM's magic-link token against the attacker's handoff,
--   4. attacker polls the claim endpoint and receives a full session for the
--      victim's account. The victim just sees a failed sign-in.
--
-- THE FIX: a second secret minted by the CALLBACK and returned only on the
-- `duerunning://strava-auth?ticket=…` deep link — i.e. to whichever device
-- actually completed the consent. A claim must now present BOTH the handoff and
-- the matching ticket. A relayed flow then fails on both sides: the attacker
-- holds the handoff but never sees the ticket (it went to the victim's device),
-- and the victim holds the ticket but no handoff. A legitimate flow holds both,
-- because the same device started it and received the redirect.
--
-- The ticket is safe to put in the deep-link URL: it is not a session token, it
-- is useless without the handoff, and it is single-use.
alter table public.oauth_handoffs
  add column if not exists ticket_hash text;

comment on column public.oauth_handoffs.ticket_hash is
  'sha256 of the callback-minted ticket; the claim must present the matching secret alongside the handoff. Null until the callback deposits.';

-- RLS posture is unchanged from 0025: enabled, ZERO policies, service-role only.
-- Do not add policies here.
