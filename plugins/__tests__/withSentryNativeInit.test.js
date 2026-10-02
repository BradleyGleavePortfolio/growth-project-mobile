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
    const stripped = out
      .replace(/^import Sentry\n/m, '')
      .replace(/[ \t]*\/\/ @generated begin tgp-sentry-native-init[\s\S]*?\/\/ @generated end tgp-sentry-native-init\n\n/, '');
    expect(stripped).toBe(APP_DELEGATE);
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
      expect(out).toMatch(new RegExp(`^import ${imp.replace(/\./g, '\\.')}$`, 'm'));
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
    expect(() => plugin.addAndroidNativeInit('package a\nimport b\nclass A\n', OPTS, 'kt')).toThrow(/super\.onCreate\(\)/);
    expect(() => plugin.addAndroidNativeInit(MAIN_APPLICATION, OPTS, 'java')).toThrow(/Kotlin MainApplication/);
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
