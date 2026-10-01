#!/usr/bin/env node
/**
 * Expo module Android build guard (S-ENVTRUTH, 2026-10-01).
 *
 * crisp-sdk-react-native 0.2.1 crashed the Android build on Expo SDK 56: its
 * android/build.gradle still built through the legacy path
 *
 *   apply from: ".../expo-modules-core/ExpoModulesCorePlugin.gradle"
 *   applyKotlinExpoModulesCorePlugin()
 *
 * which SDK 56 no longer supports (modules must use
 * `plugins { id 'expo-module-gradle-plugin' }`). 0.4.3 moved to the plugin.
 *
 * Fails (exit 1) when any installed package that ships an
 * expo-module.config.json (i.e. is autolinked as an Expo module) has an
 * android/ Gradle file that references ExpoModulesCorePlugin.gradle or calls
 * applyKotlinExpoModulesCorePlugin. expo-modules-core itself is exempt: it is
 * the package that defines the legacy file.
 *
 * Scans every node_modules level (top-level, scoped, and nested
 * node_modules), because Expo autolinking resolves nested copies too.
 *
 *   node scripts/check-expo-module-gradle.js [--root <dir>]   (default: repo root)
 */
'use strict';
/* eslint-disable @typescript-eslint/no-var-requires -- CommonJS node script */
const fs = require('fs');
const path = require('path');

const LEGACY_PATTERNS = [
  { id: 'apply-ExpoModulesCorePlugin.gradle', re: /ExpoModulesCorePlugin\.gradle/ },
  { id: 'applyKotlinExpoModulesCorePlugin()', re: /\bapplyKotlinExpoModulesCorePlugin\s*\(/ },
];
const EXEMPT = new Set(['expo-modules-core']);
const GRADLE_RE = /\.gradle(\.kts)?$/;

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/** Every package directory under a node_modules dir (scoped included). */
function packagesIn(nodeModules) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(nodeModules, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(nodeModules, e.name);
    if (!e.isDirectory() && !e.isSymbolicLink()) continue;
    if (e.name.startsWith('@')) {
      for (const s of fs.readdirSync(p, { withFileTypes: true })) {
        if (!s.name.startsWith('.')) out.push(path.join(p, s.name));
      }
    } else {
      out.push(p);
    }
  }
  return out.filter(isDir);
}

/** Gradle files under <pkg>/android (skipping build outputs and nested node_modules). */
function gradleFiles(androidDir) {
  const out = [];
  const walk = (d, depth) => {
    if (depth > 4) return;
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'build' || e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (GRADLE_RE.test(e.name)) out.push(p);
    }
  };
  walk(androidDir, 0);
  return out;
}

/** Returns legacy pattern ids found in a Gradle source text. */
function findLegacyGradle(text) {
  // Ignore line comments so a migration note does not trip the guard.
  const code = String(text)
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
  return LEGACY_PATTERNS.filter((p) => p.re.test(code)).map((p) => p.id);
}

/**
 * Scan an install root. Returns { errors, modules } where modules lists every
 * Expo module found (name@version) and errors lists offending packages.
 */
function check(root) {
  const errors = [];
  const modules = [];
  const seen = new Set();
  const visitNodeModules = (nm, depth) => {
    if (depth > 6) return;
    for (const pkgDir of packagesIn(nm)) {
      let real;
      try {
        real = fs.realpathSync(pkgDir);
      } catch {
        continue;
      }
      if (seen.has(real)) continue;
      seen.add(real);
      const pkg = readJson(path.join(pkgDir, 'package.json')) || {};
      const name = pkg.name || path.basename(pkgDir);
      if (fs.existsSync(path.join(pkgDir, 'expo-module.config.json'))) {
        modules.push(`${name}@${pkg.version || '?'}`);
        if (!EXEMPT.has(name)) {
          for (const f of gradleFiles(path.join(pkgDir, 'android'))) {
            const hits = findLegacyGradle(fs.readFileSync(f, 'utf8'));
            if (hits.length) {
              errors.push({
                package: `${name}@${pkg.version || '?'}`,
                file: path.relative(root, f),
                patterns: hits,
              });
            }
          }
        }
      }
      const nested = path.join(pkgDir, 'node_modules');
      if (isDir(nested)) visitNodeModules(nested, depth + 1);
    }
  };
  visitNodeModules(path.join(root, 'node_modules'), 0);
  modules.sort();
  return { errors, modules };
}

module.exports = { LEGACY_PATTERNS, EXEMPT, findLegacyGradle, check, packagesIn };

if (require.main === module) {
  const i = process.argv.indexOf('--root');
  const root = i > -1 ? path.resolve(process.argv[i + 1]) : path.resolve(__dirname, '..');
  const { errors, modules } = check(root);
  if (modules.length === 0) {
    console.error('[expo-module-gradle] no Expo modules found under node_modules; run npm ci first.');
    process.exit(1);
  }
  if (errors.length) {
    for (const e of errors) {
      console.error(
        `[expo-module-gradle] ${e.package}: ${e.file} uses the legacy ${e.patterns.join(' + ')} path. ` +
          "Upgrade to a release that uses plugins { id 'expo-module-gradle-plugin' }.",
      );
    }
    process.exit(1);
  }
  console.log(`[expo-module-gradle] OK: ${modules.length} Expo modules, none on the legacy Gradle path.`);
}
