import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/app-lib/auth', () => ({ useSession: () => ({ profile: null }) }));

import { Screen } from '../Screen';
import { ThemeProvider } from '@/theme/ThemeProvider';

function flattenText(c: unknown): string {
  if (typeof c === 'string') return c;
  if (typeof c === 'number') return String(c);
  if (Array.isArray(c)) return c.map(flattenText).join('');
  return '';
}
function collectText(node: any, out: string[] = []): string[] {
  if (!node) return out;
  if (node.type === Text) out.push(flattenText(node.props.children));
  for (const child of node.children ?? []) collectText(child, out);
  return out;
}
function findByA11yLabel(node: any, label: string): any {
  if (!node) return null;
  if (node.props?.accessibilityLabel === label) return node;
  for (const child of node.children ?? []) {
    const found = findByA11yLabel(child, label);
    if (found) return found;
  }
  return null;
}

test('renders the title and a default profile avatar in the header', () => {
  let tree: ReactTestRenderer;
  act(() => {
    tree = create(
      <ThemeProvider preference="dark">
        <Screen title="Plan" subtitle="Chicago Marathon">
          <Text>body</Text>
        </Screen>
      </ThemeProvider>,
    );
  });
  expect(collectText(tree!.root)).toEqual(expect.arrayContaining(['Plan', 'Chicago Marathon', 'body']));
  expect(findByA11yLabel(tree!.root, 'Profile and settings')).not.toBeNull();
});
