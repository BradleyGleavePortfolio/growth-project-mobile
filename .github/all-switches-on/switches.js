#!/usr/bin/env node
/**
 * ALL-ON-CI-M: the "All switches on (not required)" job's helper. CI only;
 * the app never loads this file and no switch default changes.
 *
 *   node .github/all-switches-on/switches.js find
 *     Finds every phone switch at run time, prints the list and the count,
 *     and turns each on for the rest of the job (through $GITHUB_ENV).
 *   node .github/all-switches-on/switches.js report <jest --json file>
 *     Prints every failing suite and test of the all-on run.
 *
 * An env switch is found in four places, so a new one is picked up without
 * editing the job:
 *   1. config/expected-env.json, every name of kind "flag" (the env manifest
 *      guard already makes every EXPO_PUBLIC_* the app reads declare itself
 *      there);
 *   2. config/expected-env.json, every name of kind "optional" whose default
 *      reads "off" (an on/off switch such as EXPO_PUBLIC_GOOGLE_PAY_ENABLED;
 *      the other optional names hold an id, URL, key, country or environment
 *      and stay as the code reads them);
 *   3. every literal process.env.EXPO_PUBLIC_FF_* or EXPO_PUBLIC_FEATURE_*
 *      read in app code (src/, plugins/, app.config.js; tests left out);
 *   4. every eas.json build env value that is a plain on/off ("0", "1",
 *      "true", "false"), for build switches such as TGP_ANDROID_HEALTH_CONNECT.
 * Mock and capture modes (a name with MOCK or SCREENSHOT_MODE) are found but
 * not turned on: they swap the real data paths for fakes and are not features.
 * Two more layers are printed here and turned on by switchesOn.setup.js:
 * build metadata (app.config.js extra, read through expo-constants) and the
 * server switches (SERVER_FEATURE_FLAG_KEYS, read from GET /me/feature-flags).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const V1_PRS_LEFT_COUNT = 70;
const ON = '1'; // featureFlags.ts readFlag, aiGatewayFlags.ts envBool and app.config.js all read '1' as on.
const NOT_A_FEATURE = /MOCK|SCREENSHOT_MODE/;
const APP_CODE = ['src', 'plugins', 'app.config.js'];
const SKIP_DIR = new Set(['node_modules', '__tests__', '__mocks__', '__snapshots__']);
const TEST_FILE = /\.(test|spec)\.[jt]sx?$/;
const CODE_FILE = /\.[jt]sx?$/;
const READ = /process\.env\.(EXPO_PUBLIC_(?:FF|FEATURE)_[A-Z0-9_]*[A-Z0-9])\b/g;
const BOOL = /^(0|1|true|false)$/i;
const OFF_DEFAULT = /^off\b/i;
const SERVER_KEYS = /SERVER_FEATURE_FLAG_KEYS = \[([\s\S]*?)\] as const/;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function codeFiles(entry, out = []) {
  if (!fs.existsSync(entry)) return out;
  const stat = fs.statSync(entry);
  if (stat.isFile()) {
    if (CODE_FILE.test(entry) && !TEST_FILE.test(entry)) out.push(entry);
    return out;
  }
  for (const name of fs.readdirSync(entry)) {
    if (SKIP_DIR.has(name)) continue;
    codeFiles(path.join(entry, name), out);
  }
  return out;
}

function easEnv(build, profile, seen = new Set()) {
  const p = build[profile];
  if (!p || seen.has(profile)) return {};
  seen.add(profile);
  return { ...(p.extends ? easEnv(build, p.extends, seen) : {}), ...(p.env || {}) };
}

function find() {
  const manifest = readJson('config/expected-env.json').vars;
  const build = readJson('eas.json').build || {};
  const found = new Map();
  const add = (name, where) => {
    if (!found.has(name)) found.set(name, new Set());
    found.get(name).add(where);
  };

  for (const [name, v] of Object.entries(manifest)) {
    if (v.kind === 'flag') add(name, 'manifest');
    if (v.kind === 'optional' && OFF_DEFAULT.test(String(v.default))) add(name, 'manifest-optional');
  }
  for (const file of APP_CODE.flatMap((e) => codeFiles(e))) {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(READ)) add(m[1], 'code');
  }
  for (const p of Object.values(build)) {
    for (const [name, value] of Object.entries(p.env || {})) if (BOOL.test(String(value))) add(name, 'eas.json');
  }

  const production = easEnv(build, 'production');
  const names = [...found.keys()].sort();
  const on = names.filter((n) => !NOT_A_FEATURE.test(n));
  const left = names.filter((n) => NOT_A_FEATURE.test(n));
  const settings = Object.entries(manifest)
    .filter(([n, v]) => v.kind === 'optional' && !found.has(n))
    .map(([n]) => n);
  const serverKeys = [...(fs.readFileSync('src/api/featureFlagsApi.ts', 'utf8').match(SERVER_KEYS) || ['', ''])[1]
    .replace(/\/\/.*$/gm, '')
    .matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
  const saved = { ...process.env };
  for (const n of on) process.env[n] = ON;
  const appExtra = require(path.resolve('app.json')).expo.extra || {};
  const builtExtra = require(path.resolve('app.config.js'))().extra || {};
  process.env = saved;
  const metadata = Object.keys(builtExtra).filter((k) => typeof builtExtra[k] === 'boolean' && !(k in appExtra));
  const prodOn = (n) => /^(1|true)$/i.test(String(production[n] ?? ''));
  const prodOnCount = on.filter(prodOn).length;

  const rows = on.map((n, i) => {
    const d = manifest[n] ? String(manifest[n].default) : 'not in the manifest';
    return `${String(i + 1).padStart(3)}  ${n}  [${[...found.get(n)].join('+')}]  production build: ${prodOn(n) ? 'on' : 'off'}  default: ${d}`;
  });
  const diff = on.length - V1_PRS_LEFT_COUNT;
  const lines = [
    `All switches on: ${on.length} phone switches found and turned on (${ON}) for this job.`,
    `V1_PRS_LEFT counted 70 phone switches (11 on in the production build); this run found ${on.length} (${diff >= 0 ? '+' : ''}${diff}), ${prodOnCount} of them on in the production build.`,
    ...rows,
    `Found but not turned on (${left.length}), each a mock or capture mode that swaps real data paths for fakes, not a feature:`,
    ...left.map((n) => `     ${n}  [${[...found.get(n)].join('+')}]`),
    `Value settings left as the code reads them (${settings.length}), manifest kind "optional", each an id, URL, key, country or environment, not a switch:`,
    ...settings.map((n) => `     ${n}  default: ${manifest[n].default}`),
    `Build metadata the phone reads through expo-constants (${metadata.length}), on in this job through switchesOn.setup.js (app.config.js run with the env above):`,
    ...metadata.map((k) => `     extra.${k} = ${builtExtra[k]}`),
    `Server switches the phone reads from GET /me/feature-flags (${serverKeys.length}), on in this job through switchesOn.setup.js:`,
    ...serverKeys.map((k) => `     ${k}`),
    `Total: ${on.length + serverKeys.length} switches on (${on.length} env, ${serverKeys.length} server); ${metadata.length} build metadata value(s) follow from the env.`,
  ];
  console.log(lines.join('\n'));

  if (on.length < 10 || serverKeys.length === 0 || metadata.some((k) => builtExtra[k] !== true)) {
    console.error(`::error::Discovery is broken: ${on.length} env switches, ${serverKeys.length} server switches, build metadata ${JSON.stringify(builtExtra)}.`);
    process.exit(1);
  }
  const envFile = process.env.GITHUB_ENV;
  if (envFile) {
    fs.appendFileSync(envFile, on.map((n) => `${n}=${ON}\n`).join('') + `ALL_SWITCHES_ON_NAMES=${on.join(',')}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '```\n' + lines.join('\n') + '\n```\n');
  }
}

function report(file) {
  if (!file || !fs.existsSync(file)) {
    console.log('No jest result file: the test step did not finish (see its log).');
    return;
  }
  const r = readJson(file);
  const failed = [];
  for (const s of r.testResults || []) {
    const suite = path.relative(process.cwd(), s.name);
    const tests = (s.assertionResults || []).filter((a) => a.status === 'failed');
    if (s.status !== 'failed') continue;
    if (tests.length === 0) {
      failed.push(`${suite} :: (suite failed to run) ${String(s.message || '').split('\n').find((l) => l.trim()) || ''}`.trim());
    }
    for (const t of tests) {
      const why = String((t.failureMessages || [])[0] || '').split('\n').find((l) => l.trim()) || '';
      failed.push(`${suite} :: ${t.fullName} :: ${why.trim().slice(0, 200)}`);
    }
  }
  const head = `All switches on: ${r.numFailedTests} failed tests in ${r.numFailedTestSuites} failed suites (of ${r.numTotalTests} tests in ${r.numTotalTestSuites} suites).`;
  const lines = [head, ...failed.map((f, i) => `${String(i + 1).padStart(3)}  ${f}`)];
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '```\n' + lines.join('\n') + '\n```\n');
  }
}

const [mode, arg] = process.argv.slice(2);
if (mode === 'find') find();
else if (mode === 'report') report(arg);
else {
  console.error('usage: switches.js find | report <jest --json file>');
  process.exit(2);
}
