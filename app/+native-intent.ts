/**
 * Routes incoming system URLs for expo-router. A `.due` plan file opened in or
 * shared to Due (via the registered document type) arrives as a `file://` URL —
 * send it to the import screen with the file URI as `src`, and the screen reads,
 * validates, and previews it. Everything else routes normally.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    const clean = path.split('?')[0]!.split('#')[0]!;
    if (clean.toLowerCase().endsWith('.due')) {
      return `/plans/install?src=${encodeURIComponent(path)}`;
    }
  } catch {
    /* malformed — fall through to default routing */
  }
  return path;
}
