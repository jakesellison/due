---
paths: ["src/app-lib/**", "src/server/**", "api/**"]
---
# IO layer

- The data layer is a HARD CONTRACT: Supabase schema, Strava webhook shapes,
  Cloud Run API routes, the `duerunning` scheme. Changing any of these needs an
  ADR and a matching old-repo check — nothing here is "reference only".
- Derivation logic goes in src/lib (pure, node-tested); this layer fetches,
  caches, and adapts. If a hook contains math, extract it down.
- Query hooks that derive domain facts register them in
  checks/facts.registry.json.
