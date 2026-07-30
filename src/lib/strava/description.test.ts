import {
  buildDescriptionBlock,
  mergeDescription,
  DUE_MARK,
} from './description';

describe('buildDescriptionBlock', () => {
  it('leads with the run outcome, then weekly mileage and supporting contracts', () => {
    const block = buildDescriptionBlock({
      weekNumber: 10,
      totalWeeks: 23,
      phase: 'build',
      allocation: { label: 'Quality day', actualMi: 14, targetMi: 17 },
      pillars: {
        mileage: { actualMi: 36, targetMi: 50 },
        quality: { actualMi: 6, targetMi: 12 },
        long: { actualMi: 14, targetMi: 14 },
      },
    });
    const lines = block.split('\n');
    expect(lines[0]).toBe('Quality day · 14/17 mi');
    expect(lines[1]).toBe('Due 10/23 · Build · 36/50 mi');
    expect(lines[2]).toBe('');
    expect(lines[3]).toBe('🟨🟨🟨🟨⬛ 36/50 mi mileage');
    expect(lines[4]).toBe('🟪 6/12 mi quality');
    expect(lines[5]).toBe('🟦 14/14 mi long run');
    expect(lines[6]).toBe('');
    expect(lines[lines.length - 1]).toBe('due.run');
  });

  it('fills the mileage geometry toward Due’s earned contract gate', () => {
    const block = buildDescriptionBlock({
      weekNumber: 1,
      totalWeeks: 1,
      pillars: { mileage: { actualMi: 25, targetMi: 50 } },
    });
    expect(block).toContain('🟨🟨🟨⬛⬛ 25/50 mi mileage');
  });

  it('renders an easy run as a neutral actual/plan ledger', () => {
    const block = buildDescriptionBlock({
      weekNumber: 11,
      totalWeeks: 23,
      allocation: { label: 'Easy run', actualMi: 15.04, targetMi: 15 },
      pillars: { mileage: { actualMi: 78.2, targetMi: 100 } },
    });
    expect(block.split('\n').slice(0, 2)).toEqual([
      'Easy run · 15/15 mi',
      'Due 11/23 · 78.2/100 mi',
    ]);
  });

  it('shows an over-target allocation without moralizing it', () => {
    const block = buildDescriptionBlock({
      weekNumber: 10,
      totalWeeks: 23,
      allocation: { label: 'Easy run', actualMi: 18, targetMi: 16 },
      pillars: { mileage: { actualMi: 94, targetMi: 94 } },
    });
    expect(block).toContain('Easy run · 18/16 mi');
    expect(block).not.toContain('met');
    expect(block).not.toContain('over');
  });

  it('omits a pillar with no target', () => {
    const block = buildDescriptionBlock({ weekNumber: 1, totalWeeks: 1, pillars: { mileage: { actualMi: 10, targetMi: 20 }, quality: { actualMi: 0, targetMi: 0 } } });
    expect(block).not.toContain('quality');
    expect(block).toContain('Due 1/1 · 10/20 mi');
    expect(block).toContain('🟨🟨🟨⬛⬛ 10/20 mi mileage');
  });

  it('rounds noisy floating-point miles to one decimal', () => {
    const block = buildDescriptionBlock({
      weekNumber: 1,
      totalWeeks: 2,
      allocation: { label: 'Easy run', actualMi: 12.00001, targetMi: 14.249 },
      pillars: { mileage: { actualMi: 12.04, targetMi: 50 } },
    });
    expect(block).toContain('Easy run · 12/14.2 mi');
    expect(block).toContain('Due 1/2 · 12/50 mi');
  });
});

describe('mergeDescription', () => {
  const block = buildDescriptionBlock({ weekNumber: 10, totalWeeks: 23, pillars: { mileage: { actualMi: 36, targetMi: 50 } } });

  it('appends below the athlete text when none present', () => {
    expect(mergeDescription('Morning shakeout, legs felt great.', block)).toBe(`Morning shakeout, legs felt great.\n\n${block}`);
  });

  it('uses the block alone when the description was empty', () => {
    expect(mergeDescription(null, block)).toBe(block);
    expect(mergeDescription('', block)).toBe(block);
  });

  it('replaces a prior Due block instead of stacking, keeping user text', () => {
    const older = buildDescriptionBlock({ weekNumber: 9, totalWeeks: 23, pillars: { mileage: { actualMi: 20, targetMi: 48 } } });
    const existing = `Tempo on the river path.\n\n${older}`;
    const merged = mergeDescription(existing, block);
    expect(merged).toBe(`Tempo on the river path.\n\n${block}`);
    // exactly one block
    expect(merged.split(DUE_MARK).length - 1).toBe(1);
  });

  it('replaces the outcome line together with its following Due context', () => {
    const older = buildDescriptionBlock({
      weekNumber: 10,
      totalWeeks: 23,
      allocation: { label: 'Easy run', actualMi: 4, targetMi: 15 },
      pillars: { mileage: { actualMi: 67.2, targetMi: 100 } },
    });
    const next = buildDescriptionBlock({
      weekNumber: 10,
      totalWeeks: 23,
      allocation: { label: 'Easy run', actualMi: 15.04, targetMi: 15 },
      pillars: { mileage: { actualMi: 78.2, targetMi: 100 } },
    });
    expect(mergeDescription(older, next)).toBe(next);
    expect(mergeDescription(older, next)).not.toContain('Easy run · 4/15 mi');
  });

  it('replaces the legacy runner-emoji block during rollout', () => {
    const legacy = 'Great run.\n\n🏃 Due · Week 9/23\nMileage 40/50 mi\ndue.run';
    expect(mergeDescription(legacy, block)).toBe(`Great run.\n\n${block}`);
  });

  it('preserves athlete text added after the Due block', () => {
    const existing = `Morning shakeout.\n\n${block}\n\nLegs felt better after the run.`;
    const next = buildDescriptionBlock({ weekNumber: 11, totalWeeks: 23, pillars: { mileage: { actualMi: 42, targetMi: 50 } } });
    expect(mergeDescription(existing, next)).toBe(
      `Morning shakeout.\n\n${next}\n\nLegs felt better after the run.`,
    );
  });
});
