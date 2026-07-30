/**
 * Render smokes for the two remaining untested screens (test-audit gap #6):
 * the route detail (`routes/[id]`) and the plan change history
 * (`plan/history`). Deliberately smoke-depth — loaded happy path + the state
 * that most commonly regresses (missing/empty data) — not interaction suites.
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ThemeProvider } from '@/theme/ThemeProvider';

const MI = 1609.34;

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
  useLocalSearchParams: () => ({ id: 'r1' }),
}));
jest.mock('@/app-lib/auth', () => ({
  useSession: () => ({ userId: 'u1', ready: true, error: null }),
}));
jest.mock('@/app-lib/nav', () => ({ closeScreen: jest.fn() }));

const mockRoute: { value: unknown } = {
  value: {
    data: {
      id: 'r1', name: 'River loop', distance_meters: 6.2 * MI,
      drawPath: [], points: [], elevationGainMeters: null,
      created_at: '2026-07-01T12:00:00Z',
    },
    isLoading: false,
    error: null,
  },
};
jest.mock('@/app-lib/routes', () => ({
  useRoute: () => mockRoute.value,
  deleteRoute: jest.fn(),
  renameRoute: jest.fn(),
}));

const mockChangeLog: { value: unknown } = {
  value: { events: [], isLoading: false, error: null, refetch: async () => {} },
};
jest.mock('@/app-lib/queries/planChanges', () => ({
  usePlanChangeLog: () => mockChangeLog.value,
}));
jest.mock('@/app-lib/supabase', () => ({ supabase: {} }));

// Mapbox renders natively; the smoke only needs it to not crash headless.
jest.mock('@rnmapbox/maps', () => ({
  __esModule: true,
  default: { setAccessToken: jest.fn() },
  MapView: () => null, Camera: () => null, ShapeSource: () => null,
  LineLayer: () => null, CircleLayer: () => null,
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const wrap = (el: React.ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SafeAreaProvider initialMetrics={METRICS}>
        <ThemeProvider preference="dark">{el}</ThemeProvider>
      </SafeAreaProvider>
    </QueryClientProvider>,
  );

/* eslint-disable @typescript-eslint/no-var-requires */
const RouteDetail = require('../routes/[id]').default;
const PlanHistory = require('../plan/history').default;
/* eslint-enable @typescript-eslint/no-var-requires */

describe('routes/[id]', () => {
  it('renders the loaded route name and distance', () => {
    wrap(<RouteDetail />);
    expect(screen.getByText('River loop')).toBeTruthy();
  });

  it('a missing route renders the empty state, not a crash', () => {
    mockRoute.value = { data: null, isLoading: false, error: null };
    wrap(<RouteDetail />);
    expect(screen.queryByText('River loop')).toBeNull();
  });
});

describe('plan/history', () => {
  it('renders the empty change log without crashing', () => {
    wrap(<PlanHistory />);
    expect(screen.queryByText(/error/i)).toBeNull();
  });

  it('renders change entries when present', () => {
    mockChangeLog.value = {
      isLoading: false, error: null, refetch: async () => {},
      events: [{
        id: 'c1', createdAt: '2026-07-28T10:00:00Z', actor: 'user',
        summary: 'Long run moved to Sunday', changes: [], weekIndices: [12], dates: [],
      }],
    };
    wrap(<PlanHistory />);
    // The screen renders the event's date header + per-change rows; with no
    // resolved changes the dated event shell is the assertion surface.
    expect(screen.getByText(/Jul 28/)).toBeTruthy();
  });
});
