/**
 * Two Jest projects, transplanted shape (see mileage's jest.config.js for the
 * original rationale): `node` = pure TS under ts-jest; `app` = RN/Expo under
 * jest-expo. They cannot share a preset.
 * @type {import('jest').Config}
 */
module.exports = {
  watchman: false,
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
      // Phase 2 scope: src/app-lib. Phase 3 adds src/components; Phase 4 adds app/.
      roots: ['<rootDir>/src/app-lib'],
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
