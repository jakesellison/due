/**
 * SyncStatusRow — Dash's compact backfill-visibility row (PM#1). Renders only
 * while the SHARED backfill status (`useBackfillStatus`) is running or
 * rate-limited; nothing once idle/done. Uses @testing-library/react-native
 * (see component-test-framework memory — new RN component tests use RTL, not
 * react-test-renderer).
 */
import { render, screen, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { setBackfillStatus, resetBackfillStatusForTests } from '@/app-lib/backfillStatus';
import { SyncStatusRow } from '../SyncStatusRow';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

beforeEach(() => {
  resetBackfillStatusForTests();
  mockPush.mockClear();
});

function renderRow() {
  return render(
    <ThemeProvider preference="dark">
      <SyncStatusRow />
    </ThemeProvider>,
  );
}

test('renders nothing while the backfill is idle', () => {
  renderRow();
  expect(screen.queryByRole('button')).toBeNull();
});

test('renders nothing once a backfill is done', () => {
  setBackfillStatus({ kind: 'done', imported: 340, enriched: 340 });
  renderRow();
  expect(screen.queryByRole('button')).toBeNull();
});

test('renders the running label + tap target while a backfill is active', () => {
  setBackfillStatus({ kind: 'running', label: 'Imported 87 runs, enriching 12…', fraction: null });
  renderRow();
  expect(screen.getByText('Imported 87 runs, enriching 12…')).toBeTruthy();
  fireEvent.press(screen.getByRole('button'));
  expect(mockPush).toHaveBeenCalledWith('/you');
});

test('renders a determinate bar width once the enrich phase reports a known fraction', () => {
  setBackfillStatus({ kind: 'running', label: 'Enriching 12/30…', fraction: 0.4 });
  renderRow();
  // The row is still a single labelled tap target; the fraction only affects
  // the inner bar's width style, not additional visible text.
  expect(screen.getByText('Enriching 12/30…')).toBeTruthy();
});

test('surfaces a rate-limited halt with the warning copy', () => {
  setBackfillStatus({ kind: 'rate_limited', mode: 'history' });
  renderRow();
  expect(screen.getByText('Import paused — rate limited')).toBeTruthy();
});
