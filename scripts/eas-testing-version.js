#!/usr/bin/env node
/**
 * EAS post-install hook (package.json "eas-build-post-install"; DEVICE-LOOP,
 * docs/DEVICE_LOOP.md). On an iOS build of the eas.json "testing" profile it
 * moves the binary to its own TestFlight version, 99.0.0, with the build
 * number set to whole minutes since 1970 UTC (29869410 at 2026-10-16 15:30).
 * App Store Connect wants the build numbers of one version unique and rising,
 * so a testing build under app.json's 1.0.0 would take a production build
 * number or block the next one. A single integer, like app.json's, keeps the
 * purchase gate (src/config/purchaseSurfaces.ts nativeBuildNumber) and the
 * X-Client-Native-Build header on the production path. Every other build
 * (production included) returns before touching anything.
 *
 * It runs after prebuild and edits only the generated ios/ folder, which the
 * runtime fingerprint ignores: the build still embeds the runtime the device
 * loop's updates target.
 */
'use strict';
/* eslint-disable @typescript-eslint/no-var-requires -- CommonJS node script */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TESTING_VERSION = '99.0.0';

/** Whole minutes since 1970 UTC: one rising integer (8 digits until 2160). */
function testingBuildNumber(now) {
  return String(Math.floor(now.getTime() / 60000));
}

/** The app target's Info.plist: exactly one ios/<name>/Info.plist, or throw. */
function findInfoPlist(iosDir) {
  const found = fs
    .readdirSync(iosDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== 'Pods' && e.name !== 'build')
    .map((e) => path.join(iosDir, e.name, 'Info.plist'))
    .filter((p) => fs.existsSync(p));
  if (found.length !== 1) {
    throw new Error(`expected exactly one ios/<app>/Info.plist, found ${found.length}. Fix: point scripts/eas-testing-version.js at the app target.`);
  }
  return found[0];
}

function main({ env = process.env, root = process.cwd(), now = new Date(), run = execFileSync, log = console.log } = {}) {
  if (env.EAS_BUILD_PROFILE !== 'testing' || env.EAS_BUILD_PLATFORM !== 'ios') return null;
  const plist = findInfoPlist(path.join(root, 'ios'));
  const build = testingBuildNumber(now);
  run('/usr/libexec/PlistBuddy', ['-c', `Set :CFBundleShortVersionString ${TESTING_VERSION}`, '-c', `Set :CFBundleVersion ${build}`, plist]);
  log(`testing build: ${path.relative(root, plist)} is version ${TESTING_VERSION} (${build})`);
  return { plist, version: TESTING_VERSION, build };
}

module.exports = { TESTING_VERSION, testingBuildNumber, findInfoPlist, main };

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`eas-build-post-install: ${err.message}`);
    process.exit(1);
  }
}
