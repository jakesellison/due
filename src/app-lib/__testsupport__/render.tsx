/**
 * Shared screen-test harness: the full provider stack a screen needs to render
 * headless — react-query (retries off so failures fail now, not after three
 * backoffs), safe-area with a fixed iPhone-14 frame, and the theme.
 *
 * Use `renderScreen(<Screen />)` instead of hand-rolling the providers per
 * suite; `screenWrapper` is for the rare test that must call `render`/`rerender`
 * itself. `__testsupport__` directories are exempt from the orphan and layer
 * checks, like `__tests__`.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeProvider } from '@/theme/ThemeProvider';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

export function screenWrapper(node: React.ReactElement): React.ReactElement {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SafeAreaProvider initialMetrics={METRICS}>
        <ThemeProvider preference="dark">{node}</ThemeProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

export function renderScreen(node: React.ReactElement): ReturnType<typeof render> {
  return render(screenWrapper(node));
}
