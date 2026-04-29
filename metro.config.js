// Metro config — wraps the Expo defaults with Sentry's source-map serializer
// so every bundle ships with a stable Debug ID. The ID lets the Sentry release
// upload (driven by `@sentry/react-native/expo`'s `withSentry` config plugin)
// match symbolicated frames at runtime against the source maps captured at
// build time.
//
// `getSentryExpoConfig` is a drop-in replacement for the standard
// `expo/metro-config` `getDefaultConfig`. It does not require any auth: the
// release upload that consumes the maps runs separately during EAS build and
// no-ops gracefully when SENTRY_AUTH_TOKEN is unset.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname);
