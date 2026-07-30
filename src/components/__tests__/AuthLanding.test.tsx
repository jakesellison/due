import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';

import { AuthLanding as RealAuthLanding } from '../AuthLanding';
import { DueMark } from '@/components/DueMark';
import { signInWithStrava } from '@/app-lib/auth';
import { ThemeProvider } from '@/theme/ThemeProvider';

function AuthLanding(props: React.ComponentProps<typeof RealAuthLanding>) {
  return (
    <ThemeProvider preference="dark">
      <RealAuthLanding {...props} />
    </ThemeProvider>
  );
}

jest.mock('@/app-lib/auth', () => ({
  signInWithStrava: jest.fn(),
}));

function flattenText(c: unknown): string {
  if (typeof c === 'string') return c;
  if (typeof c === 'number') return String(c);
  if (Array.isArray(c)) return c.map(flattenText).join('');
  return '';
}

function allText(tree: ReactTestRenderer): string {
  return tree.root
    .findAllByType(Text)
    .map((n) => flattenText(n.props.children))
    .join(' | ');
}

describe('AuthLanding', () => {
  beforeEach(() => {
    jest.mocked(signInWithStrava).mockReset();
  });

  it('renders only the Due mark above the Strava sign-in action', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<AuthLanding />);
    });
    const text = allText(tree);
    expect(tree.root.findAllByType(DueMark)).toHaveLength(1);
    expect(text).not.toContain('Show up. Stack the days.');
    expect(text).toContain('Strava');
    const btn = tree.root.findAll((n) => n.props.accessibilityLabel === 'Connect with Strava');
    expect(btn.length).toBeGreaterThanOrEqual(1);
    act(() => tree.unmount());
  });

  it('calls Strava sign-in and reports success', async () => {
    jest.mocked(signInWithStrava).mockResolvedValue('signed_in');
    const onSignedIn = jest.fn();
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<AuthLanding onSignedIn={onSignedIn} />);
    });

    const button = tree.root.findAll((n) => n.props.accessibilityLabel === 'Connect with Strava')[0]!;
    await act(async () => {
      await button.props.onPress();
    });

    expect(signInWithStrava).toHaveBeenCalledTimes(1);
    expect(onSignedIn).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });
});
