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
 * Every prebuild reconciles the generated code (B-330-4): the plugin-owned
 * init block and import block are removed first and only re-added when the
 * options resolve, so switching the kill switch on or removing the DSN also
 * removes an initializer an earlier (incremental) prebuild wrote. Imports the
 * file already had outside the owned block are never touched.
 * Android also gets the manifest flag io.sentry.breadcrumbs.network-events =
 * false. SentryAndroid reads manifest metadata on every init, so the network
 * breadcrumb suppression survives the React Native SDK's re-init from JS,
 * which has no option for it (B-330-3). It is set whatever the DSN, since it
 * only matters when Sentry runs.
 * A DSN, environment or release that is not a safe literal fails prebuild with
 * a message that says how to fix it; so does an AppDelegate / MainApplication
 * the plugin cannot patch (a silent no-op is the defect this fixes).
 */
'use strict';
/* eslint-disable @typescript-eslint/no-var-requires -- CommonJS config plugin */
const { AndroidConfig, withAndroidManifest, withAppDelegate, withMainApplication } = require('expo/config-plugins');

const MARK_BEGIN = '// @generated begin tgp-sentry-native-init';
const MARK_END = '// @generated end tgp-sentry-native-init';
const IMPORTS_BEGIN = '// @generated begin tgp-sentry-native-imports';
const IMPORTS_END = '// @generated end tgp-sentry-native-imports';
const IOS_IMPORTS = ['Sentry'];
const ANDROID_IMPORTS = ['io.sentry.Sentry', 'io.sentry.android.core.SentryAndroid', 'io.sentry.android.core.SentryAndroidOptions'];
const NETWORK_EVENTS_META = 'io.sentry.breadcrumbs.network-events';
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

/**
 * Removes every plugin-owned block (init and imports), matching the marker
 * lines exactly, plus (iOS) the blank line the insert adds after the init
 * block. Text outside the markers is returned unchanged.
 */
function stripOwned(contents, blankAfterInit) {
  const lines = contents.split('\n');
  const out = [];
  let end = null;
  let dropBlankAfter = false;
  for (const line of lines) {
    const t = line.trim();
    if (end !== null) {
      if (t === end) {
        dropBlankAfter = blankAfterInit && end === MARK_END;
        end = null;
      }
      continue;
    }
    if (t === MARK_BEGIN || t === IMPORTS_BEGIN) {
      end = t === MARK_BEGIN ? MARK_END : IMPORTS_END;
      continue;
    }
    if (dropBlankAfter) {
      dropBlankAfter = false;
      if (t === '') continue;
    }
    out.push(line);
  }
  if (end !== null) {
    throw new Error(
      'withSentryNativeInit: a generated tgp-sentry block in the native entry file has no end marker. Fix: delete the ios/ and android/ folders and run expo prebuild --clean.',
    );
  }
  return out.join('\n');
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

/** Adds the imports the file lacks, inside the owned import block. */
function addOwnedImports(src, modules) {
  const present = new Set(
    src
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('import ')),
  );
  const missing = modules.filter((m) => !present.has(`import ${m}`));
  if (!missing.length) return src;
  return addAfterLastImport(src, [IMPORTS_BEGIN, ...missing.map((m) => `import ${m}`), IMPORTS_END]);
}

/**
 * Removes the plugin-owned init and import blocks (kill switch on, or no
 * DSN). Safe on any language: only exact marker lines are matched.
 */
function removeNativeInit(contents, platform) {
  return stripOwned(contents, platform === 'ios');
}

/** Insert (or replace) the iOS block; Swift AppDelegate only. */
function addIosNativeInit(contents, o, language = 'swift') {
  if (language !== 'swift') {
    throw new Error(
      `withSentryNativeInit: AppDelegate is ${language}, but this plugin patches the Swift AppDelegate of Expo SDK 56. Fix: update plugins/withSentryNativeInit.js for this template.`,
    );
  }
  let src = stripOwned(contents, true);
  const re = /(func application\(\s*_ application: UIApplication,\s*didFinishLaunchingWithOptions[^)]*\)\s*->\s*Bool\s*\{[ \t]*\n)([ \t]*)/;
  if (!re.test(src)) {
    throw new Error(
      'withSentryNativeInit: could not find application(_:didFinishLaunchingWithOptions:) in AppDelegate.swift, so native Sentry init would be missing. Fix: update the anchor in plugins/withSentryNativeInit.js for the new template.',
    );
  }
  src = src.replace(re, (_m, head, indent) => `${head}${swiftBlock(o, indent)}\n\n${indent}`);
  return addOwnedImports(src, IOS_IMPORTS);
}

/** Insert (or replace) the Android block; Kotlin MainApplication only. */
function addAndroidNativeInit(contents, o, language = 'kt') {
  if (language !== 'kt') {
    throw new Error(
      `withSentryNativeInit: MainApplication is ${language}, but this plugin patches the Kotlin MainApplication of Expo SDK 56. Fix: update plugins/withSentryNativeInit.js for this template.`,
    );
  }
  let src = stripOwned(contents, false);
  const re = /(override fun onCreate\(\)\s*\{\s*\n([ \t]*)super\.onCreate\(\)[ \t]*\n)/;
  if (!re.test(src)) {
    throw new Error(
      'withSentryNativeInit: could not find super.onCreate() in MainApplication.onCreate(), so native Sentry init would be missing. Fix: update the anchor in plugins/withSentryNativeInit.js for the new template.',
    );
  }
  src = src.replace(re, (_m, head, indent) => `${head}${kotlinBlock(o, indent)}\n`);
  return addOwnedImports(src, ANDROID_IMPORTS);
}

/** Sets io.sentry.breadcrumbs.network-events=false on the main application (idempotent). */
function setNetworkEventsMeta(manifest) {
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, NETWORK_EVENTS_META, 'false');
  return manifest;
}

const withSentryNativeInit = (config) => {
  // Every prebuild reconciles: enabled writes the block, disabled removes it (B-330-4).
  config = withAppDelegate(config, (cfg) => {
    const o = resolveNativeOptions(cfg, 'ios');
    cfg.modResults.contents = o
      ? addIosNativeInit(cfg.modResults.contents, o, cfg.modResults.language)
      : removeNativeInit(cfg.modResults.contents, 'ios');
    return cfg;
  });
  config = withMainApplication(config, (cfg) => {
    const o = resolveNativeOptions(cfg, 'android');
    cfg.modResults.contents = o
      ? addAndroidNativeInit(cfg.modResults.contents, o, cfg.modResults.language)
      : removeNativeInit(cfg.modResults.contents, 'android');
    return cfg;
  });
  config = withAndroidManifest(config, (cfg) => {
    cfg.modResults = setNetworkEventsMeta(cfg.modResults);
    return cfg;
  });
  return config;
};

module.exports = withSentryNativeInit;
module.exports.resolveNativeOptions = resolveNativeOptions;
module.exports.addIosNativeInit = addIosNativeInit;
module.exports.addAndroidNativeInit = addAndroidNativeInit;
module.exports.removeNativeInit = removeNativeInit;
module.exports.setNetworkEventsMeta = setNetworkEventsMeta;
module.exports.MARK_BEGIN = MARK_BEGIN;
module.exports.IMPORTS_BEGIN = IMPORTS_BEGIN;
module.exports.NETWORK_EVENTS_META = NETWORK_EVENTS_META;
