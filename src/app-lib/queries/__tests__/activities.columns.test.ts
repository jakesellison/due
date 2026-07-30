jest.mock('../../supabase', () => ({ supabase: { from: jest.fn() } }));

import { ACTIVITY_LIST_COLUMNS, ACTIVITY_DETAIL_COLUMNS } from '../activities';

const cols = (s: string) => s.split(',').map((c) => c.trim());

describe('activity column sets (egress guard)', () => {
  it('the LIST set never ships raw streams/route/laps', () => {
    const list = cols(ACTIVITY_LIST_COLUMNS);
    expect(list).not.toContain('streams');
    expect(list).not.toContain('route');
    expect(list).not.toContain('laps');
    expect(list).toContain('stream_summary');
    expect(list).toContain('best_efforts');
  });
  it('the DETAIL set adds streams/route/laps on top of the list set', () => {
    const detail = cols(ACTIVITY_DETAIL_COLUMNS);
    for (const c of cols(ACTIVITY_LIST_COLUMNS)) expect(detail).toContain(c);
    expect(detail).toContain('streams');
    expect(detail).toContain('route');
    expect(detail).toContain('laps');
  });
});
