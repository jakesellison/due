/**
 * importPrompt.test.ts — Drift guard between the copy-paste AI prompts and the
 * parser. The FORMAT block is the format's public documentation; if its example
 * stops parsing, or date language creeps back in, users get import errors. This
 * test parses the FORMAT example verbatim through the real `parsePlanImport`.
 */

import {
  DUE_PLAN_FORMAT,
  PLAN_IMPORT_PROMPT,
  PLAN_DESIGN_PROMPT,
} from '../importPrompt';
import {
  parsePlanImport,
} from '../parseImport';

/**
 * Pull the JSON example out of the FORMAT block: drop the "DUE PLAN FORMAT" header
 * and everything from the RULES prose on, then strip `// …` line comments so the
 * documented example becomes a parseable fixture.
 */
function fixtureFromFormat(): string {
  const afterHeader = DUE_PLAN_FORMAT.slice(DUE_PLAN_FORMAT.indexOf('{'));
  const jsonOnly = afterHeader.slice(0, afterHeader.lastIndexOf('}') + 1);
  return jsonOnly.replace(/\/\/.*$/gm, '');
}

describe('DUE_PLAN_FORMAT drift guard', () => {
  it('documents formatVersion', () => {
    expect(DUE_PLAN_FORMAT).toContain('formatVersion');
    expect(DUE_PLAN_FORMAT).toContain('speed_fraction');
    expect(DUE_PLAN_FORMAT).toContain('fast_s_per_km');
    expect(DUE_PLAN_FORMAT).not.toContain('pace_label');
    expect(DUE_PLAN_FORMAT).not.toContain('pace_min_s_per_km');
  });

  it('carries no calendar dates or legacy date fields', () => {
    expect(DUE_PLAN_FORMAT).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(DUE_PLAN_FORMAT).not.toMatch(/startDate/);
    expect(DUE_PLAN_FORMAT).not.toMatch(/raceDate/);
  });

  it('the documented example is valid v3 JSON the parser accepts', () => {
    const sample = fixtureFromFormat();
    const plan = parsePlanImport(sample);

    expect(plan.formatVersion).toBe(3);
    expect(plan.plan.numWeeks).toBe(18);
    expect(plan.plan.distanceKind).toBe('marathon');

    const first = plan.workouts[0]!;
    expect(first.week).toBe(1);
    expect(first.day).toBe(0);
    expect(first.type).toBe('easy');
    expect(first.plannedDistanceMeters).toBe(8047);

    // The pace-band example segment round-trips through normalizeStructure.
    const repeat = first.structure.find((s) => s.kind === 'repeat');
    expect(repeat).toBeDefined();
  });
});

describe('prompts stay date-free', () => {
  it('neither prompt emits calendar-date instructions', () => {
    for (const prompt of [PLAN_IMPORT_PROMPT, PLAN_DESIGN_PROMPT]) {
      expect(prompt).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(prompt).not.toMatch(/startDate/);
      expect(prompt).not.toMatch(/raceDate/);
    }
  });
});
