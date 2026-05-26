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
 *                    REPLACE_WITH_* placeholder in a hosted file is treated
 *                    as a known pending item. The validator exits 0 but writes
 *                    a RELEASE_BLOCKER.md file listing exactly what Bradley
 *                    must complete before submitting to the stores. Any value
 *                    that is genuinely broken (wrong format, wrong package
 *                    name, etc.) is still a hard error and exits non-zero.
 *                    Wire this into CI so the gate runs on every PR.
 *
 * Designed to run pre-build and in CI. No deps beyond Node fs/path.
 *
 * Usage:
 *   node scripts/validate-app-config.js              # exits non-zero on failure
 *   node scripts/validate-app-config.js --release    # adds the pre-publish gates; emits RELEASE_BLOCKER.md
 *   node scripts/validate-app-config.js --json       # machine-readable output
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_JSON = path.join(ROOT, 'app.json');
const ENV_EXAMPLE = path.join(ROOT, '.env.example');

// RELEASE_BLOCKER.md is emitted at repo root when --release mode finds
// pending-but-expected items (placeholders, null store URLs). The file is
// meant to be read by a human — Bradley — not consumed by any script.
const RELEASE_BLOCKER_MD = path.join(ROOT, 'RELEASE_BLOCKER.md');

const RELEASE_MODE = process.argv.includes('--release');
const PLACEHOLDER_PATTERN = /REPLACE_WITH_[A-Z0-9_]+/;
const PLAY_STORE_URL_RE =
  /^https:\/\/play\.google\.com\/store\/apps\/details\?id=[A-Za-z0-9_.]+(&hl=[a-zA-Z-]+)?$/;
const APP_STORE_URL_RE =
  /^https:\/\/apps\.apple\.com\/[a-z]{2}\/app\/[A-Za-z0-9-]+\/id[0-9]+$/;

// These values are the single source of truth. If app.json ever drifts from
// them, the validator fails so the drift is caught before a build.
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

// Soft-required for a TestFlight / Play Internal candidate: the app boots
// without these (env.ts does not throw), but the build is functionally
// incomplete in ways the QA matrix will catch. Each must be *mentioned* in
// .env.example (even as a commented-out line) so an EAS operator running
// `eas env:list` against the file as a checklist sees the full set.
//
//   - SENTRY_DSN     — crashes go uncaptured, post-release triage blind
//   - POSTHOG_API_KEY / POSTHOG_KEY — analytics silently no-op
//   - CRISP_WEBSITE_ID — Settings → Support tab renders an empty overlay
//   - ENVIRONMENT     — Sentry events default-tag as 'production' even on
//                       preview / internal builds, polluting the prod board
//   - HELP_BASE_URL   — defaults to https://app.trygrowthproject.com/help;
//                       fine to omit, but the EAS operator should know it
//                       exists so a future help-host move doesn't surprise
//                       anyone
//
// In default mode the validator warns when any are missing from .env.example.
// In --release mode they become release blockers in RELEASE_BLOCKER.md.
//
// PostHog is satisfied by either the canonical EXPO_PUBLIC_POSTHOG_API_KEY
// or the legacy alias EXPO_PUBLIC_POSTHOG_KEY (App.tsx reads both).
const RELEASE_RECOMMENDED_ENV = [
  {
    key: 'EXPO_PUBLIC_SENTRY_DSN',
    why: 'crashes go uncaptured in production',
  },
  {
    keys: ['EXPO_PUBLIC_POSTHOG_API_KEY', 'EXPO_PUBLIC_POSTHOG_KEY'],
    why: 'analytics silently no-op without a key',
  },
  {
    key: 'EXPO_PUBLIC_CRISP_WEBSITE_ID',
    why: 'Settings → Support overlay opens empty without the website id',
  },
  {
    key: 'EXPO_PUBLIC_ENVIRONMENT',
    why: 'Sentry events default to environment="production" even on preview / internal builds',
  },
  {
    key: 'EXPO_PUBLIC_HELP_BASE_URL',
    why: 'help center URL defaults to app.trygrowthproject.com/help; document for the operator even if accepting the default',
  },
];

// Hard errors: genuinely broken. Always exit non-zero.
const errors = [];
// Warnings: noted but do not fail CI.
const warnings = [];
// Pending blockers in --release mode: expected to still be incomplete
// (placeholder not yet filled in, store listing not yet published).
// These exit 0 but generate RELEASE_BLOCKER.md so Bradley knows what
// must be completed before a Play Store / App Store submission.
const releaseBlockers = [];

function fail(msg) {
  errors.push(msg);
}

function warn(msg) {
  warnings.push(msg);
}

// releaseBlock: used for known-pending items that do NOT fail CI but DO
// block a real store submission. In --release mode these are collected
// into RELEASE_BLOCKER.md. In default mode they are regular warnings.
function releaseBlock(msg) {
  if (RELEASE_MODE) {
    releaseBlockers.push(msg);
  } else {
    warnings.push(msg);
  }
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

  // expo.scheme may be a string OR an array. Array form is required so the
  // app registers multiple URL schemes with the OS — the legacy `tgp://` for
  // invite deep links, plus `com.growthproject.app://` for the Stripe
  // checkout return URL. Validate that the legacy scheme is still present in
  // either shape; the bundle-id scheme is checked separately below.
  const schemes = Array.isArray(expo.scheme)
    ? expo.scheme
    : expo.scheme === undefined
    ? []
    : [expo.scheme];
  if (!schemes.includes(EXPECTED.scheme)) {
    fail(
      `app.json: expo.scheme is ${JSON.stringify(expo.scheme)}, expected ${JSON.stringify(EXPECTED.scheme)} (string or array entry) — custom scheme deep links will not fire`,
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
      // null means "not yet published" — this is expected pre-launch.
      // In --release mode it goes into the RELEASE_BLOCKER.md (pending, not broken).
      // In default mode it is a plain warning.
      releaseBlock(
        `app.json: expo.extra.storeListings.${c.key} is null — fill in the published listing URL (e.g. ${c.example}) before submitting to the stores`,
      );
      continue;
    }
    if (typeof value !== 'string') {
      fail(
        `app.json: expo.extra.storeListings.${c.key} must be a string or null, got ${JSON.stringify(value)}`,
      );
      continue;
    }
    if (!c.pattern.test(value)) {
      // A non-null string that doesn't look like a real store URL is always
      // a hard error — this is the "accidentally checked in a placeholder"
      // case that must never reach production.
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
  // "Mentioned" = declared as an assignment OR referenced anywhere in the
  // file (including commented-out lines and inline `eas env:create` examples).
  // Required vars use the strict declared-key set; recommended vars use the
  // looser mentioned set, because they ship commented-out by design.
  const mentionedKeys = new Set();
  for (const line of text.split(/\r?\n/)) {
    const decl = /^\s*([A-Z0-9_]+)\s*=/.exec(line);
    if (decl) declaredKeys.add(decl[1]);
    const refs = line.match(/EXPO_PUBLIC_[A-Z0-9_]+/g) || [];
    for (const r of refs) mentionedKeys.add(r);
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

  for (const entry of RELEASE_RECOMMENDED_ENV) {
    const keys = entry.keys || [entry.key];
    const documented = keys.some((k) => mentionedKeys.has(k));
    if (!documented) {
      const shown = keys.join(' or ');
      releaseBlock(
        `.env.example: missing TestFlight-recommended env var ${shown} — ${entry.why}. Add a commented-out reference (e.g. "# ${keys[0]}=...") so an EAS operator reading the file sees the full set.`,
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
  // - In --release mode any placeholder is a known pending item: it goes into
  //   RELEASE_BLOCKER.md so Bradley knows what must be done before a store
  //   submission. CI still passes — the gate is informational, not blocking,
  //   because Bradley cannot fill in the SHA256 fingerprint until after the
  //   first EAS production build is uploaded to Play Console. A false-positive
  //   CI failure would block every PR until that one external action is done,
  //   which is the wrong tradeoff. The RELEASE_BLOCKER.md is the visible
  //   signal that the action is pending.
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
    // This is a known pending item — not a broken value. Goes into
    // RELEASE_BLOCKER.md rather than crashing CI.
    releaseBlock(
      `${relPath}: contains placeholder(s) ${summary} — must be replaced before hosting at the marketing site`,
    );
  } else {
    warn(
      `${relPath}: contains template placeholder(s) ${summary} — fill in before hosting at the marketing site (run with --release to promote this to a release blocker)`,
    );
  }
}

function writeReleaseBlockerMd() {
  if (!RELEASE_MODE) return;
  if (releaseBlockers.length === 0) {
    // Nothing pending — remove any stale RELEASE_BLOCKER.md from a prior run.
    if (fs.existsSync(RELEASE_BLOCKER_MD)) {
      fs.unlinkSync(RELEASE_BLOCKER_MD);
    }
    return;
  }

  const lines = [
    '# RELEASE BLOCKER — Read this before submitting to the stores',
    '',
    'This file was generated automatically by `npm run validate:release`.',
    'It lists things that are **not yet done** and must be completed before',
    'you submit the app to the Google Play Store or Apple App Store.',
    '',
    'None of these items will crash the app or break development. But if you',
    'skip them, Android deep links (invite codes) will silently fail on real',
    'user phones, and the store listings in the app will point nowhere.',
    '',
    '---',
    '',
    '## Checklist',
    '',
  ];

  for (const [i, blocker] of releaseBlockers.entries()) {
    lines.push(`- [ ] **Item ${i + 1}:** ${blocker}`);
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## How to fix each item');
  lines.push('');

  const hasPlaySha = releaseBlockers.some((b) =>
    b.includes('REPLACE_WITH_PLAY_APP_SIGNING_SHA256_FINGERPRINT'),
  );
  const hasAppleTeamId = releaseBlockers.some((b) =>
    b.includes('REPLACE_WITH_APPLE_TEAM_ID'),
  );
  const hasPlayStoreUrl = releaseBlockers.some((b) =>
    b.includes('playStoreUrl'),
  );
  const hasAppStoreUrl = releaseBlockers.some((b) =>
    b.includes('appStoreUrl'),
  );

  if (hasPlaySha) {
    lines.push(
      '### Android SHA256 fingerprint (`docs/well-known/assetlinks.json`)',
    );
    lines.push('');
    lines.push(
      'This is the fingerprint of the key Google uses to sign your app after you',
      'upload it. Without it, Android phones will not follow deep links (invite',
      'codes) directly into the app — they will open a browser chooser instead.',
    );
    lines.push('');
    lines.push('**How to get it:**');
    lines.push('');
    lines.push(
      '1. Go to [Play Console](https://play.google.com/console) and open your app.',
    );
    lines.push(
      '2. In the left menu, go to **Setup** > **App integrity**.',
    );
    lines.push(
      '3. Under **App signing key certificate**, copy the **SHA-256 fingerprint**.',
    );
    lines.push(
      '   It looks like: `AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78`',
    );
    lines.push('');
    lines.push(
      'Alternatively, if you have the keystore file on your computer, run:',
    );
    lines.push('');
    lines.push(
      '```bash',
      'keytool -list -v -keystore /path/to/your.keystore -alias your-key-alias',
      '# Look for the line that starts with SHA256:',
      '```',
    );
    lines.push('');
    lines.push('**Then open `docs/well-known/assetlinks.json` and replace:**');
    lines.push('```');
    lines.push('"REPLACE_WITH_PLAY_APP_SIGNING_SHA256_FINGERPRINT"');
    lines.push('```');
    lines.push('**with your real fingerprint, like:**');
    lines.push('```');
    lines.push('"AB:CD:EF:12:34:..."');
    lines.push('```');
    lines.push('');
    lines.push(
      'After saving the file, upload it to:',
      '`https://app.trygrowthproject.com/.well-known/assetlinks.json`',
    );
    lines.push('');
  }

  if (hasAppleTeamId) {
    lines.push(
      '### Apple Team ID (`docs/well-known/apple-app-site-association`)',
    );
    lines.push('');
    lines.push(
      '1. Go to [developer.apple.com](https://developer.apple.com/account).',
    );
    lines.push('2. Click **Membership** in the left menu.');
    lines.push('3. Copy your **Team ID** (10 characters, e.g. `F8TL8N7SGQ`).');
    lines.push('');
    lines.push(
      '**Then open `docs/well-known/apple-app-site-association` and replace both instances of:**',
    );
    lines.push('```');
    lines.push('REPLACE_WITH_APPLE_TEAM_ID');
    lines.push('```');
    lines.push('**with your Team ID.**');
    lines.push('');
    lines.push(
      'After saving, upload the file (without the `.json` extension) to:',
      '`https://app.trygrowthproject.com/.well-known/apple-app-site-association`',
    );
    lines.push('');
  }

  if (hasPlayStoreUrl) {
    lines.push('### Play Store URL (`app.json` > `expo.extra.storeListings.playStoreUrl`)');
    lines.push('');
    lines.push(
      'Once your app is published on Google Play, copy the URL from the Play Console',
      'and paste it into `app.json`. It looks like:',
    );
    lines.push(
      '`https://play.google.com/store/apps/details?id=com.growthproject.app`',
    );
    lines.push('');
  }

  if (hasAppStoreUrl) {
    lines.push('### App Store URL (`app.json` > `expo.extra.storeListings.appStoreUrl`)');
    lines.push('');
    lines.push(
      'Once your app is published on the App Store, copy the URL from App Store Connect',
      'and paste it into `app.json`. It looks like:',
    );
    lines.push(
      '`https://apps.apple.com/us/app/the-growth-project/id1234567890`',
    );
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(
    '_Once you have completed all items above, run `npm run validate:release` again._',
    '_When it exits with no errors and no blockers, you are ready to submit._',
  );
  lines.push('');

  fs.writeFileSync(RELEASE_BLOCKER_MD, lines.join('\n'), 'utf8');
}

function main() {
  const app = readJson(APP_JSON);
  validateAppJson(app);
  validateStoreListings(app);
  validateEnvExample();
  validateLinkingTemplates();

  // Write (or clean up) RELEASE_BLOCKER.md before deciding the exit code.
  writeReleaseBlockerMd();

  const asJson = process.argv.includes('--json');
  if (asJson) {
    const ok = errors.length === 0;
    process.stdout.write(
      JSON.stringify({ ok, errors, warnings, releaseBlockers }, null, 2) + '\n',
    );
    process.exit(ok ? 0 : 1);
  }

  if (warnings.length) {
    for (const w of warnings) console.warn(`warn: ${w}`);
  }
  if (releaseBlockers.length) {
    console.warn(
      `\nRELEASE BLOCKER: ${releaseBlockers.length} item(s) must be resolved before store submission.`,
    );
    for (const b of releaseBlockers) console.warn(`  pending: ${b}`);
    console.warn('\nSee RELEASE_BLOCKER.md for step-by-step instructions.');
  }
  if (errors.length) {
    for (const e of errors) console.error(`error: ${e}`);
    console.error(`\nvalidate-app-config: ${errors.length} error(s), ${warnings.length} warning(s)`);
    process.exit(1);
  }
  // PR #192 fix round 1 (P2-3): in --release mode, release blockers MUST
  // turn the gate red. Previously the script exited 0 even when
  // RELEASE_BLOCKER.md listed Play Store fingerprint / Play Store URL gaps,
  // so CI could mark validate:release green while the app was not
  // submission-ready.
  if (RELEASE_MODE && releaseBlockers.length) {
    console.error(
      `\nvalidate-app-config: FAIL (--release) — ${releaseBlockers.length} release blocker(s) written to RELEASE_BLOCKER.md`,
    );
    process.exit(1);
  }
  console.log(
    `validate-app-config: OK${RELEASE_MODE ? ' (--release)' : ''}${warnings.length ? ` (${warnings.length} warning(s))` : ''}${releaseBlockers.length ? ` — ${releaseBlockers.length} release blocker(s) written to RELEASE_BLOCKER.md` : ''}`,
  );
}

main();
