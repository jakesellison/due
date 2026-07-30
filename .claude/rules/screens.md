---
paths: ["app/**", "src/components/**"]
---
# Screens & components

- Use the primitives (Phase 3): ActionButton, GhostButton, Segmented, ListRow,
  Eyebrow, Stat, Divider. Never hand-roll an equivalent — the ratchet has a
  ZERO baseline here.
- Buttons are FLAT. No lip, shadow, gradient, or bevel on any control.
- Never re-derive a registered fact (checks/facts.registry.json) from raw
  fields — call its deriver. If the fact isn't registered yet and you derive it
  on two surfaces, register it now.
- Clean route shapes win; record renames from the old app in MISSING.md §4.
- Copy law: labels + numbers, never narrated status sentences.
