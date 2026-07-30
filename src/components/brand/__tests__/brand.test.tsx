import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { DueGlyphTile, DuePanel, DueSectionHeading } from '@/components/brand';
import { ThemeProvider } from '@/theme/ThemeProvider';

test('the Due glyph tile keeps one fixed branded silhouette across tones', () => {
  render(
    <ThemeProvider preference="dark">
      <DueGlyphTile name="quality" tone="quality" size={36} testID="glyph-tile" />
    </ThemeProvider>,
  );

  expect(screen.getByTestId('glyph-tile')).toHaveStyle({ width: 36, height: 36 });
});

test('the Due panel uses the standard Week card geometry while preserving content', () => {
  render(
    <ThemeProvider preference="light">
      <DuePanel testID="due-panel"><Text>Phase content</Text></DuePanel>
    </ThemeProvider>,
  );

  fireEvent(screen.getByTestId('due-panel'), 'layout', {
    nativeEvent: { layout: { width: 280, height: 94, x: 0, y: 0 } },
  });
  expect(screen.getByTestId('due-panel')).toHaveStyle({ borderRadius: 12 });
  expect(screen.getByText('Phase content')).toBeTruthy();
});

test('section headings pair brand type with compact contract metadata', () => {
  render(
    <ThemeProvider preference="light">
      <DueSectionHeading title="Block ledger" meta="23 weeks" glyph="contract" />
    </ThemeProvider>,
  );

  expect(screen.getByText('Block ledger')).toBeTruthy();
  expect(screen.getByText('23 weeks')).toBeTruthy();
});
