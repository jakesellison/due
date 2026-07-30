import { StyleSheet } from 'react-native';
import { act, create } from 'react-test-renderer';
import { render, screen } from '@testing-library/react-native';

import { ThemeProvider } from '@/theme/ThemeProvider';
import { THEMES } from '@/theme/tokens';
import { ContractMileageTrack } from '../ContractMileageTrack';

test('shares one semantic rail: banked is yellow and scheduled is neutral', () => {
  render(
    <ThemeProvider preference="dark">
      <ContractMileageTrack
        actualFraction={0.4}
        projectedFraction={0.8}
        testID="contract-track"
      />
    </ThemeProvider>,
  );

  expect(StyleSheet.flatten(screen.getByTestId('contract-track-banked').props.style)?.backgroundColor).toBe(THEMES.dark.yellow);
  expect(StyleSheet.flatten(screen.getByTestId('contract-track-scheduled').props.style)?.backgroundColor).toBe(THEMES.dark.faint);
  expect(StyleSheet.flatten(screen.getByTestId('contract-track-rail').props.style)?.backgroundColor).toBe(THEMES.dark.fill);
  expect(screen.queryByTestId('contract-track-shortfall')).toBeNull();
});

function renderTrack(props: React.ComponentProps<typeof ContractMileageTrack>) {
  let tree: ReturnType<typeof create>;
  act(() => {
    tree = create(
      <ThemeProvider preference="dark">
        <ContractMileageTrack {...props} />
      </ThemeProvider>,
    );
  });
  return tree!;
}

describe('arrival band', () => {
  it('marks the span a just-banked run added', () => {
    const tree = renderTrack({
      actualFraction: 0.9,
      projectedFraction: 0.9,
      arrivingFromFraction: 0.78,
      testID: 'track',
    });
    const band = tree.root.findByProps({ testID: 'track-arrival' });
    expect(band).toBeTruthy();
  });

  it('renders no band when nothing arrived', () => {
    const tree = renderTrack({
      actualFraction: 0.9,
      projectedFraction: 0.9,
      testID: 'track',
    });
    expect(tree.root.findAllByProps({ testID: 'track-arrival' })).toHaveLength(0);
  });

  it('renders no band once the arrival is fully settled into the fill', () => {
    // from === actual means there is no new span left to distinguish.
    const tree = renderTrack({
      actualFraction: 0.9,
      projectedFraction: 0.9,
      arrivingFromFraction: 0.9,
      testID: 'track',
    });
    expect(tree.root.findAllByProps({ testID: 'track-arrival' })).toHaveLength(0);
  });
});
