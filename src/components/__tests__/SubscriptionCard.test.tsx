import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, Text, View } from 'react-native';

import { SubscriptionCard } from '../SubscriptionCard';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';

function flattenText(c: unknown): string {
  if (typeof c === 'string') return c;
  if (typeof c === 'number') return String(c);
  if (Array.isArray(c)) return c.map(flattenText).join('');
  return '';
}
function allText(node: any, out: string[] = []): string[] {
  if (!node) return out;
  if (node.type === Text) out.push(flattenText(node.props.children));
  for (const child of node.children ?? []) allText(child, out);
  return out;
}

test('renders the free/coming-soon placeholder', () => {
  let tree: ReactTestRenderer;
  act(() => {
    tree = create(<ThemeProvider preference="dark"><SubscriptionCard /></ThemeProvider>);
  });
  const text = allText(tree!.root).join(' ');
  expect(text).toContain('Free');
  expect(text.toLowerCase()).toContain('coming soon');
  expect(StyleSheet.flatten(tree!.root.findByType(View).props.style)).toMatchObject({
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  });
});
