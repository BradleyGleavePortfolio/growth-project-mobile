/**
 * IOS-RELEASE-129: the App Store submit profiles in eas.json.
 *
 * `eas submit --platform ios --profile production` and
 * `eas build --platform ios --profile clinic --auto-submit` (which looks for a
 * submit profile with the same name as the build profile) must both reach the
 * one App Store Connect app without prompting. eas.json is in a public repo,
 * so it carries no credential and no personal Apple ID: the App Store Connect
 * API key, signing and the push key stay in Expo.
 */
const fs = require('fs');
const path = require('path');
const { resolveProfile } = require('../eas-profile');

const ROOT = path.resolve(__dirname, '..', '..');
const eas = JSON.parse(fs.readFileSync(path.join(ROOT, 'eas.json'), 'utf8'));
const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8')).expo;

// Store build profiles (distribution "store"): each needs a same-named submit
// profile so --auto-submit never prompts or falls back to another app.
const STORE_BUILD_PROFILES = ['production', 'clinic'];

// Keys that hold or point to Apple / Google credentials or a personal login.
const CREDENTIAL_KEY = /appleId|ascApiKey|serviceAccountKey|password|secret|token|\.p8/i;

function resolveSubmit(name, seen = []) {
  const own = (eas.submit || {})[name];
  if (!own || typeof own !== 'object') {
    throw new Error(`eas.json has no submit profile "${name}"`);
  }
  if (seen.includes(name)) throw new Error(`submit profiles extend in a loop: ${[...seen, name].join(' -> ')}`);
  const parent = own.extends ? resolveSubmit(own.extends, [...seen, name]) : {};
  const { extends: _ignored, ...rest } = own;
  return { ...parent, ...rest, ios: { ...(parent.ios || {}), ...(rest.ios || {}) } };
}

function keysDeep(value, out = []) {
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      keysDeep(v, out);
    }
  }
  return out;
}

describe('eas.json submit profiles (IOS-RELEASE-129)', () => {
  const appStoreId = (String(app.extra.storeListings.appStoreUrl).match(/\/id(\d+)$/) || [])[1];

  it('the App Store listing id is known', () => {
    expect(appStoreId).toMatch(/^\d{9,10}$/);
  });

  it.each(STORE_BUILD_PROFILES)('build profile %s is a store build with a same-named submit profile for that app', (name) => {
    expect(resolveProfile(eas, name).distribution).toBe('store');
    const submit = resolveSubmit(name);
    expect(submit.ios.ascAppId).toBe(appStoreId);
  });

  it('carries no credential, key path or personal Apple ID', () => {
    const keys = keysDeep(eas.submit);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((k) => CREDENTIAL_KEY.test(k))).toEqual([]);
    expect(JSON.stringify(eas.submit)).not.toMatch(/@|BEGIN PRIVATE KEY|\.p8/);
  });
});
