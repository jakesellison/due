import { fireEvent, render, screen } from '@testing-library/react-native';
import { Pressable, Text, View } from 'react-native';

import { resetAppPreferencesForTests, useAppPreferences } from '@/app-lib/preferences';
import { WeekGauges, type GaugeStats } from '@/components/dash/WeekGauges';
import { formatTemperature } from '@/lib';
import { ThemeProvider } from '@/theme/ThemeProvider';

const MI = 1609.344;
const stats: GaugeStats = {
  mileage: { actualMeters: 20 * MI, targetMeters: 40 * MI },
  quality: { actualMeters: 5 * MI, targetMeters: 10 * MI },
  long: { actualMeters: 12 * MI, targetMeters: 18 * MI },
};

function PreferenceReader({ testID }: { testID: string }) {
  const { preferences } = useAppPreferences();
  return <Text testID={testID}>{preferences.distance}</Text>;
}

function PreferenceHarness() {
  const { preferences, setPreference } = useAppPreferences();
  return (
    <ThemeProvider preference="dark">
      <View>
        <PreferenceReader testID="reader-a" />
        <PreferenceReader testID="reader-b" />
        <Pressable accessibilityRole="button" accessibilityLabel="Use kilometers" onPress={() => setPreference('distance', 'km')}>
          <Text>Use kilometers</Text>
        </Pressable>
        <Text testID="temperature-reading">{formatTemperature(20, preferences.temperature)}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Use Celsius" onPress={() => setPreference('temperature', 'celsius')}>
          <Text>Use Celsius</Text>
        </Pressable>
        <WeekGauges
          stats={stats}
          weekKey="reactive"
          weekRangeLabel="Jul 20–26"
          period="current"
          reduceMotion
        />
      </View>
    </ThemeProvider>
  );
}

afterEach(() => {
  resetAppPreferencesForTests();
});

test('publishes a distance change to every mounted consumer immediately', () => {
  render(<PreferenceHarness />);

  expect(screen.getByTestId('reader-a')).toHaveTextContent('mi');
  expect(screen.getByTestId('reader-b')).toHaveTextContent('mi');
  expect(screen.getByText('Weekly contract · 40 mi')).toBeTruthy();

  fireEvent.press(screen.getByRole('button', { name: 'Use kilometers' }));

  expect(screen.getByTestId('reader-a')).toHaveTextContent('km');
  expect(screen.getByTestId('reader-b')).toHaveTextContent('km');
  expect(screen.getByText('Weekly contract · 64 km')).toBeTruthy();
  expect(screen.getByText('8.0 km left')).toBeTruthy();
  expect(screen.getByText('9.7 km left')).toBeTruthy();
});

test('publishes a temperature change to every mounted consumer immediately', () => {
  render(<PreferenceHarness />);

  expect(screen.getByTestId('temperature-reading')).toHaveTextContent('68°F');

  fireEvent.press(screen.getByRole('button', { name: 'Use Celsius' }));

  expect(screen.getByTestId('temperature-reading')).toHaveTextContent('20°C');
});
