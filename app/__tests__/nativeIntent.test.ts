import { redirectSystemPath } from '../+native-intent';

describe('redirectSystemPath', () => {
  it('routes an opened .due file to the import screen with the uri as src', () => {
    const path = 'file:///var/mobile/Containers/.../Inbox/plan.due';
    expect(redirectSystemPath({ path, initial: true })).toBe(`/plans/install?src=${encodeURIComponent(path)}`);
  });

  it('ignores case and a trailing query/fragment on the .due url', () => {
    expect(redirectSystemPath({ path: 'file:///x/PLAN.DUE?v=1', initial: true })).toContain('/plans/install?src=');
    expect(redirectSystemPath({ path: 'file:///x/p.due#frag', initial: false })).toContain('/plans/install?src=');
  });

  it('passes non-.due paths through unchanged', () => {
    expect(redirectSystemPath({ path: '/plan', initial: false })).toBe('/plan');
    expect(redirectSystemPath({ path: 'duerunning://plans/install', initial: true })).toBe('duerunning://plans/install');
    expect(redirectSystemPath({ path: 'file:///x/notes.txt', initial: true })).toBe('file:///x/notes.txt');
  });
});
