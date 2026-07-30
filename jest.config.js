/**
 * Phase 1: one project — the pure node lib. The app/jest-expo project arrives
 * with Phase 2/4 (see the old repo's jest.config.js for the shape it takes).
 * @type {import('jest').Config}
 */
module.exports = {
  watchman: false,
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src/lib'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
};
