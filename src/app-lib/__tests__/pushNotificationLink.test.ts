/**
 * Notification deep-link allowlist (test-audit gap #5).
 *
 * Expo push tokens are bearer credentials — anyone holding one can send
 * arbitrary data through Expo's public API. The `url` allowlist is what stops
 * a leaked token turning a tap into "open any URL". It shipped as a security
 * fix with zero tests; these pin it.
 */
// `Linking` here is react-native's, not expo-linking's — spy, don't module-mock.
import { Linking } from 'react-native';

jest.mock('expo-notifications', () => ({}));
jest.mock('../supabase', () => ({ supabase: {} }));
jest.mock('../api', () => ({}));

import { routeFromResponse } from '../pushNotifications';

const mockOpenURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);

const tap = (url: unknown) => ({
  notification: { request: { content: { data: { url } } } },
}) as never;

beforeEach(() => { mockOpenURL.mockClear(); mockOpenURL.mockResolvedValue(true as never); });

test('a duerunning:// link is opened', () => {
  routeFromResponse(tap('duerunning://run/abc'));
  expect(mockOpenURL).toHaveBeenCalledWith('duerunning://run/abc');
});

test.each([
  ['https phishing page', 'https://evil.example/login'],
  ['another app scheme', 'othertracker://steal'],
  ['scheme-relative', '//evil.example'],
  ['case-tricked scheme', 'DUERUNNING://run/abc'],
  ['non-string payload', { url: 'duerunning://run/abc' }],
  ['missing url', undefined],
])('%s is NEVER opened', (_label, url) => {
  routeFromResponse(tap(url));
  expect(mockOpenURL).not.toHaveBeenCalled();
});

test('a null response is a quiet no-op', () => {
  routeFromResponse(null);
  expect(mockOpenURL).not.toHaveBeenCalled();
});
