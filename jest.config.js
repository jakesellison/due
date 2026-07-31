/**
 * Two Jest projects, transplanted shape (see mileage's jest.config.js for the
 * original rationale): `node` = pure TS under ts-jest; `app` = RN/Expo under
 * jest-expo. They cannot share a preset.
 * @type {import('jest').Config}
 */
module.exports = {
  watchman: false,
  // Coverage is measured against the whole codebase, not just files a test
  // happens to load — untested files count as 0%, so the floors below are
  // honest. Floors are a RATCHET set just under measured reality (see
  // docs/audits/2026-07-30-test-audit.md): they exist to catch decay, not to
  // be a target. Re-measure and raise them after closing a coverage gap.
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    'app/**/*.{ts,tsx}',
    'api/**/*.ts',
    '!**/__tests__/**',
    '!**/__testsupport__/**',
    '!**/__sim__/**',
  ],
  coverageReporters: ['text-summary', 'json-summary'],
  // Measured 2026-07-31 (jest's own group aggregates): lib 77.5 / server 76.6 /
  // components 73.6 / app 71.8 / app-lib 60.1 / api 55.4 lines. Floors sit
  // ~2pts under; `global` covers whatever the path groups don't claim (theme).
  coverageThreshold: {
    global: { lines: 70 },
    './src/lib/': { lines: 75 },
    './src/server/': { lines: 74 },
    './src/components/': { lines: 71 },
    './src/app-lib/': { lines: 58 },
    './app/': { lines: 69 },
    './api/': { lines: 53 },
  },
  projects: [
    {
      displayName: 'node',
      preset: 'ts-jest',
      testEnvironment: 'node',
      roots: ['<rootDir>/src/lib', '<rootDir>/src/server', '<rootDir>/src/theme', '<rootDir>/api'],
      testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
      moduleNameMapper: {
        '^jose$': '<rootDir>/src/server/__testsupport__/joseStub.ts',
        '^@/(.*)$': '<rootDir>/src/$1',
      },
    },
    {
      displayName: 'app',
      preset: 'jest-expo',
      roots: ['<rootDir>/src/app-lib', '<rootDir>/src/components', '<rootDir>/app'],
      testMatch: ['**/__tests__/**/*.test.{ts,tsx}', '**/*.test.{ts,tsx}'],
      setupFiles: [
        '<rootDir>/node_modules/react-native-gesture-handler/jestSetup.js',
        '<rootDir>/node_modules/@shopify/react-native-skia/jestSetup.js',
        '<rootDir>/jest.setup.app.js',
      ],
      transformIgnorePatterns: [
        'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@react-navigation/.*|react-native-svg|react-native-url-polyfill|@supabase/.*|victory-native|@shopify/react-native-skia))',
      ],
    },
  ],
};
