-- Starter-shelf installs carry their own provenance.
alter table public.plans drop constraint if exists plans_created_via_check;
alter table public.plans add constraint plans_created_via_check
  check (created_via in ('import','generated','conversation','starter'));
