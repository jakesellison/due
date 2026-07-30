import {
  MAX_PLAN_TEXT_BYTES,
  parsePlanImport,
  PlanImportError,
} from '../plan/parseImport';
import {
  PLAN_DESIGN_PROMPT,
  PLAN_IMPORT_PROMPT,
} from '../plan/importPrompt';

/** A minimal but valid Due-format (.due v3) relative plan. */
const validPlan = JSON.stringify({
  formatVersion: 3,
  source: 'import',
  plan: { name: 'Test Marathon', distanceKind: 'marathon', numWeeks: 1 },
  weeks: [{ week: 1, phase: 'base', targetMeters: 64374 }],
  workouts: [
    { week: 1, day: 0, type: 'easy', title: 'Easy 5 mi', plannedDistanceMeters: 8047 },
    { week: 1, day: 6, type: 'long', title: 'Long run', plannedDistanceMeters: 24140 },
  ],
});

describe('parsePlanImport', () => {
  it('parses a valid plan into a relative plan', () => {
    const plan = parsePlanImport(validPlan);
    expect(plan.formatVersion).toBe(3);
    expect(plan.plan.name).toBe('Test Marathon');
    expect(plan.plan.distanceKind).toBe('marathon');
    expect(plan.workouts.length).toBe(2);
    expect(plan.workouts.some((w) => w.type === 'long')).toBe(true);
  });

  it('accepts miles as a convenience (normalizer converts to meters)', () => {
    const plan = parsePlanImport(
      JSON.stringify({
        formatVersion: 3,
        plan: { numWeeks: 1 },
        workouts: [{ week: 1, day: 0, type: 'easy', distanceMiles: 5 }],
      }),
    );
    expect(plan.workouts[0]!.plannedDistanceMeters).toBe(Math.round(5 * 1609.344));
  });

  it('rejects a retired dated plan with the v3 migration message', () => {
    const v1 = JSON.stringify({ source: 'import',
      plan: { startDate: '2026-06-08', numWeeks: 1 },
      workouts: [{ date: '2026-06-08', type: 'easy', title: 'Easy 5' }] });
    expect(() => parsePlanImport(v1)).toThrow(/older Due pace format/i);
  });

  it('rejects v2 rather than silently translating legacy pace fields', () => {
    const v2 = JSON.stringify({
      formatVersion: 2,
      plan: { numWeeks: 1 },
      workouts: [{ week: 1, day: 0, type: 'easy', plannedDistanceMeters: 8000 }],
    });
    expect(() => parsePlanImport(v2)).toThrow(/older Due pace format/i);
  });

  it('throws a friendly error on invalid JSON', () => {
    expect(() => parsePlanImport('not json {')).toThrow(PlanImportError);
    expect(() => parsePlanImport('not json {')).toThrow(/valid plan JSON/i);
  });

  it('throws when the JSON is not an object', () => {
    expect(() => parsePlanImport('[1,2,3]')).toThrow(/JSON object/i);
    expect(() => parsePlanImport('42')).toThrow(PlanImportError);
  });

  it('throws when there are no workouts', () => {
    expect(() =>
      parsePlanImport(JSON.stringify({ formatVersion: 3, plan: { numWeeks: 1 }, workouts: [] })),
    ).toThrow(/workouts/i);
  });

  it('throws on empty/whitespace input', () => {
    expect(() => parsePlanImport('   ')).toThrow(/Nothing to import/i);
  });

  // `.due` content comes from outside the app (picked file, shared document,
  // paste) and every route ends in JSON.parse + a brace scan, both of which
  // materialize the whole input. The cap is what keeps a large file from
  // simply crashing the app.
  it('refuses input beyond the size cap before parsing it', () => {
    const huge = 'x'.repeat(MAX_PLAN_TEXT_BYTES + 1);
    expect(() => parsePlanImport(huge)).toThrow(PlanImportError);
    expect(() => parsePlanImport(huge)).toThrow(/too large/i);
  });

  it('still accepts a plan padded right up to the cap', () => {
    // The guard must bound abuse without rejecting a legitimate plan wrapped in
    // a lot of surrounding AI prose.
    const padding = ' '.repeat(MAX_PLAN_TEXT_BYTES - validPlan.length - 1);
    const plan = parsePlanImport(`${padding}${validPlan}`);
    expect(plan.plan.name).toBe('Test Marathon');
  });

  it('parses a plan wrapped in a ```json fenced block', () => {
    const inner = JSON.stringify({
      formatVersion: 3,
      plan: { name: 'Fenced', distanceKind: 'marathon', numWeeks: 1 },
      workouts: [{ week: 1, day: 0, type: 'easy', title: 'Easy 5 mi', plannedDistanceMeters: 8047 }],
    });
    const plan = parsePlanImport('Here is your plan:\n```json\n' + inner + '\n```\nGood luck!');
    expect(plan.plan.name).toBe('Fenced');
    expect(plan.workouts.length).toBe(1);
  });

  it('parses a plan surrounded by prose (no fence)', () => {
    const inner = JSON.stringify({
      formatVersion: 3,
      plan: { name: 'Prose', numWeeks: 1 },
      workouts: [{ week: 1, day: 0, type: 'easy', distanceMiles: 5 }],
    });
    const plan = parsePlanImport('Sure! ' + inner + ' — let me know.');
    expect(plan.plan.name).toBe('Prose');
  });
});

describe('PLAN_IMPORT_PROMPT', () => {
  it('embeds the contract the app validates against', () => {
    for (const token of ['plan.due', 'plannedDistanceMeters', 'formatVersion', 'distanceKind', 'METERS']) {
      expect(PLAN_IMPORT_PROMPT).toContain(token);
    }
    // v3 is dateless: no calendar dates in the contract.
    expect(PLAN_IMPORT_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe('PLAN_DESIGN_PROMPT', () => {
  it('interviews the runner, then embeds the same format contract', () => {
    expect(PLAN_DESIGN_PROMPT).toMatch(/interview|ask/i);
    for (const token of ['plan.due', 'plannedDistanceMeters', 'distanceKind', 'METERS']) {
      expect(PLAN_DESIGN_PROMPT).toContain(token);
    }
  });
});
