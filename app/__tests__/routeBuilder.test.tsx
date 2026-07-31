import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { screenWrapper } from '@/app-lib/__testsupport__/render';

const mockSetCameraPosition = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({
    back: jest.fn(),
    canGoBack: () => true,
    dismissTo: jest.fn(),
    replace: jest.fn(),
  }),
}));

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 'balanced' },
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  getCurrentPositionAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
}));

jest.mock('@/app-lib/auth', () => ({
  useSession: () => ({ userId: 'u1', ready: true, error: null }),
}));

jest.mock('@/app-lib/preferences', () => ({
  useAppPreferences: () => ({ preferences: { distance: 'mi' } }),
}));

jest.mock('@/app-lib/queries', () => ({
  useWorkoutDetail: () => ({
    loading: false,
    error: null,
    workout: null,
    matchedActivities: [],
    today: '2026-07-27',
  }),
}));

jest.mock('@/app-lib/routes', () => ({
  createRoute: jest.fn(),
  useRoute: () => ({ data: null }),
}));

jest.mock('@/app-lib/rnmapbox', () => ({
  rnMapbox: null,
  rnMapboxAvailable: false,
}));

jest.mock('@/app-lib/maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const AppleMapView = React.forwardRef(
    (props: { onCameraMove?: (event: unknown) => void }, ref: React.Ref<unknown>) => {
      React.useImperativeHandle(ref, () => ({ setCameraPosition: mockSetCameraPosition }));
      return React.createElement(View, {
        testID: 'apple-route-map',
        onCameraMove: props.onCameraMove,
      });
    },
  );
  return {
    appleMapsAvailable: true,
    appleMaps: {
      AppleMaps: {
        View: AppleMapView,
        MapType: { STANDARD: 'standard' },
      },
    },
    MAPBOX_STYLE: { light: 'light', dark: 'dark' },
  };
});

import RouteBuilderScreen from '../routes/new';

async function renderScreen(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(screenWrapper(<RouteBuilderScreen />));
    await Promise.resolve();
  });
  return tree;
}

beforeEach(() => {
  mockSetCameraPosition.mockClear();
});

test('manual zoom controls preserve the live map center and move one zoom level', async () => {
  const tree = await renderScreen();
  const map = tree.root.findByProps({ testID: 'apple-route-map' });

  await act(async () => {
    map.props.onCameraMove({
      bearing: 0,
      coordinates: { latitude: 42.36, longitude: -71.06 },
      zoom: 14.4,
    });
  });
  mockSetCameraPosition.mockClear();

  const zoomIn = tree.root.findByProps({ testID: 'route-zoom-in' });
  const zoomOut = tree.root.findByProps({ testID: 'route-zoom-out' });
  expect(zoomIn.props.accessibilityLabel).toBe('Zoom in');
  expect(zoomOut.props.accessibilityLabel).toBe('Zoom out');

  await act(async () => zoomIn.props.onPress());
  expect(mockSetCameraPosition).toHaveBeenLastCalledWith({
    coordinates: { latitude: 42.36, longitude: -71.06 },
    zoom: 15.4,
  });

  await act(async () => zoomOut.props.onPress());
  expect(mockSetCameraPosition).toHaveBeenLastCalledWith({
    coordinates: { latitude: 42.36, longitude: -71.06 },
    zoom: 14.4,
  });

  act(() => tree.unmount());
});
