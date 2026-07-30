import { Redirect } from 'expo-router';

/**
 * Alias for the Dash (home) tab. `duerunning://dash` is a natural deep-link
 * target (matches the tab's name), but the tabs group's Dash screen is
 * `app/(tabs)/index.tsx`, which resolves at `/` — group segments never appear
 * in the URL, so there was no literal `/dash` route and the link 404'd while
 * `/plan`, `/trends`, `/you` (real top-level files) resolved fine. This route
 * just redirects `/dash` to the tabs group's default route.
 */
export default function DashAlias() {
  return <Redirect href="/(tabs)" />;
}
