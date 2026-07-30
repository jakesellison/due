import * as ReactNative from 'react-native';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';

import { StickySections } from '../StickySections';
import { ThemeProvider } from '@/theme/ThemeProvider';

afterEach(() => jest.restoreAllMocks());

test('allows sticky section labels to wrap at accessibility text sizes', () => {
  jest.spyOn(ReactNative, 'useWindowDimensions').mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 2 });
  const view = render(
    <ThemeProvider preference="dark">
      <StickySections blocks={[{
        kind: 'section',
        key: 'period',
        label: 'Tuesday, July 21',
        body: <Text>Workout</Text>,
        right: <Text>Today</Text>,
      }]} />
    </ThemeProvider>,
  );

  const label = view.getByText('Tuesday, July 21');
  expect(label.props).toEqual(expect.objectContaining({
    adjustsFontSizeToFit: false,
    maxFontSizeMultiplier: 2,
  }));
  expect(label.props).not.toHaveProperty('numberOfLines');
});
