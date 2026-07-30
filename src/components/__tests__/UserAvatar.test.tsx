/**
 * UserAvatar: the no-photo fallback should render the user's INITIALS (derived
 * from display name, else email) instead of a generic person glyph, so the
 * Dash top-bar avatar still reads as "you" before a photo exists.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { avatarInitials, UserAvatar } from '../UserAvatar';
import type { UserProfile } from '@/app-lib/auth';
import { ThemeProvider } from '@/theme/ThemeProvider';

function profile(overrides: Partial<UserProfile>): UserProfile {
  return {
    displayName: null,
    email: null,
    avatarUrl: null,
    provider: null,
    isAnonymous: false,
    ...overrides,
  };
}

describe('avatarInitials', () => {
  test('two-word display name → first letters of first and last word', () => {
    expect(avatarInitials(profile({ displayName: 'Jacob Ellison' }))).toBe('JE');
  });

  test('single-word display name → its first letter', () => {
    expect(avatarInitials(profile({ displayName: 'Jacob' }))).toBe('J');
  });

  test('no display name falls back to the email local part', () => {
    expect(avatarInitials(profile({ email: 'jake.s.ellison@gmail.com' }))).toBe('J');
  });

  test('no name and no email → null (component shows the person glyph)', () => {
    expect(avatarInitials(profile({}))).toBeNull();
    expect(avatarInitials(null)).toBeNull();
  });
});

describe('UserAvatar', () => {
  test('renders initials text when there is a name but no photo', () => {
    let tree: ReactTestRenderer;
    act(() => {
      tree = create(<ThemeProvider preference="dark"><UserAvatar profile={profile({ displayName: 'Jacob Ellison' })} /></ThemeProvider>);
    });
    const texts = tree!.root
      .findAll((n) => String(n.type) === 'Text')
      .map((n) => n.children.join(''));
    expect(texts).toContain('JE');
    act(() => tree!.unmount());
  });
});
