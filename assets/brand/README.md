# Due brand assets

Yellow-on-ink identity (whistle-`d` mark). The canonical source is the brand kit
(`due-brand-kit`, "Yellow on Ink"): `#FFC93C` yellow on `#12101F` ink tile.

## In-app (preferred: inline SVG, crisp + recolourable)
- `src/components/DueMark.tsx` — the bare whistle-`d` mark, one flat colour.
- `src/components/DueWordmark.tsx` — the two-tone wordmark (yellow `d` + ink/white
  `ue`) for branded editorial surfaces. Auth and launch use the standalone
  mark. Never set "due" in a typeface beside the mark — the mark IS the `d`.

## Native raster assets (baked at prebuild)
- `due-app-icon.png` — 1024² App Store / home-screen icon (ink tile + yellow mark,
  no alpha). Referenced by `app.json` → `expo.icon`.
- `due-splash-mark.png` — transparent yellow mark for the splash, shown on the
  app's `#0F0F12` canvas. Referenced by the `expo-splash-screen` plugin config.

Changing `app.json` requires `expo prebuild` to update the native `ios/` asset
catalog (the repo keeps a generated native project; it's gitignored).

## Strava
`strava/` holds the official, unmodified "Connect with Strava" / "Powered by
Strava" brand assets — required attribution, never recoloured.
