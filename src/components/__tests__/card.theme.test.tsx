import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { Card, Section } from '../Card';

test('Card and Section render in both themes', () => {
  for (const pref of ['light', 'dark'] as const) {
    expect(() => render(<ThemeProvider preference={pref}><Card><Text>x</Text></Card></ThemeProvider>)).not.toThrow();
    expect(() => render(<ThemeProvider preference={pref}><Section title="Analysis" icon="chart.bar"><Text>y</Text></Section></ThemeProvider>)).not.toThrow();
  }
});
