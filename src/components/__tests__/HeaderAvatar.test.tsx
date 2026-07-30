import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/app-lib/auth', () => ({
  useSession: () => ({ profile: { displayName: 'Jacob Ellison', email: 'j@e.com', avatarUrl: null, isAnonymous: false } }),
}));

import { HeaderAvatar } from '../HeaderAvatar';
import { ThemeProvider } from '@/theme/ThemeProvider';

function findByA11yLabel(node: any, label: string): any {
  if (!node) return null;
  if (node.props?.accessibilityLabel === label) return node;
  for (const child of node.children ?? []) {
    const found = findByA11yLabel(child, label);
    if (found) return found;
  }
  return null;
}

test('renders a profile button that navigates to the You hub', () => {
  mockPush.mockClear();
  let tree: ReactTestRenderer;
  act(() => {
    tree = create(<ThemeProvider preference="dark"><HeaderAvatar /></ThemeProvider>);
  });
  const btn = findByA11yLabel(tree!.root, 'Profile and settings');
  expect(btn).not.toBeNull();
  act(() => {
    btn.props.onPress();
  });
  expect(mockPush).toHaveBeenCalledWith('/you');
});
