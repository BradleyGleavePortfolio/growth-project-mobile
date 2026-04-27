#!/usr/bin/env node
/**
 * Static validator for app.json + .env.example.
 *
 * Catches the things that silently break a release:
 *   - missing custom scheme (deep links never fire)
 *   - missing Android intent filter for app.tgp.com (universal links broken)
 *   - missing iOS associatedDomains entry (universal links broken)
 *   - mismatched package id / bundle id
 *   - required EXPO_PUBLIC_* vars missing from .env.example
 *   - stale Google client ID env vars present (Supabase brokers OAuth, no
 *     per-platform client ID belongs in the mobile build)
 *
 * Designed to run pre-build and in CI. No deps beyond Node fs/path.
 *
 * Usage:
 *   node scripts/validate-app-config.js          # exits non-zero on failure
 *   node scripts/validate-app-config.js --json   # machine-readable output
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_JSON = path.join(ROOT, 'app.json');
const ENV_EXAMPLE = path.join(ROOT, '.env.example');

const EXPECTED = {
  scheme: 'tgp',
  androidPackage: 'com.growthproject.app',
  iosBundleId: 'com.growthproject.app',
  universalLinkHost: 'app.tgp.com',
  invitePathPrefix: '/join',
  associatedDomain: 'applinks:app.tgp.com',
};

const REQUIRED_ENV = [
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  'EXPO_PUBLIC_API_URL',
];

// These vars used to exist; auth is now Supabase-brokered, so any reference
// to them in .env.example is stale and confuses release engineers about which
// values they need to provision in EAS Secrets.
const FORBIDDEN_ENV_KEYS = [
  'EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS',
  'EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID',
];

const errors = [];
const warnings = [];

function fail(msg) {
  errors.push(msg);
}

function warn(msg) {
  warnings.push(msg);
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    fail(`could not read or parse ${path.relative(ROOT, p)}: ${e.message}`);
    return null;
  }
}

function validateAppJson(app) {
  if (!app) return;
  const expo = app.expo || {};

  if (expo.scheme !== EXPECTED.scheme) {
    fail(
      `app.json: expo.scheme is ${JSON.stringify(expo.scheme)}, expected ${JSON.stringify(EXPECTED.scheme)} — custom scheme deep links will not fire`,
    );
  }

  // iOS
  const ios = expo.ios || {};
  if (ios.bundleIdentifier !== EXPECTED.iosBundleId) {
    fail(
      `app.json: expo.ios.bundleIdentifier is ${JSON.stringify(ios.bundleIdentifier)}, expected ${JSON.stringify(EXPECTED.iosBundleId)}`,
    );
  }
  const associated = ios.associatedDomains || [];
  if (!associated.includes(EXPECTED.associatedDomain)) {
    fail(
      `app.json: expo.ios.associatedDomains missing ${JSON.stringify(EXPECTED.associatedDomain)} — iOS universal links to ${EXPECTED.universalLinkHost} will not verify`,
    );
  }

  // Android
  const android = expo.android || {};
  if (android.package !== EXPECTED.androidPackage) {
    fail(
      `app.json: expo.android.package is ${JSON.stringify(android.package)}, expected ${JSON.stringify(EXPECTED.androidPackage)}`,
    );
  }
  if (android.package !== ios.bundleIdentifier) {
    fail(
      `app.json: android.package (${android.package}) and ios.bundleIdentifier (${ios.bundleIdentifier}) must match for AASA / assetlinks templating`,
    );
  }
  if (typeof android.versionCode !== 'number' || android.versionCode < 1) {
    fail(
      `app.json: expo.android.versionCode must be a positive integer, got ${JSON.stringify(android.versionCode)}`,
    );
  }

  const filters = android.intentFilters || [];
  const httpsFilter = filters.find((f) =>
    (f.data || []).some(
      (d) => d.scheme === 'https' && d.host === EXPECTED.universalLinkHost,
    ),
  );
  if (!httpsFilter) {
    fail(
      `app.json: no Android intent filter declares https://${EXPECTED.universalLinkHost} — App Links to the universal link domain will not verify`,
    );
  } else {
    if (!httpsFilter.autoVerify) {
      fail(
        `app.json: Android intent filter for ${EXPECTED.universalLinkHost} must set autoVerify: true`,
      );
    }
    const hasJoinPath = (httpsFilter.data || []).some(
      (d) =>
        d.scheme === 'https' &&
        d.host === EXPECTED.universalLinkHost &&
        (d.pathPrefix === EXPECTED.invitePathPrefix || d.path === EXPECTED.invitePathPrefix),
    );
    if (!hasJoinPath) {
      fail(
        `app.json: https intent filter for ${EXPECTED.universalLinkHost} missing pathPrefix ${JSON.stringify(EXPECTED.invitePathPrefix)} — invite deep link will not match`,
      );
    }
  }

  const customSchemeFilter = filters.find((f) =>
    (f.data || []).some((d) => d.scheme === EXPECTED.scheme),
  );
  if (!customSchemeFilter) {
    fail(
      `app.json: no Android intent filter declares scheme ${JSON.stringify(EXPECTED.scheme)} — tgp:// links will not open the app`,
    );
  }

  // Plugins required for current behavior
  const plugins = expo.plugins || [];
  const flatPluginNames = plugins.map((p) => (Array.isArray(p) ? p[0] : p));
  const requiredPlugins = ['expo-sqlite', 'expo-web-browser', 'expo-font'];
  for (const name of requiredPlugins) {
    if (!flatPluginNames.includes(name)) {
      warn(`app.json: expo.plugins missing ${name} — feature may not initialise on device`);
    }
  }
}

function validateEnvExample() {
  if (!fs.existsSync(ENV_EXAMPLE)) {
    fail('.env.example: missing — release engineers will not know which vars to provision in EAS');
    return;
  }
  const text = fs.readFileSync(ENV_EXAMPLE, 'utf8');
  const declaredKeys = new Set();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=/.exec(line);
    if (m) declaredKeys.add(m[1]);
  }

  for (const key of REQUIRED_ENV) {
    if (!declaredKeys.has(key)) {
      fail(`.env.example: missing required key ${key}`);
    }
  }

  for (const key of FORBIDDEN_ENV_KEYS) {
    // Only flag if it's an actual key=... line (a comment mentioning the
    // var by name as part of an explanation is fine and we explicitly want
    // to allow that — see .env.example trailer note).
    if (declaredKeys.has(key)) {
      fail(
        `.env.example: stale key ${key} declared — auth is brokered through Supabase, this var is no longer read by the codebase. Remove the assignment (the explanatory comment can stay).`,
      );
    }
  }
}

function validateLinkingTemplates() {
  const dir = path.join(ROOT, 'docs', 'well-known');
  const al = path.join(dir, 'assetlinks.json');
  const aasa = path.join(dir, 'apple-app-site-association');
  if (!fs.existsSync(al)) {
    warn('docs/well-known/assetlinks.json missing — Android App Link hosting template should be checked in');
    return;
  }
  if (!fs.existsSync(aasa)) {
    warn('docs/well-known/apple-app-site-association missing — iOS Universal Link hosting template should be checked in');
    return;
  }
  // Light parse — confirm package_name + bundle id match app.json values.
  try {
    const al_doc = JSON.parse(fs.readFileSync(al, 'utf8'));
    const pkgs = al_doc
      .map((s) => s && s.target && s.target.package_name)
      .filter(Boolean);
    if (!pkgs.includes(EXPECTED.androidPackage)) {
      fail(
        `docs/well-known/assetlinks.json: package_name does not include ${EXPECTED.androidPackage}`,
      );
    }
  } catch (e) {
    fail(`docs/well-known/assetlinks.json: invalid JSON — ${e.message}`);
  }
  try {
    const aasa_doc = JSON.parse(fs.readFileSync(aasa, 'utf8'));
    const detail = (aasa_doc.applinks && aasa_doc.applinks.details) || [];
    const allIds = detail.flatMap((d) => d.appIDs || []);
    const matchesBundle = allIds.some((id) => id.endsWith(`.${EXPECTED.iosBundleId}`));
    if (!matchesBundle) {
      fail(
        `docs/well-known/apple-app-site-association: no appID ends with .${EXPECTED.iosBundleId}`,
      );
    }
  } catch (e) {
    fail(`docs/well-known/apple-app-site-association: invalid JSON — ${e.message}`);
  }
}

function main() {
  const app = readJson(APP_JSON);
  validateAppJson(app);
  validateEnvExample();
  validateLinkingTemplates();

  const asJson = process.argv.includes('--json');
  if (asJson) {
    const ok = errors.length === 0;
    process.stdout.write(JSON.stringify({ ok, errors, warnings }, null, 2) + '\n');
    process.exit(ok ? 0 : 1);
  }

  if (warnings.length) {
    for (const w of warnings) console.warn(`warn: ${w}`);
  }
  if (errors.length) {
    for (const e of errors) console.error(`error: ${e}`);
    console.error(`\nvalidate-app-config: ${errors.length} error(s), ${warnings.length} warning(s)`);
    process.exit(1);
  }
  console.log(`validate-app-config: OK${warnings.length ? ` (${warnings.length} warning(s))` : ''}`);
}

main();
