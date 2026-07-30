import {
  extractPlanJson,
} from '../extractPlanJson';

describe('extractPlanJson', () => {
  it('returns raw JSON object text unchanged', () => {
    const s = '{"plan":{"raceName":"X"},"workouts":[]}';
    expect(extractPlanJson(s)).toBe(s);
  });

  it('pulls JSON out of a ```json fenced block', () => {
    const inner = '{"plan":{"raceName":"X"}}';
    const blob = 'Here is your plan:\n```json\n' + inner + '\n```\nEnjoy!';
    expect(extractPlanJson(blob).trim()).toBe(inner);
  });

  it('pulls JSON out of a plain ``` fenced block', () => {
    const inner = '{"a":1}';
    const blob = 'sure:\n```\n' + inner + '\n```';
    expect(extractPlanJson(blob).trim()).toBe(inner);
  });

  it('pulls a balanced object out of surrounding prose', () => {
    const inner = '{"plan":{"raceName":"X"},"workouts":[{"date":"2026-06-08"}]}';
    expect(extractPlanJson('Plan below: ' + inner + ' — good luck!')).toBe(inner);
  });

  it('handles braces inside JSON string values', () => {
    const inner = '{"notes":"do 3x { hard } reps","n":2}';
    expect(extractPlanJson('note: ' + inner + ' end')).toBe(inner);
  });

  it('returns input unchanged when there is no JSON object', () => {
    expect(extractPlanJson('not json {')).toBe('not json {'); // unbalanced → unchanged
    expect(extractPlanJson('[1,2,3]')).toBe('[1,2,3]');       // array, not object → unchanged
    expect(extractPlanJson('42')).toBe('42');
  });
});
