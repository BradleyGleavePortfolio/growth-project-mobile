#!/usr/bin/env node
/**
 * EXPO_PUBLIC_* env manifest guard (S-ENVTRUTH, 2026-10-01).
 *
 * config/expected-env.json lists every EXPO_PUBLIC_* name the app reads, with
 * kind (required | optional | flag), the code default, and a reason. This
 * guard fails when:
 *   1. runtime code reads an EXPO_PUBLIC_* name that is not in the manifest
 *      (a key named in code that nobody will ever set), or
 *   2. the manifest lists a name nothing reads (a stale or fake key), or
 *   3. eas.json sets an EXPO_PUBLIC_* name that is not in the manifest, or
 *   4. a manifest entry has an invalid kind or an empty default / reason.
 *
 * A "read" is a literal `process.env.EXPO_PUBLIC_X` / `process.env['EXPO_PUBLIC_X']`
 * member expression, or a literal key passed to the flag helpers
 * (`readFlag('EXPO_PUBLIC_X', ...)`, `envBool('EXPO_PUBLIC_X', ...)`), which
 * is how the FF_ names are read. Comments, markdown and dynamic prefix
 * helpers (e.g. a bare 'EXPO_PUBLIC_FF_' prefix string) are ignored.
 *
 * Scope: src/** (excluding tests and .d.ts), App.tsx, index.ts,
 * metro.config.js, babel.config.js, plugins/**, app.config.* and app.json.
 *
 *   node scripts/check-expected-env.js [--root <dir>]
 */
'use strict';
/* eslint-disable @typescript-eslint/no-var-requires -- CommonJS node script */
const fs = require('fs');
const path = require('path');

const KINDS = new Set(['required', 'optional', 'flag']);
const SRC_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const ROOT_FILES = [
  'App.tsx',
  'index.ts',
  'metro.config.js',
  'babel.config.js',
  'app.config.js',
  'app.config.ts',
  'app.json',
];

function isTestPath(rel) {
  return (
    /(^|\/)__tests__\//.test(rel) ||
    /(^|\/)__mocks__\//.test(rel) ||
    /\.(test|spec)\.[jt]sx?$/.test(rel) ||
    /\.d\.ts$/.test(rel)
  );
}

function walk(dir, root, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, root, out);
    else if (SRC_EXT.test(e.name)) {
      const rel = path.relative(root, p).split(path.sep).join('/');
      if (!isTestPath(rel)) out.push(rel);
    }
  }
  return out;
}

/** Runtime files in scope, repo-relative with forward slashes. */
function runtimeFiles(root) {
  const files = [];
  walk(path.join(root, 'src'), root, files);
  walk(path.join(root, 'plugins'), root, files);
  for (const f of ROOT_FILES) if (fs.existsSync(path.join(root, f))) files.push(f);
  return files.sort();
}

/** Strip block and line comments (line comments only at line start or after whitespace, so URLs survive). */
function stripComments(code) {
  return String(code)
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[\s;{}(),])\/\/[^\n]*/g, '$1');
}

const READ_PATTERNS = [
  /process\.env\.(EXPO_PUBLIC_[A-Z0-9_]+)\b/g,
  /process\.env\[\s*['"`](EXPO_PUBLIC_[A-Z0-9_]+)['"`]\s*\]/g,
  /\b(?:readFlag|envBool)\(\s*['"`](EXPO_PUBLIC_[A-Z0-9_]+)['"`]/g,
];

/** EXPO_PUBLIC_* names read in one source text. */
function findReads(code) {
  const text = stripComments(code);
  const names = new Set();
  for (const re of READ_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) names.add(m[1]);
  }
  return [...names].sort();
}

/** Map name -> files that read it. */
function scanReads(root) {
  const reads = new Map();
  for (const rel of runtimeFiles(root)) {
    for (const n of findReads(fs.readFileSync(path.join(root, rel), 'utf8'))) {
      const list = reads.get(n) || [];
      list.push(rel);
      reads.set(n, list);
    }
  }
  return reads;
}

/** EXPO_PUBLIC_* names set in eas.json build profiles. */
function easEnvNames(root) {
  const p = path.join(root, 'eas.json');
  if (!fs.existsSync(p)) return [];
  const eas = JSON.parse(fs.readFileSync(p, 'utf8'));
  const names = new Set();
  for (const profile of Object.values((eas && eas.build) || {})) {
    for (const k of Object.keys((profile && profile.env) || {})) {
      if (k.startsWith('EXPO_PUBLIC_')) names.add(k);
    }
  }
  return [...names].sort();
}

function loadManifest(root) {
  return JSON.parse(fs.readFileSync(path.join(root, 'config', 'expected-env.json'), 'utf8'));
}

function check(root) {
  const manifest = loadManifest(root);
  const vars = manifest.vars || {};
  const declared = new Set(Object.keys(vars));
  const reads = scanReads(root);
  const errors = [];
  for (const [name, files] of [...reads.entries()].sort()) {
    if (!declared.has(name)) errors.push(`read but not in config/expected-env.json: ${name} <- ${files.join(', ')}`);
  }
  for (const name of [...declared].sort()) {
    if (!reads.has(name)) errors.push(`in config/expected-env.json but never read: ${name}`);
    const v = vars[name] || {};
    if (!KINDS.has(v.kind)) errors.push(`${name}: kind must be required|optional|flag`);
    if (typeof v.default !== 'string' || !v.default.trim()) errors.push(`${name}: default is empty`);
    if (typeof v.reason !== 'string' || !v.reason.trim()) errors.push(`${name}: reason is empty`);
  }
  for (const name of easEnvNames(root)) {
    if (!declared.has(name)) errors.push(`set in eas.json but not in config/expected-env.json: ${name}`);
  }
  return { errors, reads, declared };
}

module.exports = { findReads, stripComments, runtimeFiles, scanReads, easEnvNames, check, KINDS };

if (require.main === module) {
  const i = process.argv.indexOf('--root');
  const root = i > -1 ? path.resolve(process.argv[i + 1]) : path.resolve(__dirname, '..');
  const { errors, reads } = check(root);
  if (errors.length) {
    for (const e of errors) console.error(`[expected-env] ${e}`);
    process.exit(1);
  }
  console.log(`[expected-env] OK: ${reads.size} EXPO_PUBLIC_* names read, all in the manifest.`);
}
