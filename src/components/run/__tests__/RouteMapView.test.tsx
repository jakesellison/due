/**
 * Fallback-selection tests for RouteMapView (jest-expo `app` project). With a
 * Mapbox token present it renders the static map <Image> (the gold route baked
 * into the URL); with no token and no native map, it falls to the Skia floor
 * (an <Image>-free render) — which is why the Routes screen test keeps passing
 * headlessly. The live rnMapbox / Apple branches are native views, verified on
 * the sim, not here.
 */
import { Image } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ThemeProvider } from '@/theme/ThemeProvider';

// Configurable map config. `mapboxToken` flips the static-vs-Skia branch; the
// Apple branch is kept off (appleMapsAvailable false) so the floor is Skia.
const mapsMock: { mapboxToken: string | null } = { mapboxToken: null };
jest.mock('@/app-lib/maps', () => ({
  get mapboxToken() {
    return mapsMock.mapboxToken;
  },
  MAPBOX_STYLE: { light: 'owner/light', dark: 'owner/dark' },
  appleMaps: null,
  appleMapsAvailable: false,
}));

import { RouteMapView } from '../RouteMapView';

/** A small loop route. */
const PATH: [number, number][] = [
  [41.88, -87.62],
  [41.89, -87.61],
  [41.885, -87.6],
  [41.88, -87.62],
];

function render(node: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<ThemeProvider preference="dark">{node}</ThemeProvider>);
  });
  return tree;
}

function images(tree: ReactTestRenderer) {
  return tree.root.findAllByType(Image);
}

beforeEach(() => {
  mapsMock.mapboxToken = null;
});

describe('RouteMapView', () => {
  it('renders a static Mapbox image (gold route baked in) when a token is set', () => {
    mapsMock.mapboxToken = 'pk.test';
    const tree = render(<RouteMapView path={PATH} width={120} height={58} />);
    const uris = images(tree).map((n) => String(n.props.source?.uri ?? ''));
    const mapbox = uris.find((u) => u.includes('api.mapbox.com'));
    expect(mapbox).toBeDefined();
    expect(mapbox).toContain('FFC93C'); // brand-gold route stroke
    expect(mapbox).toContain('owner/dark'); // dark-scheme style
  });

  it('falls back to the Skia floor (no image) when there is no token', () => {
    const tree = render(<RouteMapView path={PATH} width={120} height={58} />);
    expect(images(tree)).toHaveLength(0);
  });
});
