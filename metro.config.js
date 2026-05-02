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
const path = require('path');
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

const config = getSentryExpoConfig(__dirname);

// Screenshot-mode-only: stub expo-sqlite on web. The real package pulls in a
// WASM artefact whose Metro resolution is brittle on rebuild; we never call
// initDatabase() in screenshot mode, so a no-op shim is correct and safe.
// Production builds (no EXPO_PUBLIC_SCREENSHOT_MODE) take the original path.
if (process.env.EXPO_PUBLIC_SCREENSHOT_MODE === '1') {
  const stubPath = path.resolve(__dirname, 'src/screenshots/expoSqliteStub.web.js');
  const upstream = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (platform === 'web' && moduleName === 'expo-sqlite') {
      return { type: 'sourceFile', filePath: stubPath };
    }
    if (upstream) return upstream(context, moduleName, platform);
    return context.resolveRequest(context, moduleName, platform);
  };
}

module.exports = config;
