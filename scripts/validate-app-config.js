#!/usr/bin/env node
/**
 * Static validator for app.json + .env.example + the hosted-file templates.
 *
 * Catches the things that silently break a release:
 *   - missing custom scheme (deep links never fire)
 *   - missing Android intent filter for app.trygrowthproject.com (universal links broken)
 *   - missing iOS associatedDomains entry (universal links broken)
 *   - mismatched package id / bundle id
 *   - required EXPO_PUBLIC_* vars missing from .env.example
 *   - stale Google client ID env vars present (Supabase brokers OAuth, no
 *     per-platform client ID belongs in the mobile build)
 *   - expo-notifications missing from plugins (Android 13+ POST_NOTIFICATIONS
 *     never declared, push silently no-ops in production)
 *   - storeListings entries that are placeholder strings rather than real
 *     Play / App Store URLs (or explicit `null` to mean "not yet known")
 *
 * Two run modes:
 *   default        — pre-build / CI / local development. Templates are
 *                    allowed to contain REPLACE_WITH_* placeholders, store
 *                    URLs are allowed to be `null`. This mode catches drift
 *                    in the things that always have to be true.
 *   --release      — pre-publish gate. Hardens the rules above: any
 *                    REPLACE_WITH_* placeholder in a hosted file is a hard
 *                    error, and any storeListings.* set to `null` is a hard
 *                    error. Wire this into the release runbook (and any CI
 *                    job that builds production AABs) so a placeholder
 *                    cannot reach production by accident.
 *
 * Designed to run pre-build and in CI. No deps beyond Node fs/path.
 *
 * Usage:
 *   node scripts/validate-app-config.js              # exits non-zero on failure
 *   node scripts/validate-app-config.js --release    # adds the pre-publish gates
 *   node scripts/validate-app-config.js --json       # machine-readable output
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_JSON = path.join(ROOT, 'app.json');
const ENV_EXAMPLE = path.join(ROOT, '.env.example');

const RELEASE_MODE = process.argv.includes('--release');
const PLACEHOLDER_PATTERN = /REPLACE_WITH_[A-Z0-9_]+/;
const PLAY_STORE_URL_RE =
  /^https:\/\/play\.google\.com\/store\/apps\/details\?id=[A-Za-z0-9_.]+(&hl=[a-zA-Z-]+)?$/;
const APP_STORE_URL_RE =
  /^https:\/\/apps\.apple\.com\/[a-z]{2}\/app\/[A-Za-z0-9-]+\/id[0-9]+$/;

const EXPECTED = {
  scheme: 'tgp',
  androidPackage: 'com.growthproject.app',
  iosBundleId: 'com.growthproject.app',
  universalLinkHost: 'app.trygrowthproject.com',
  invitePathPrefix: '/join',
  associatedDomain: 'applinks:app.trygrowthproject.com',
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

  // expo-notifications must be a plugin entry (not just a runtime dependency)
  // so the config plugin runs at prebuild and injects the POST_NOTIFICATIONS
  // permission Android 13+ requires before requestPermissionsAsync() can
  // surface a runtime prompt. Without the plugin, calls to
  // scheduleNotificationAsync / setNotificationChannelAsync still succeed in
  // Expo Go but ship a release build that silently never shows a
  // notification — and Play review may also flag the missing manifest entry.
  const notificationsPluginEntry = plugins.find(
    (p) => (Array.isArray(p) ? p[0] : p) === 'expo-notifications',
  );
  if (!notificationsPluginEntry) {
    fail(
      'app.json: expo.plugins missing "expo-notifications" — Android 13+ POST_NOTIFICATIONS will not be declared, so notification permission prompts and channels silently no-op in production',
    );
  } else if (Array.isArray(notificationsPluginEntry)) {
    const cfg = notificationsPluginEntry[1] || {};
    if (cfg.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(cfg.color)) {
      fail(
        `app.json: expo-notifications plugin "color" must be a 6-digit hex string, got ${JSON.stringify(cfg.color)}`,
      );
    }
    if (cfg.icon !== undefined) {
      const iconPath = path.resolve(ROOT, cfg.icon);
      if (!fs.existsSync(iconPath)) {
        fail(
          `app.json: expo-notifications plugin "icon" points to ${cfg.icon}, which does not exist on disk`,
        );
      }
    }
  }
}

function validateStoreListings(app) {
  // expo.extra.storeListings is a small contract held by this validator.
  // Either set the URL to a real Play / App Store listing, or set it to
  // `null` to mean "not yet known". Any string that does not match the
  // canonical store URL shape is treated as an accidental placeholder and
  // failed loudly — this is the lever that prevents a fake URL from
  // shipping in an in-app "Rate us" link, share sheet, or store badge.
  if (!app) return;
  const extra = (app.expo && app.expo.extra) || {};
  const listings = extra.storeListings;
  if (listings === undefined) {
    fail(
      'app.json: expo.extra.storeListings missing — declare {playStoreUrl, appStoreUrl} (each may be null until the listing is published) so the validator can guarantee no fake store URL ships',
    );
    return;
  }
  if (listings === null || typeof listings !== 'object' || Array.isArray(listings)) {
    fail(
      `app.json: expo.extra.storeListings must be an object, got ${JSON.stringify(listings)}`,
    );
    return;
  }

  const checks = [
    {
      key: 'playStoreUrl',
      pattern: PLAY_STORE_URL_RE,
      example:
        'https://play.google.com/store/apps/details?id=com.growthproject.app',
    },
    {
      key: 'appStoreUrl',
      pattern: APP_STORE_URL_RE,
      example: 'https://apps.apple.com/us/app/the-growth-project/id1234567890',
    },
  ];

  for (const c of checks) {
    if (!(c.key in listings)) {
      fail(
        `app.json: expo.extra.storeListings.${c.key} missing — set to a real store URL or to null (not yet published)`,
      );
      continue;
    }
    const value = listings[c.key];
    if (value === null) {
      if (RELEASE_MODE) {
        fail(
          `app.json: expo.extra.storeListings.${c.key} is null in --release mode — fill in the published listing URL (e.g. ${c.example}) before promoting the build`,
        );
      } else {
        warn(
          `app.json: expo.extra.storeListings.${c.key} is null — the store listing has not been published yet. --release mode will reject this.`,
        );
      }
      continue;
    }
    if (typeof value !== 'string') {
      fail(
        `app.json: expo.extra.storeListings.${c.key} must be a string or null, got ${JSON.stringify(value)}`,
      );
      continue;
    }
    if (!c.pattern.test(value)) {
      fail(
        `app.json: expo.extra.storeListings.${c.key} ${JSON.stringify(value)} does not look like a real store URL — expected shape ${c.example}. Use null until the listing is live; never check in a placeholder.`,
      );
      continue;
    }
    // For Play, the package id in the URL must match expo.android.package —
    // a wrong id is exactly the kind of silent bug a placeholder masks.
    if (c.key === 'playStoreUrl') {
      const expectedPkg = (app.expo && app.expo.android && app.expo.android.package) || '';
      if (expectedPkg && !value.includes(`id=${expectedPkg}`)) {
        fail(
          `app.json: expo.extra.storeListings.playStoreUrl points to a different package than expo.android.package (${expectedPkg}) — check the URL`,
        );
      }
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

  // Both files in docs/well-known/ are intentionally templates. They are NOT
  // shipped with the app binary — they are committed for the marketing-site
  // operator to copy to https://app.trygrowthproject.com/.well-known/. Until
  // those copies are filled in, the templates contain `REPLACE_WITH_*`
  // sentinels.
  //
  // - In default mode we surface the placeholders as a warning so a stale
  //   template doesn't slip through unnoticed.
  // - In --release mode any placeholder is a hard error: at publish time the
  //   templates must already have been replaced with real values, OR the
  //   operator must have explicitly committed the real fingerprint / team id
  //   to a separate hosted-only path. Either way, a placeholder reaching
  //   --release means the universal-link / app-link verification step has
  //   not been completed and silent deep-link failures will follow.
  const alText = fs.readFileSync(al, 'utf8');
  const aasaText = fs.readFileSync(aasa, 'utf8');
  reportPlaceholder(alText, 'docs/well-known/assetlinks.json');
  reportPlaceholder(aasaText, 'docs/well-known/apple-app-site-association');

  // Light parse — confirm package_name + bundle id match app.json values.
  try {
    const al_doc = JSON.parse(alText);
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
    const aasa_doc = JSON.parse(aasaText);
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

function reportPlaceholder(text, relPath) {
  // Find every occurrence of REPLACE_WITH_* and report at the right severity.
  const matches = text.match(new RegExp(PLACEHOLDER_PATTERN.source, 'g')) || [];
  if (matches.length === 0) return;
  const unique = Array.from(new Set(matches));
  const summary =
    unique.length === 1 ? unique[0] : `${unique.length} placeholders (${unique.join(', ')})`;
  if (RELEASE_MODE) {
    fail(
      `${relPath}: contains template placeholder(s) ${summary} — replace before publishing or the hosted file will fail App Link / AASA verification`,
    );
  } else {
    warn(
      `${relPath}: contains template placeholder(s) ${summary} — fill in before hosting at the marketing site (run with --release to make this fatal)`,
    );
  }
}

function main() {
  const app = readJson(APP_JSON);
  validateAppJson(app);
  validateStoreListings(app);
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
  console.log(
    `validate-app-config: OK${RELEASE_MODE ? ' (--release)' : ''}${warnings.length ? ` (${warnings.length} warning(s))` : ''}`,
  );
}

main();
