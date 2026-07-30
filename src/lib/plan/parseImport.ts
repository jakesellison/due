import {
  extractPlanJson,
} from './extractPlanJson';
import {
  normalizeRelativePlan,
  type RelativePlan,
} from './relative';

/** A user-facing import failure — `.message` is safe to show in the UI. */
export class PlanImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanImportError';
  }
}

/**
 * Hard cap on the text handed to the parser.
 *
 * `.due` content arrives from OUTSIDE the app — a file the user picked, a
 * document shared in from another app, or a paste — and every route ends in
 * `JSON.parse` plus a brace-scan, both of which materialize the whole input.
 * Without a bound, opening a large file simply crashes the app. The largest
 * legitimate plan (the 53-week / 1200-workout ceiling `normalizeRelativePlan`
 * enforces) is well under 1 MB even with prose wrapped around it, so 2 MB is
 * generous and still far below anything that would exhaust memory.
 */
export const MAX_PLAN_TEXT_BYTES = 2 * 1024 * 1024;

/** Human-readable form of the cap, for UI messages. */
export const MAX_PLAN_TEXT_LABEL = '2 MB';

/**
 * Parse a `.due` / pasted plan (JSON text) into a relative (dateless) plan. The
 * single ingest entry for every route — file open-in / share-to / pick, and paste.
 *
 * This wrapper handles the text-shaped failures (oversized input, empty input,
 * bad JSON, not a JSON object) and then delegates to `normalizeRelativePlan`,
 * which is the GATE + lenient normalizer for the `.due` v3 format: it throws a
 * friendly `PlanImportError` on anything that isn't a real v3 plan (bad week
 * range, no workouts, and so on) and otherwise fills defaults. The screen shows
 * the error's message instead of installing a bad plan.
 *
 * The size check is FIRST and measured in UTF-16 code units — cheap, and it
 * bounds the work every later step does. Callers that can cheaply learn a
 * file's size should also check before reading it (see `app/plans/install.tsx`),
 * so a huge file is never loaded at all; this is the backstop that covers paste
 * and share-in, where no size is known up front.
 */
export function parsePlanImport(text: string): RelativePlan {
  const source = text ?? '';
  if (source.length > MAX_PLAN_TEXT_BYTES) {
    throw new PlanImportError(
      `That file is too large to be a training plan (limit ${MAX_PLAN_TEXT_LABEL}). Re-run the import prompt and import just the plan JSON.`,
    );
  }

  const trimmed = source.trim();
  if (!trimmed) throw new PlanImportError('Nothing to import — paste or open a plan file first.');

  const candidate = extractPlanJson(trimmed).trim();

  let raw: unknown;
  try {
    raw = JSON.parse(candidate);
  } catch {
    throw new PlanImportError(
      "That doesn’t look like valid plan JSON. Copy the import prompt, run it in your AI, and import the result.",
    );
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new PlanImportError('The plan should be a JSON object. Re-run the import prompt and try again.');
  }

  return normalizeRelativePlan(raw);
}
