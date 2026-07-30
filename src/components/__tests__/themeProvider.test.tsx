// Lives under src/components (the jest-expo "app" project) because it renders RN;
// it exercises the runtime in @/theme/ThemeProvider.
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { ThemeProvider, useTheme, useScheme } from '@/theme/ThemeProvider';
import { THEMES } from '@/theme/tokens';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({ default: () => 'dark' }));

function Probe() {
  const C = useTheme();
  const scheme = useScheme();
  return <Text>{scheme}:{C.bg}</Text>;
}

test('preference "light" overrides the OS dark scheme', () => {
  const { getByText } = render(<ThemeProvider preference="light"><Probe /></ThemeProvider>);
  getByText(`light:${THEMES.light.bg}`);
});

test('preference "system" follows the OS scheme (mocked dark)', () => {
  const { getByText } = render(<ThemeProvider preference="system"><Probe /></ThemeProvider>);
  getByText(`dark:${THEMES.dark.bg}`);
});
