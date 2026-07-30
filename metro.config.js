// Metro config for the Expo (React Native) app.
//
// Wrapped by Sentry's Expo integration: `getSentryExpoConfig` extends the SDK
// default config and injects Debug IDs into the JS bundle so release-build
// stack traces symbolicate against the uploaded source maps. Without it, maps
// upload but traces stay minified. Extend here later as needed (svg
// transformer, monorepo watch folders).
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

const config = getSentryExpoConfig(__dirname);

module.exports = config;
