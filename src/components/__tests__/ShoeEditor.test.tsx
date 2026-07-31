/**
 * ShoeEditor loading/not-found/error states (audit-code Lane 2 [Medium]):
 * before this fix, an EDIT (shoeId set) screen rendered as a blank "New shoe"
 * create form while `useShoes` was still loading, and stayed on that blank
 * create form permanently on a bad id or a failed fetch — Save would then
 * create a NEW shoe instead of editing. New-shoe mode (shoeId=null) has no
 * data to wait on and must render the form immediately.
 */
import { fireEvent, screen } from '@testing-library/react-native';

import { renderScreen } from '@/app-lib/__testsupport__/render';
import type { Shoe } from '@/app-lib/queries';

const mockSession: { value: { userId: string | null; ready: boolean; error: Error | null } } = {
  value: { userId: 'u1', ready: true, error: null },
};
jest.mock('@/app-lib/auth', () => ({
  useSession: () => mockSession.value,
}));

jest.mock('@/app-lib/nav', () => ({ closeScreen: jest.fn() }));

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
}));

const mockShoesRefetch = jest.fn();
const mockShoes: { value: { data: Shoe[]; isLoading: boolean; error: Error | null; refetch: typeof mockShoesRefetch } } = {
  value: { data: [], isLoading: false, error: null, refetch: mockShoesRefetch },
};

jest.mock('@/app-lib/queries', () => ({
  useShoes: () => mockShoes.value,
  createShoe: jest.fn(async () => 's1'),
  updateShoe: jest.fn(async () => undefined),
  deleteShoe: jest.fn(async () => undefined),
  setDefaultShoe: jest.fn(async () => undefined),
  uploadShoePhoto: jest.fn(async () => undefined),
}));

// Imported AFTER the mocks are registered.
import { ShoeEditor } from '../ShoeEditor';

function renderEditor(shoeId: string | null) {
  return renderScreen(<ShoeEditor shoeId={shoeId} />);
}

function mkShoe(over: Partial<Shoe> = {}): Shoe {
  return {
    id: 's1',
    name: 'Pegasus 41',
    photoPath: null,
    photoUrl: null,
    startingMeters: 0,
    isDefault: false,
    retiredAt: null,
    totalMeters: 0,
    activityCount: 0,
    ...over,
  };
}

beforeEach(() => {
  mockShoesRefetch.mockClear();
  mockShoes.value = { data: [], isLoading: false, error: null, refetch: mockShoesRefetch };
  mockSession.value = { userId: 'u1', ready: true, error: null };
});

test('new-shoe mode renders the form immediately (no data to wait on)', () => {
  renderEditor(null);
  expect(screen.getByText('New shoe')).toBeTruthy();
});

test('edit mode shows a loading spinner while shoes are still loading — not the blank create form', () => {
  mockShoes.value = { data: [], isLoading: true, error: null, refetch: mockShoesRefetch };
  renderEditor('s1');
  expect(screen.queryByText('New shoe')).toBeNull();
  expect(screen.queryByText('Edit shoe')).toBeNull();
});

test('session not ready + a disabled query (isLoading false, data undefined-ish, error null) shows loading — NOT "Shoe not found"', () => {
  // Pre-ready boot window: useShoes(ready ? userId : null) is disabled, so
  // react-query v5 reports isLoading=false/error=null/data=undefined even
  // though nothing has resolved. ShoeEditor must key off `ready`, not
  // `isLoading`, or it flashes a false "Shoe not found" for a real shoe.
  mockSession.value = { userId: null, ready: false, error: null };
  mockShoes.value = { data: undefined as unknown as Shoe[], isLoading: false, error: null, refetch: mockShoesRefetch };
  renderEditor('s1');
  expect(screen.queryByText('Shoe not found')).toBeNull();
  expect(screen.queryByText('New shoe')).toBeNull();
  expect(screen.queryByText('Edit shoe')).toBeNull();
});

test('edit mode shows "Shoe not found" once loaded with no matching id — not the blank create form', () => {
  mockShoes.value = { data: [mkShoe({ id: 'other', name: 'Other shoe' })], isLoading: false, error: null, refetch: mockShoesRefetch };
  renderEditor('missing-id');
  expect(screen.getByText('Shoe not found')).toBeTruthy();
  expect(screen.queryByText('New shoe')).toBeNull();
});

test('edit mode shows an error + retry when the shoes fetch fails, and Retry calls refetch', () => {
  mockShoes.value = { data: [], isLoading: false, error: new Error('offline'), refetch: mockShoesRefetch };
  renderEditor('s1');
  expect(screen.getByText('Couldn’t load this shoe')).toBeTruthy();
  expect(screen.getByText('offline')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Retry'));
  expect(mockShoesRefetch).toHaveBeenCalledTimes(1);
});

test('edit mode renders the real edit form once the shoe is found', () => {
  mockShoes.value = { data: [mkShoe()], isLoading: false, error: null, refetch: mockShoesRefetch };
  renderEditor('s1');
  expect(screen.getByText('Edit shoe')).toBeTruthy();
  expect(screen.getByDisplayValue('Pegasus 41')).toBeTruthy();
});
