import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { ThemeProvider } from '@/theme/ThemeProvider';
import { THEMES } from '@/theme/tokens';
import { projectionDelta, ReshapeSummary, supportState } from '../ReshapeSummary';

const MI = 1609.344;

test('distills the weekly contract without repeated eyebrow and legend copy', () => {
  render(
    <ThemeProvider preference="dark">
      <ReshapeSummary
        banked={{ miles: 60.7 * MI, quality: 7.8 * MI, long: 20 * MI }}
        projected={{ miles: 94.7 * MI, quality: 7.8 * MI, long: 20 * MI }}
        contract={{ miles: 94 * MI, quality: 10 * MI, long: 20 * MI }}
      />
    </ThemeProvider>,
  );

  expect(screen.getByText('94.7')).toBeTruthy();
  expect(screen.getByText('mi projected')).toBeTruthy();
  expect(screen.getByText('94')).toBeTruthy();
  expect(screen.getByText('mi contract')).toBeTruthy();
  expect(screen.getByText('0.7 mi over')).toBeTruthy();
  expect(screen.getByText('60.7 mi banked  ·  34 mi scheduled')).toBeTruthy();
  expect(screen.getByText('Quality 2.2 mi open')).toBeTruthy();
  expect(screen.queryByText(/Long run/)).toBeNull();
  expect(screen.queryByText('Covered')).toBeNull();

  expect(screen.queryByText('Projected mileage')).toBeNull();
  expect(screen.queryByText('Key work')).toBeNull();
  expect(screen.queryByText('WEEKLY MILEAGE')).toBeNull();
  expect(screen.queryByText('PROJECTED / CONTRACT')).toBeNull();
  expect(screen.queryByText('SUPPORTING WORK')).toBeNull();
  expect(screen.queryByText(/IF THE REMAINING WORK/)).toBeNull();
  expect(screen.getByTestId('reshape-contract-mileage-track')).toBeTruthy();
});

test('uses the contract as the rail endpoint when projected mileage is short', () => {
  render(
    <ThemeProvider preference="dark">
      <ReshapeSummary
        banked={{ miles: 12 * MI, quality: 0, long: 12 * MI }}
        projected={{ miles: 89 * MI, quality: 10 * MI, long: 22 * MI }}
        contract={{ miles: 100 * MI, quality: 22 * MI, long: 22 * MI }}
      />
    </ThemeProvider>,
  );

  const targetStyle = StyleSheet.flatten(
    screen.getByTestId('reshape-contract-mileage-track-target-mark').props.style,
  );
  expect(targetStyle?.left).toBe('100%');
});

test('reserves headroom only when the projection exceeds the contract', () => {
  render(
    <ThemeProvider preference="dark">
      <ReshapeSummary
        banked={{ miles: 100 * MI, quality: 10 * MI, long: 20 * MI }}
        projected={{ miles: 110 * MI, quality: 10 * MI, long: 20 * MI }}
        contract={{ miles: 100 * MI, quality: 10 * MI, long: 20 * MI }}
      />
    </ThemeProvider>,
  );

  const targetStyle = StyleSheet.flatten(
    screen.getByTestId('reshape-contract-mileage-track-target-mark').props.style,
  );
  expect(Number.parseFloat(String(targetStyle?.left))).toBeLessThan(100);
});

test('projection and supporting-goal states stay concise at each boundary', () => {
  expect(projectionDelta(0)).toBe('On contract');
  expect(projectionDelta(0.7 * MI)).toBe('0.7 mi over');
  expect(projectionDelta(-5 * MI)).toBe('5 mi short');
  expect(supportState(0, 0)).toBe('No target');
  expect(supportState(10 * MI, 10 * MI)).toBe('Covered');
  expect(supportState(7.8 * MI, 10 * MI)).toBe('2.2 mi open');
});

test('uses category color only on open key-work labels', () => {
  render(
    <ThemeProvider preference="dark">
      <ReshapeSummary
        banked={{ miles: 60.7 * MI, quality: 4 * MI, long: 10 * MI }}
        projected={{ miles: 74.7 * MI, quality: 7.8 * MI, long: 17 * MI }}
        contract={{ miles: 94 * MI, quality: 10 * MI, long: 20 * MI }}
      />
    </ThemeProvider>,
  );

  expect(screen.getByText('Quality 2.2 mi open')).toBeTruthy();
  expect(screen.getByText('Long run 3 mi open')).toBeTruthy();
  expect(StyleSheet.flatten(screen.getByTestId('reshape-exception-quality-label').props.style)?.color).toBe(THEMES.dark.qualText);
  expect(StyleSheet.flatten(screen.getByTestId('reshape-exception-long-label').props.style)?.color).toBe(THEMES.dark.cyanText);
});
