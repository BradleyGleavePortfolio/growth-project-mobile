/**
 * CLINIC-APK-132 (owner 10-08: one last full Android APK with all the features
 * the iPhone build has today). The Android test app was built with the eas.json
 * `preview` profile, which lacks the clinic EXPO_PUBLIC_FF_* switches that the
 * iPhone build (`clinic`) turns on. `clinic-apk` extends `clinic`. EAS merges
 * `env` through `extends` (child values win; @expo/eas-json build/resolver.js
 * mergeProfiles), and so does scripts/eas-profile.js, which the config
 * validator, the update guard and the EAS pre-install release-env check share.
 */
const fs = require('fs');
const path = require('path');
const { resolveProfile } = require('../eas-profile');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const EAS = read('eas.json');
const APP = read('app.json').expo;
const LINK = 'EXPO_PUBLIC_FF_ANDROID_CREDIT_PACK_LINK';
const switches = (env) => Object.fromEntries(Object.entries(env).filter(([name]) => name.startsWith('EXPO_PUBLIC_FF_')));

describe('eas.json clinic-apk: the Android test APK with the iPhone feature set', () => {
  const clinic = resolveProfile(EAS, 'clinic');
  const apk = resolveProfile(EAS, 'clinic-apk');

  it("resolves to exactly clinic's EXPO_PUBLIC_FF_* switches plus the Android credit-pack link", () => {
    expect(Object.keys(switches(clinic.env)).length).toBeGreaterThan(10);
    expect(switches(clinic.env)).not.toHaveProperty(LINK);
    expect(switches(apk.env)).toEqual({ ...switches(clinic.env), [LINK]: 'true' });
    // Every other clinic value carries over too (Health Connect on, no mocks).
    expect(apk.env).toEqual({ ...clinic.env, [LINK]: 'true' });
    expect(apk.env.TGP_ANDROID_HEALTH_CONNECT).toBe('1');
  });

  it('is a directly installed APK on its own update channel in the production environment', () => {
    expect(EAS.build['clinic-apk'].extends).toBe('clinic');
    expect(apk).toMatchObject({
      distribution: 'internal',
      channel: 'clinic-apk',
      environment: 'production',
      android: { buildType: 'apk' },
    });
    expect(EAS.submit['clinic-apk']).toBeUndefined();
  });

  it('installs over the versionCode 5 test app; iOS build 7 and the store profiles keep the Android link off', () => {
    expect(APP.android.versionCode).toBe(6);
    expect(APP.ios.buildNumber).toBe('7');
    for (const name of ['production', 'clinic']) {
      const store = resolveProfile(EAS, name);
      expect(store.distribution).toBe('store');
      expect(store.env).not.toHaveProperty(LINK);
    }
  });
});
