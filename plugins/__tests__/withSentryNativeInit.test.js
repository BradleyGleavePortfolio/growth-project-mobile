/**
 * plugins/withSentryNativeInit.js: native Sentry init before JS loads.
 * Fixtures are the Expo SDK 56 bare-minimum templates (expo/expo@sdk-56
 * templates/expo-template-bare-minimum) that `expo prebuild` starts from.
 */
const fs = require('fs');
const path = require('path');
const plugin = require('../withSentryNativeInit');

const FIX = path.join(__dirname, 'fixtures');
const APP_DELEGATE = fs.readFileSync(path.join(FIX, 'AppDelegate.sdk56.swift'), 'utf8');
const MAIN_APPLICATION = fs.readFileSync(path.join(FIX, 'MainApplication.sdk56.kt'), 'utf8');
const DSN = 'https://0123456789abcdef0123456789abcdef@o123.ingest.us.sentry.io/4507';
const APP = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'app.json'), 'utf8')).expo;
const OPTS = { dsn: DSN, environment: 'production', release: '1.0.0+6' };

describe('resolveNativeOptions', () => {
  it('uses the same DSN, environment and release as the JS init', () => {
    const cfg = { version: '1.0.0', ios: { buildNumber: '6' }, android: { versionCode: 4 } };
    expect(plugin.resolveNativeOptions(cfg, 'ios', { EXPO_PUBLIC_SENTRY_DSN: DSN })).toEqual({ dsn: DSN, environment: 'production', release: '1.0.0+6' });
    expect(plugin.resolveNativeOptions(cfg, 'android', { EXPO_PUBLIC_SENTRY_DSN: DSN, EXPO_PUBLIC_ENVIRONMENT: 'preview' })).toEqual({ dsn: DSN, environment: 'preview', release: '1.0.0+4' });
    expect(plugin.resolveNativeOptions({ ...cfg, extra: { sentryDsn: DSN } }, 'ios', {})).toMatchObject({ dsn: DSN });
  });

  it('the repo app.json resolves (release from version + build number)', () => {
    const o = plugin.resolveNativeOptions(APP, 'ios', { EXPO_PUBLIC_SENTRY_DSN: DSN });
    expect(o.release).toBe(`${APP.version}+${APP.ios.buildNumber}`);
  });

  it('adds nothing when no DSN is configured (Sentry stays off, as in JS) or the kill switch is 0', () => {
    expect(plugin.resolveNativeOptions(APP, 'ios', {})).toBeNull();
    expect(plugin.resolveNativeOptions(APP, 'ios', { EXPO_PUBLIC_SENTRY_DSN: '  ' })).toBeNull();
    expect(plugin.resolveNativeOptions(APP, 'android', { EXPO_PUBLIC_SENTRY_DSN: DSN, TGP_SENTRY_NATIVE_INIT: '0' })).toBeNull();
  });

  it.each([
    ['a placeholder', 'your_sentry_dsn_here'],
    ['http', 'http://abc@o1.ingest.sentry.io/1'],
    ['a quote (code injection)', 'https://abc@o1.ingest.sentry.io/1"); evil("'],
    ['a missing project id', 'https://abc@o1.ingest.sentry.io/'],
  ])('fails prebuild on a DSN that is %s, without printing it', (_label, dsn) => {
    expect(() => plugin.resolveNativeOptions(APP, 'ios', { EXPO_PUBLIC_SENTRY_DSN: dsn })).toThrow(/not a Sentry DSN .*value not printed/);
    try {
      plugin.resolveNativeOptions(APP, 'ios', { EXPO_PUBLIC_SENTRY_DSN: dsn });
    } catch (e) {
      expect(e.message).not.toContain(dsn);
    }
  });

  it('fails prebuild on an unsafe environment name', () => {
    expect(() => plugin.resolveNativeOptions(APP, 'ios', { EXPO_PUBLIC_SENTRY_DSN: DSN, EXPO_PUBLIC_ENVIRONMENT: 'prod"uction' })).toThrow(/EXPO_PUBLIC_ENVIRONMENT/);
  });
});

describe('iOS AppDelegate.swift (SDK 56 template)', () => {
  const out = plugin.addIosNativeInit(APP_DELEGATE, OPTS, 'swift');

  it('imports Sentry and starts it first in didFinishLaunching, before the React Native factory', () => {
    expect(out).toMatch(/^import Sentry$/m);
    const start = out.indexOf('SentrySDK.start { options in');
    expect(start).toBeGreaterThan(out.indexOf('didFinishLaunchingWithOptions'));
    expect(start).toBeLessThan(out.indexOf('let factory = ExpoReactNativeFactory'));
    expect(start).toBeLessThan(out.indexOf('factory.startReactNative'));
  });

  it('sets DSN, release and environment and turns every PII-bearing capture off', () => {
    for (const line of [
      `options.dsn = "${DSN}"`,
      'options.releaseName = "1.0.0+6"',
      'options.environment = "production"',
      'options.sendDefaultPii = false',
      'options.attachScreenshot = false',
      'options.attachViewHierarchy = false',
      'options.enableNetworkBreadcrumbs = false',
      'options.enableCaptureFailedRequests = false',
      'options.enableAutoPerformanceTracing = false',
    ]) {
      expect(out).toContain(line);
    }
    expect(out).not.toMatch(/sendDefaultPii = true|attachScreenshot = true|setUser/);
  });

  it('is idempotent (prebuild twice) and otherwise leaves the template unchanged', () => {
    expect(plugin.addIosNativeInit(out, OPTS, 'swift')).toBe(out);
    expect(plugin.removeNativeInit(out, 'ios')).toBe(APP_DELEGATE);
  });

  it('fails loudly when the anchor is gone or the AppDelegate is Objective-C', () => {
    expect(() => plugin.addIosNativeInit('import UIKit\nclass X {}\n', OPTS, 'swift')).toThrow(/didFinishLaunchingWithOptions/);
    expect(() => plugin.addIosNativeInit(APP_DELEGATE, OPTS, 'objc')).toThrow(/Swift AppDelegate/);
  });
});

describe('Android MainApplication.kt (SDK 56 template)', () => {
  const out = plugin.addAndroidNativeInit(MAIN_APPLICATION, OPTS, 'kt');

  it('initializes SentryAndroid right after super.onCreate(), before loadReactNative', () => {
    const init = out.indexOf('SentryAndroid.init(this, Sentry.OptionsConfiguration<SentryAndroidOptions> { options ->');
    expect(init).toBeGreaterThan(out.indexOf('super.onCreate()'));
    expect(init).toBeLessThan(out.indexOf('loadReactNative(this)'));
    expect(init).toBeLessThan(out.indexOf('ApplicationLifecycleDispatcher.onApplicationCreate'));
    for (const imp of ['io.sentry.Sentry', 'io.sentry.android.core.SentryAndroid', 'io.sentry.android.core.SentryAndroidOptions']) {
      expect(out.split('\n')).toContain(`import ${imp}`);
    }
  });

  it('sets DSN, release and environment and turns PII-bearing capture off', () => {
    for (const line of [
      `options.setDsn("${DSN}")`,
      'options.setRelease("1.0.0+6")',
      'options.setEnvironment("production")',
      'options.setSendDefaultPii(false)',
      'options.setAttachScreenshot(false)',
      'options.setAttachViewHierarchy(false)',
      'options.setEnableNetworkEventBreadcrumbs(false)',
    ]) {
      expect(out).toContain(line);
    }
  });

  it('is idempotent and fails loudly without the anchor or on Java', () => {
    expect(plugin.addAndroidNativeInit(out, OPTS, 'kt')).toBe(out);
    expect(plugin.removeNativeInit(out, 'android')).toBe(MAIN_APPLICATION);
    expect(() => plugin.addAndroidNativeInit('package a\nimport b\nclass A\n', OPTS, 'kt')).toThrow(/super\.onCreate\(\)/);
    expect(() => plugin.addAndroidNativeInit(MAIN_APPLICATION, OPTS, 'java')).toThrow(/Kotlin MainApplication/);
  });
});

/**
 * B-330-4: run the mods the plugin actually registers (as expo prebuild
 * does) through enabled -> disabled -> enabled. An incremental prebuild
 * re-reads the previous output, so disabling must remove what enabling wrote.
 */
// Save and restore single keys: reassigning process.env in a jest-expo test
// detaches it from the env object babel-preset-expo rewrites EXPO_PUBLIC_*
// accesses to, so the plugin would read a different object than the test set.
const ENV_KEYS = ['EXPO_PUBLIC_SENTRY_DSN', 'TGP_SENTRY_NATIVE_INIT'];
function setEnv(values) {
  for (const k of ENV_KEYS) {
    if (values[k] === undefined) delete process.env[k];
    else process.env[k] = values[k];
  }
}
const SAVED_ENV = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

describe('registered mods reconcile on every prebuild (B-330-4)', () => {
  beforeEach(() => setEnv({ EXPO_PUBLIC_SENTRY_DSN: DSN }));
  afterEach(() => setEnv(SAVED_ENV));

  async function runMod(platform, contents) {
    const cfg = plugin({ ...APP, mods: {} });
    const key = platform === 'ios' ? 'appDelegate' : 'mainApplication';
    const result = await cfg.mods[platform][key]({
      ...cfg,
      modRequest: {},
      modResults: { contents, language: platform === 'ios' ? 'swift' : 'kt' },
    });
    return result.modResults.contents;
  }

  const disable = {
    'kill switch': () => setEnv({ EXPO_PUBLIC_SENTRY_DSN: DSN, TGP_SENTRY_NATIVE_INIT: '0' }),
    'DSN removed': () => setEnv({}),
  };

  for (const [platform, template, marker] of [
    ['ios', APP_DELEGATE, 'SentrySDK.start'],
    ['android', MAIN_APPLICATION, 'SentryAndroid.init'],
  ]) {
    for (const [how, apply] of Object.entries(disable)) {
      it(`${platform}: ${how} removes the generated initializer, its DSN and its imports; re-enabling restores it`, async () => {
        const enabled = await runMod(platform, template);
        expect(enabled).toContain(marker);
        expect(enabled).toContain(DSN);
        apply();
        const disabled = await runMod(platform, enabled);
        expect(disabled).toBe(template);
        expect(disabled).not.toContain(marker);
        expect(disabled).not.toContain(DSN);
        expect(disabled).not.toContain('tgp-sentry');
        expect(await runMod(platform, disabled)).toBe(template);
        setEnv({ EXPO_PUBLIC_SENTRY_DSN: DSN });
        expect(await runMod(platform, disabled)).toBe(enabled);
      });
    }
  }

  it('imports the file already had are never removed (only the owned block is)', async () => {
    const withOwnImport = APP_DELEGATE.replace('import React\n', 'import React\nimport Sentry\n');
    const enabled = await runMod('ios', withOwnImport);
    expect(enabled).not.toContain(plugin.IMPORTS_BEGIN);
    expect(enabled.split('\n').filter((l) => l === 'import Sentry')).toHaveLength(1);
    setEnv({ EXPO_PUBLIC_SENTRY_DSN: DSN, TGP_SENTRY_NATIVE_INIT: '0' });
    expect(await runMod('ios', enabled)).toBe(withOwnImport);
  });

  it('an unterminated generated block fails prebuild instead of deleting the rest of the file', () => {
    const broken = APP_DELEGATE.replace('import React\n', `import React\n${plugin.MARK_BEGIN}\n`);
    expect(() => plugin.removeNativeInit(broken, 'ios')).toThrow(/no end marker/);
  });
});

/**
 * B-330-3 (Android): the React Native SDK re-initializes SentryAndroid from
 * JS with fresh options and no mapping for network-event breadcrumbs, but
 * SentryAndroid applies manifest metadata on every init, so the flag keeps
 * the pre-JS suppression after JS starts.
 */
describe('AndroidManifest network-events flag (B-330-3)', () => {
  afterEach(() => setEnv(SAVED_ENV));
  const manifest = () => ({
    manifest: { $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' }, application: [{ $: { 'android:name': '.MainApplication' } }] },
  });
  async function runManifestMod(input) {
    const cfg = plugin({ ...APP, mods: {} });
    const result = await cfg.mods.android.manifest({ ...cfg, modRequest: {}, modResults: input });
    return result.modResults;
  }
  const flags = (m) => (m.manifest.application[0]['meta-data'] || []).filter((d) => d.$['android:name'] === plugin.NETWORK_EVENTS_META);

  it.each([
    ['DSN set', { EXPO_PUBLIC_SENTRY_DSN: DSN }],
    ['kill switch (JS init still runs)', { EXPO_PUBLIC_SENTRY_DSN: DSN, TGP_SENTRY_NATIVE_INIT: '0' }],
    ['no DSN', {}],
  ])('%s: io.sentry.breadcrumbs.network-events=false is set exactly once, idempotently', async (_label, env) => {
    setEnv(env);
    const once = await runManifestMod(manifest());
    expect(flags(once)).toEqual([{ $: { 'android:name': 'io.sentry.breadcrumbs.network-events', 'android:value': 'false' } }]);
    const twice = await runManifestMod(once);
    expect(flags(twice)).toHaveLength(1);
  });
});

describe('app.json registration', () => {
  it('the plugin runs after the Sentry SDK plugins', () => {
    const names = APP.plugins.map((p) => (Array.isArray(p) ? p[0] : p));
    const at = names.indexOf('./plugins/withSentryNativeInit');
    expect(at).toBeGreaterThan(names.indexOf('@sentry/react-native'));
    expect(at).toBeGreaterThan(names.indexOf('@sentry/react-native/expo'));
  });
});
