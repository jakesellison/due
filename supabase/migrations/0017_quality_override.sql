-- Per-activity user override for the plan-conditioned interpreter's credited
-- reading. Nullable jsonb; absent = use the computed default (matched ?? honest).
-- Shape: { "choice": "candidate" | "plan" | "none", "idx"?: number }
--   - "candidate": credit candidates[idx] (the run-detail granularity-slider position)
--   - "plan":      force the plan-matched read (falls back to honest)
--   - "none":      "not a workout" — suppress quality credit
-- Resolved by src/lib/kpi/resolveQuality.ts (precedence: override ?? matched ?? honest).
-- Written by the run-detail slider (UI Task E); the read wiring lands with it.
alter table public.activities add column if not exists quality_override jsonb;
