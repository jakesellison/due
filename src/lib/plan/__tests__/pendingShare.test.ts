import {
  setPendingPlanText,
  takePendingPlanText,
} from '../pendingShare';

describe('pendingShare', () => {
  it('returns null when nothing is pending', () => {
    expect(takePendingPlanText()).toBeNull();
  });

  it('returns the set text once, then clears', () => {
    setPendingPlanText('hello plan');
    expect(takePendingPlanText()).toBe('hello plan');
    expect(takePendingPlanText()).toBeNull(); // take-once
  });

  it('keeps only the most recent set', () => {
    setPendingPlanText('first');
    setPendingPlanText('second');
    expect(takePendingPlanText()).toBe('second');
  });
});
