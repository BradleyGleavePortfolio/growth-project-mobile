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

// Production builds: replace the screenshots module with an empty stub so
// fixture data and the axios mock adapter are never included in the bundle.
// Metro's resolver runs at bundle time (not runtime), so a resolveRequest
// hook is the only reliable way to tree-shake a relative-path import.
// __DEV__ is NOT usable here — it is a runtime constant, not a Metro resolver
// signal, and dynamic require() calls based on runtime booleans are NOT
// tree-shaken by Metro.
//
// EAS production builds set NODE_ENV=production. The EAS_BUILD_PROFILE env
// var is set to the profile name ('production', 'preview', etc.) and provides
// a secondary signal for cases where NODE_ENV may not be set.
const isProductionBuild =
  process.env.NODE_ENV === 'production' ||
  process.env.EAS_BUILD_PROFILE === 'production';

{
  const stubPath = path.resolve(__dirname, 'src/screenshots/index.stub.ts');
  const upstream = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    // Swap the screenshots module for the empty stub in production builds.
    if (
      isProductionBuild &&
      moduleName.includes('screenshots') &&
      !moduleName.includes('stub')
    ) {
      return { type: 'sourceFile', filePath: stubPath };
    }

    // Screenshot-mode-only: stub expo-sqlite on web. The real package pulls in a
    // WASM artefact whose Metro resolution is brittle on rebuild; we never call
    // initDatabase() in screenshot mode, so a no-op shim is correct and safe.
    // Production builds (no EXPO_PUBLIC_SCREENSHOT_MODE) take the original path.
    if (
      process.env.EXPO_PUBLIC_SCREENSHOT_MODE === '1' &&
      platform === 'web' &&
      moduleName === 'expo-sqlite'
    ) {
      return {
        type: 'sourceFile',
        filePath: path.resolve(__dirname, 'src/screenshots/expoSqliteStub.web.js'),
      };
    }

    if (upstream) return upstream(context, moduleName, platform);
    return context.resolveRequest(context, moduleName, platform);
  };
}

module.exports = config;