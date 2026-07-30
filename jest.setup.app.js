/**
 * App Jest project setup. Registers the official AsyncStorage mock so any code
 * that imports `@react-native-async-storage/async-storage` (e.g. the prediction
 * snapshot logger, and the queries hook that pulls it in transitively) runs
 * headlessly under jest-expo without the native module.
 *
 * https://react-native-async-storage.github.io/async-storage/docs/advanced/jest
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('react-native-keyboard-controller', () =>
  require('react-native-keyboard-controller/jest'),
);

/**
 * `@sentry/react-native` ships ESM source under its main entry, which Jest
 * can't transform without adding it to `transformIgnorePatterns` — and its
 * real `init`/native bridge has nothing meaningful to do headlessly anyway.
 * Mock it so `src/app-lib/sentry.ts` (and anything that imports it, like
 * `AppErrorBoundary`/`app/_layout.tsx`) can run under jest-expo untouched.
 */
jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
}));

jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  const layoutAnimation = {
    duration: () => layoutAnimation,
    easing: () => layoutAnimation,
    reduceMotion: () => layoutAnimation,
  };
  const reanimated = {
    __esModule: true,
    default: {
      View,
      call: () => undefined,
      createAnimatedComponent: (component) => component,
    },
    useAnimatedReaction: () => undefined,
    useAnimatedScrollHandler: (handler) => handler,
    useAnimatedProps: (fn) => fn(),
    useAnimatedStyle: (fn) => fn(),
    interpolate: (value, input, output) => {
      if (!Array.isArray(input) || !Array.isArray(output) || output.length === 0) return value;
      if (value <= input[0]) return output[0];
      return output[output.length - 1];
    },
    runOnJS: (fn) => fn,
    runOnUI: (fn) => fn,
    cancelAnimation: () => undefined,
    // GestureDetector (react-native-gesture-handler) wires its worklet via these.
    useEvent: () => () => undefined,
    useHandler: () => ({ context: {}, doDependenciesDiffer: false }),
    useDerivedValue: (fn) => ({ value: fn() }),
    useSharedValue: (value) => ({ value }),
    useReducedMotion: () => false,
    LinearTransition: layoutAnimation,
    FadeInUp: layoutAnimation,
    FadeOutUp: layoutAnimation,
    ReduceMotion: { System: 'system' },
    Easing: { bezier: () => (t) => t, inOut: (fn) => fn, out: (fn) => fn, in: (fn) => fn, ease: (t) => t, cubic: (t) => t },
    withTiming: (value, _config, callback) => {
      if (callback) callback(true);
      return value;
    },
    withDelay: (_delay, value) => value,
    withRepeat: (value) => value,
    withSequence: (...values) => values[values.length - 1],
  };
  return reanimated;
});

// Chart mount-reveal code intentionally snaps to its final state when
// requestAnimationFrame is unavailable. Keep app tests on that deterministic
// branch so broad screen smoke tests do not leak rAF callbacks past teardown.
global.requestAnimationFrame = undefined;
global.cancelAnimationFrame = undefined;
