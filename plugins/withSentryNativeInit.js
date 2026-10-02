/**
 * Sentry native initialization before JavaScript loads (pre-JS crash capture).
 *
 * Why: with @sentry/react-native 7.x the native SDKs start only when
 * `Sentry.init()` runs in JavaScript (src/services/sentry.ts). A crash while
 * native modules register, while the JS bundle loads, or in early bridge
 * setup happened before that and was invisible (found in the 10-01 Android
 * launch-crash hunt: the Crisp module crash never reached Sentry). The
 * official `useNativeInit` option needs SDK 8, and Expo SDK 56 pins
 * @sentry/react-native ~7.11.0, so this plugin starts the native SDKs that
 * 7.11 already ships (sentry-cocoa 8.58 via the `Sentry` pod, sentry-android
 * 8.31) directly:
 *   - iOS: `SentrySDK.start { ... }` first thing in
 *     `application(_:didFinishLaunchingWithOptions:)` (before the React Native
 *     factory is created).
 *   - Android: `SentryAndroid.init(this, ...)` right after
 *     `super.onCreate()` in MainApplication (before `loadReactNative`).
 * When JS later calls `Sentry.init()`, the React Native SDK re-initializes
 * the native SDK with the JS options (same behaviour as SDK 8's
 * RNSentrySDK), so post-JS events are unchanged.
 *
 * Privacy (no PII): `sendDefaultPii` off, no screenshots, no view hierarchy,
 * no network breadcrumbs or failed-request events (URLs), no native
 * performance tracing (JS owns tracing). No user is set before JS; health
 * data and message content never exist in native code at this point.
 *
 * Config, same sources as the JS init so pre-JS and post-JS events share a
 * release and environment:
 *   - DSN: EXPO_PUBLIC_SENTRY_DSN, else expo.extra.sentryDsn. Neither set:
 *     nothing is added (Sentry stays off, as in JS).
 *   - environment: EXPO_PUBLIC_ENVIRONMENT, else "production".
 *   - release: `<version>+<ios.buildNumber>` / `<version>+<android.versionCode>`
 *     (the same string `buildReleaseId()` reports from JS).
 *   - TGP_SENTRY_NATIVE_INIT=0 skips native init (build-time kill switch).
 * A DSN, environment or release that is not a safe literal fails prebuild with
 * a message that says how to fix it; so does an AppDelegate / MainApplication
 * the plugin cannot patch (a silent no-op is the defect this fixes).
 */
'use strict';
/* eslint-disable @typescript-eslint/no-var-requires -- CommonJS config plugin */
const { withAppDelegate, withMainApplication } = require('expo/config-plugins');

const MARK_BEGIN = '// @generated begin tgp-sentry-native-init';
const MARK_END = '// @generated end tgp-sentry-native-init';
const DSN_RE = /^https:\/\/[A-Za-z0-9]+@[A-Za-z0-9.-]+(?::\d{1,5})?(?:\/[A-Za-z0-9._-]+)*\/\d+$/;
const ENV_RE = /^[A-Za-z0-9._-]{1,64}$/;
const RELEASE_RE = /^[A-Za-z0-9._+-]{1,200}$/;

/**
 * Native options for one platform, or null when Sentry is not configured or
 * native init is switched off. Throws on a value that is not a safe literal.
 */
function resolveNativeOptions(config, platform, env = process.env) {
  if (String(env.TGP_SENTRY_NATIVE_INIT || '').trim() === '0') return null;
  const rawDsn = env.EXPO_PUBLIC_SENTRY_DSN || (config.extra && config.extra.sentryDsn);
  const dsn = typeof rawDsn === 'string' ? rawDsn.trim() : '';
  if (!dsn) return null;
  if (!DSN_RE.test(dsn)) {
    throw new Error(
      'withSentryNativeInit: EXPO_PUBLIC_SENTRY_DSN (or expo.extra.sentryDsn) is not a Sentry DSN of the form https://<key>@<host>/<project-id> (value not printed). Fix: copy the DSN from Sentry → Project Settings → Client Keys into the EAS environment, then rebuild.',
    );
  }
  const environment = String(env.EXPO_PUBLIC_ENVIRONMENT || 'production').trim();
  if (!ENV_RE.test(environment)) {
    throw new Error(
      `withSentryNativeInit: EXPO_PUBLIC_ENVIRONMENT ${JSON.stringify(environment)} must be 1-64 letters, digits, dot, dash or underscore. Fix: set it to e.g. "production" or "preview", then rebuild.`,
    );
  }
  const version = config.version;
  const build =
    platform === 'ios'
      ? config.ios && config.ios.buildNumber
      : config.android && config.android.versionCode != null
        ? String(config.android.versionCode)
        : undefined;
  const release = version ? (build ? `${version}+${build}` : String(version)) : undefined;
  if (release !== undefined && !RELEASE_RE.test(release)) {
    throw new Error(
      `withSentryNativeInit: release ${JSON.stringify(release)} (from expo.version and the ${platform} build number) has characters that cannot be used. Fix: use digits and dots in app.json version / buildNumber / versionCode.`,
    );
  }
  return { dsn, environment, release };
}

function swiftBlock(o, indent) {
  const lines = [
    MARK_BEGIN,
    '// Native crash capture before JavaScript loads; Sentry.init() in JS re-initializes it.',
    'SentrySDK.start { options in',
    `  options.dsn = "${o.dsn}"`,
    ...(o.release ? [`  options.releaseName = "${o.release}"`] : []),
    `  options.environment = "${o.environment}"`,
    '  options.sendDefaultPii = false',
    '  options.attachScreenshot = false',
    '  options.attachViewHierarchy = false',
    '  options.enableNetworkBreadcrumbs = false',
    '  options.enableCaptureFailedRequests = false',
    '  options.enableAutoPerformanceTracing = false',
    '}',
    MARK_END,
  ];
  return lines.map((l) => indent + l).join('\n');
}

function kotlinBlock(o, indent) {
  const lines = [
    MARK_BEGIN,
    '// Native crash capture before JavaScript loads; Sentry.init() in JS re-initializes it.',
    'SentryAndroid.init(this, Sentry.OptionsConfiguration<SentryAndroidOptions> { options ->',
    `  options.setDsn("${o.dsn}")`,
    ...(o.release ? [`  options.setRelease("${o.release}")`] : []),
    `  options.setEnvironment("${o.environment}")`,
    '  options.setSendDefaultPii(false)',
    '  options.setAttachScreenshot(false)',
    '  options.setAttachViewHierarchy(false)',
    '  options.setEnableNetworkEventBreadcrumbs(false)',
    '})',
    MARK_END,
  ];
  return lines.map((l) => indent + l).join('\n');
}

function stripBlock(contents) {
  // The block plus the blank line the iOS insert adds after it.
  const re = new RegExp(`[ \\t]*${MARK_BEGIN}[\\s\\S]*?${MARK_END}\\n(?:[ \\t]*\\n)?`, 'g');
  return contents.replace(re, '');
}

/** Insert lines after the last top-level `import` line (Swift or Kotlin). */
function addAfterLastImport(src, lines) {
  const re = /^(?:internal |public |@_implementationOnly )?import [^\n]+$/gm;
  let last = null;
  for (let m = re.exec(src); m; m = re.exec(src)) last = m;
  if (!last) {
    throw new Error('withSentryNativeInit: no import line found in the native entry file. Fix: update plugins/withSentryNativeInit.js for the new template.');
  }
  const at = last.index + last[0].length;
  return `${src.slice(0, at)}\n${lines.join('\n')}${src.slice(at)}`;
}

/** Insert (or replace) the iOS block; Swift AppDelegate only. */
function addIosNativeInit(contents, o, language = 'swift') {
  if (language !== 'swift') {
    throw new Error(
      `withSentryNativeInit: AppDelegate is ${language}, but this plugin patches the Swift AppDelegate of Expo SDK 56. Fix: update plugins/withSentryNativeInit.js for this template.`,
    );
  }
  let src = stripBlock(contents);
  const re = /(func application\(\s*_ application: UIApplication,\s*didFinishLaunchingWithOptions[^)]*\)\s*->\s*Bool\s*\{[ \t]*\n)([ \t]*)/;
  if (!re.test(src)) {
    throw new Error(
      'withSentryNativeInit: could not find application(_:didFinishLaunchingWithOptions:) in AppDelegate.swift, so native Sentry init would be missing. Fix: update the anchor in plugins/withSentryNativeInit.js for the new template.',
    );
  }
  src = src.replace(re, (_m, head, indent) => `${head}${swiftBlock(o, indent)}\n\n${indent}`);
  if (!/^import Sentry$/m.test(src)) src = addAfterLastImport(src, ['import Sentry']);
  return src;
}

/** Insert (or replace) the Android block; Kotlin MainApplication only. */
function addAndroidNativeInit(contents, o, language = 'kt') {
  if (language !== 'kt') {
    throw new Error(
      `withSentryNativeInit: MainApplication is ${language}, but this plugin patches the Kotlin MainApplication of Expo SDK 56. Fix: update plugins/withSentryNativeInit.js for this template.`,
    );
  }
  let src = stripBlock(contents);
  const re = /(override fun onCreate\(\)\s*\{\s*\n([ \t]*)super\.onCreate\(\)[ \t]*\n)/;
  if (!re.test(src)) {
    throw new Error(
      'withSentryNativeInit: could not find super.onCreate() in MainApplication.onCreate(), so native Sentry init would be missing. Fix: update the anchor in plugins/withSentryNativeInit.js for the new template.',
    );
  }
  src = src.replace(re, (_m, head, indent) => `${head}${kotlinBlock(o, indent)}\n`);
  const missing = ['io.sentry.Sentry', 'io.sentry.android.core.SentryAndroid', 'io.sentry.android.core.SentryAndroidOptions'].filter(
    (imp) => !src.split('\n').some((line) => line.trim() === `import ${imp}`),
  );
  if (missing.length) src = addAfterLastImport(src, missing.map((imp) => `import ${imp}`));
  return src;
}

const withSentryNativeInit = (config) => {
  config = withAppDelegate(config, (cfg) => {
    const o = resolveNativeOptions(cfg, 'ios');
    if (o) cfg.modResults.contents = addIosNativeInit(cfg.modResults.contents, o, cfg.modResults.language);
    return cfg;
  });
  config = withMainApplication(config, (cfg) => {
    const o = resolveNativeOptions(cfg, 'android');
    if (o) cfg.modResults.contents = addAndroidNativeInit(cfg.modResults.contents, o, cfg.modResults.language);
    return cfg;
  });
  return config;
};

module.exports = withSentryNativeInit;
module.exports.resolveNativeOptions = resolveNativeOptions;
module.exports.addIosNativeInit = addIosNativeInit;
module.exports.addAndroidNativeInit = addAndroidNativeInit;
module.exports.MARK_BEGIN = MARK_BEGIN;
