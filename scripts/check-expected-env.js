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
 *   5. any EXPO_PUBLIC_* name (read, declared or set in eas.json) is shaped
 *      like a secret (SECRET, PASSWORD, SERVICE_ROLE, PRIVATE_KEY, WEBHOOK,
 *      or a trailing _SK): every EXPO_PUBLIC_* value is compiled into the
 *      bundle, so such a name is a leak by construction (Opus C-319-1).
 *
 * `--release-env` additionally checks the current process environment (for an
 * EAS build hook): every `kind: required` name is non-empty, the Stripe
 * publishable key starts with pk_live_ or pk_test_, and no secret-shaped
 * EXPO_PUBLIC_* name is set (Opus C-319-2). Values are never printed.
 *
 * With a release profile (`--profile <name>`, or EAS_BUILD_PROFILE on an EAS
 * builder) and that profile listed under `releaseProfiles` in the manifest,
 * `--release-env` also fails when (S-RELEASE-MOB):
 *   - a checked value (every `kind: required` name plus the profile's
 *     `require` list) is missing or a placeholder (your_..._here,
 *     REPLACE_WITH_*, <...>, ${...}, changeme, a masked *****, ...);
 *   - a URL-shaped value is not https on a real host (no localhost, private
 *     emulator hosts, example.*, *.invalid / *.test / *.local);
 *   - the Supabase anon key is not a JWT with role "anon" (a service_role or
 *     sb_secret_ key in the bundle is a full database bypass) nor an
 *     sb_publishable_ key;
 *   - the Sentry DSN is not https://<key>@<host>/<project>;
 *   - the Stripe key is not pk_live_ on a `stripe: "live"` profile;
 *   - an eas.json build.<profile>.env value (after `extends`) is overridden
 *     with a different value in the build environment.
 * `--eas-hook` is the EAS `eas-build-pre-install` mode: it runs before
 * `npm install` (no TypeScript yet), so it skips the source scan (CI runs it)
 * and skips profiles that are not release profiles (development).
 * `--list` prints the names a profile checks, without values.
 *
 * A "read" is a literal `process.env.EXPO_PUBLIC_X` / `process.env['EXPO_PUBLIC_X']`
 * member expression (optional chaining included), a literal key destructured
 * from `process.env`, or a literal key passed to the flag helpers
 * (`readFlag('EXPO_PUBLIC_X', ...)`, `envBool('EXPO_PUBLIC_X', ...)`), which
 * is how the FF_ names are read. Dynamic prefix helpers (e.g. a bare
 * 'EXPO_PUBLIC_FF_' prefix string) are not reads.
 *
 * The scan is syntax-aware (B-319-1): every file is parsed with the
 * TypeScript compiler (a devDependency, present after `npm ci`) and only real
 * member / element / call / destructuring nodes count. Comments are trivia
 * the parser never visits, and string or template contents are never read as
 * code, so `"coach // note"` cannot hide a read after it and the string
 * "process.env.EXPO_PUBLIC_X" is not a read. A file that does not parse fails
 * the guard instead of being skipped (fail closed). app.json is data, not
 * code, and has no reads.
 *
 * Scope: src/** (excluding tests and .d.ts), App.tsx, index.ts,
 * metro.config.js, babel.config.js, plugins/**, app.config.* and app.json.
 *
 *   node scripts/check-expected-env.js [--root <dir>] [--release-env]
 */
'use strict';
/* eslint-disable @typescript-eslint/no-var-requires -- CommonJS node script */
const fs = require('fs');
const path = require('path');

const KINDS = new Set(['required', 'optional', 'flag']);
// Name segments that mark a credential. PRIVATE alone is not one
// (EXPO_PUBLIC_FF_PRIVATE_COMMUNITY_HUB is a feature flag); PRIVATE_KEY is.
const SECRET_SHAPED = /(?:^|_)(SECRET|PASSWORD|PASSWD|SERVICE_ROLE|PRIVATE_KEY|WEBHOOK)(?:_|$)|_(SK)$/;
const STRIPE_PUBLISHABLE = 'EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY';

/** The secret-shaped segment in an EXPO_PUBLIC_* name, or undefined. */
function secretShape(name) {
  const m = SECRET_SHAPED.exec(String(name).replace(/^EXPO_PUBLIC_/, ''));
  return m ? m[1] || m[2] : undefined;
}

function secretShapeError(name, where) {
  return `${name} looks like a secret (name contains ${secretShape(name)}) and is ${where}, but every EXPO_PUBLIC_* value is compiled into the app bundle and readable by anyone who downloads the app. Fix: keep the value server-side and reach it through the API, then delete the name from config/expected-env.json, eas.json and every EAS environment (eas env:list, eas env:delete).`;
}
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

const READ_HELPERS = new Set(['readFlag', 'envBool']);
const PUBLIC_NAME = /^EXPO_PUBLIC_[A-Z0-9_]+$/;

let tsModule;
/** The TypeScript compiler, loaded lazily with an actionable error when absent. */
function loadTypeScript() {
  if (tsModule) return tsModule;
  try {
    tsModule = require('typescript');
  } catch (err) {
    throw new Error(
      `check-expected-env needs the "typescript" package (a devDependency) to parse sources, and it could not be loaded (${err && err.message ? err.message.split('\n')[0] : err}). Fix: run npm ci in the repository root, then re-run node scripts/check-expected-env.js.`,
    );
  }
  return tsModule;
}

function scriptKindFor(ts, fileName) {
  if (/\.tsx$/.test(fileName)) return ts.ScriptKind.TSX;
  if (/\.ts$/.test(fileName)) return ts.ScriptKind.TS;
  if (/\.jsx$/.test(fileName)) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

function unwrap(ts, node) {
  let cur = node;
  while (
    cur &&
    (ts.isParenthesizedExpression(cur) ||
      ts.isNonNullExpression(cur) ||
      ts.isAsExpression(cur) ||
      ts.isTypeAssertionExpression(cur) ||
      (ts.isSatisfiesExpression && ts.isSatisfiesExpression(cur)))
  ) {
    cur = cur.expression;
  }
  return cur;
}

/** `process.env` or `process['env']`. */
function isProcessEnv(ts, raw) {
  const node = unwrap(ts, raw);
  if (!node) return false;
  if (ts.isPropertyAccessExpression(node)) {
    const recv = unwrap(ts, node.expression);
    return ts.isIdentifier(recv) && recv.text === 'process' && node.name.text === 'env';
  }
  if (ts.isElementAccessExpression(node)) {
    const recv = unwrap(ts, node.expression);
    const key = node.argumentExpression;
    return (
      ts.isIdentifier(recv) && recv.text === 'process' && !!key && ts.isStringLiteralLike(key) && key.text === 'env'
    );
  }
  return false;
}

/** Literal text of a string / no-substitution template key, else undefined. */
function literalKey(ts, raw) {
  const node = unwrap(ts, raw);
  return node && ts.isStringLiteralLike(node) ? node.text : undefined;
}

/**
 * Parse one source text and return the EXPO_PUBLIC_* names it really reads,
 * plus any syntax errors (a file with syntax errors fails the guard).
 */
function analyzeSource(code, fileName = 'input.tsx') {
  const ts = loadTypeScript();
  const sf = ts.createSourceFile(fileName, String(code), ts.ScriptTarget.Latest, true, scriptKindFor(ts, fileName));
  const names = new Set();
  const add = (n) => {
    if (typeof n === 'string' && PUBLIC_NAME.test(n)) names.add(n);
  };
  const visit = (node) => {
    // process.env.EXPO_PUBLIC_X / process.env?.EXPO_PUBLIC_X
    if (ts.isPropertyAccessExpression(node) && isProcessEnv(ts, node.expression)) {
      add(node.name.text);
    }
    // process.env['EXPO_PUBLIC_X'] / process.env[`EXPO_PUBLIC_X`]
    if (ts.isElementAccessExpression(node) && isProcessEnv(ts, node.expression)) {
      add(literalKey(ts, node.argumentExpression));
    }
    // const { EXPO_PUBLIC_X, EXPO_PUBLIC_Y: y, ['EXPO_PUBLIC_Z']: z } = process.env
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      isProcessEnv(ts, node.initializer)
    ) {
      for (const el of node.name.elements) {
        if (el.dotDotDotToken) continue;
        const key = el.propertyName;
        if (!key && ts.isIdentifier(el.name)) add(el.name.text);
        else if (key && (ts.isIdentifier(key) || ts.isStringLiteralLike(key))) add(key.text);
        else if (key && ts.isComputedPropertyName(key)) add(literalKey(ts, key.expression));
      }
    }
    // readFlag('EXPO_PUBLIC_FF_X', ...) / envBool('EXPO_PUBLIC_FF_X', ...) / x.readFlag(...)
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const callee = unwrap(ts, node.expression);
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : undefined;
      if (name && READ_HELPERS.has(name)) add(literalKey(ts, node.arguments[0]));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  // parseDiagnostics is the parser's own syntax-error list (not a type check).
  const parseErrors = (sf.parseDiagnostics || []).map((d) => {
    const line = typeof d.start === 'number' ? sf.getLineAndCharacterOfPosition(d.start).line + 1 : 0;
    return {
      line,
      message: ts.flattenDiagnosticMessageText(d.messageText, ' '),
    };
  });
  return { names: [...names].sort(), parseErrors };
}

/** EXPO_PUBLIC_* names read in one source text (syntax-aware). */
function findReads(code, fileName = 'input.tsx') {
  return analyzeSource(code, fileName).names;
}

/** Scan every runtime file: name -> files that read it, plus files that do not parse. */
function scanSources(root) {
  const reads = new Map();
  const unparsable = [];
  for (const rel of runtimeFiles(root)) {
    if (/\.json$/.test(rel)) continue; // data, not code
    const { names, parseErrors } = analyzeSource(fs.readFileSync(path.join(root, rel), 'utf8'), rel);
    if (parseErrors.length > 0) unparsable.push({ file: rel, ...parseErrors[0] });
    for (const n of names) {
      const list = reads.get(n) || [];
      list.push(rel);
      reads.set(n, list);
    }
  }
  return { reads, unparsable };
}

/** Map name -> files that read it. */
function scanReads(root) {
  return scanSources(root).reads;
}

/** EXPO_PUBLIC_* names set in eas.json build profiles. */
function easEnvNames(root) {
  const p = path.join(root, 'eas.json');
  if (!fs.existsSync(p)) return [];
  let eas;
  try {
    eas = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    throw new Error(
      `eas.json is not valid JSON (${err.message}), so the EXPO_PUBLIC_* names it sets cannot be checked. Fix: correct eas.json, then re-run.`,
    );
  }
  const names = new Set();
  for (const profile of Object.values((eas && eas.build) || {})) {
    for (const k of Object.keys((profile && profile.env) || {})) {
      if (k.startsWith('EXPO_PUBLIC_')) names.add(k);
    }
  }
  return [...names].sort();
}

function loadManifest(root) {
  const p = path.join(root, 'config', 'expected-env.json');
  let text;
  try {
    text = fs.readFileSync(p, 'utf8');
  } catch {
    throw new Error(
      'config/expected-env.json is missing, so EXPO_PUBLIC_* reads cannot be checked. Fix: restore it from main (it lists every EXPO_PUBLIC_* name with kind, default and reason).',
    );
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(
      `config/expected-env.json is not valid JSON (${err.message}). Fix: correct the JSON, then re-run node scripts/check-expected-env.js.`,
    );
  }
}

function check(root) {
  const manifest = loadManifest(root);
  const vars = manifest.vars || {};
  const declared = new Set(Object.keys(vars));
  const { reads, unparsable } = scanSources(root);
  const errors = [];
  for (const u of unparsable) {
    errors.push(
      `${u.file} does not parse (line ${u.line}: ${u.message}), so its EXPO_PUBLIC_* reads cannot be checked. Fix: correct the syntax error.`,
    );
  }
  for (const [name, files] of [...reads.entries()].sort()) {
    if (!declared.has(name)) {
      errors.push(
        `${name} is read by ${files.join(', ')} but is not declared in config/expected-env.json. Fix: add it under "vars" with kind (required|optional|flag), default and reason, or remove the read.`,
      );
    }
  }
  for (const name of [...declared].sort()) {
    if (!reads.has(name)) {
      errors.push(
        `${name} is declared in config/expected-env.json but nothing reads it. Fix: remove the entry, or restore the read as a literal process.env.${name}.`,
      );
    }
    const v = vars[name] || {};
    if (!KINDS.has(v.kind)) {
      errors.push(
        `${name}: kind ${JSON.stringify(v.kind)} is not one of required|optional|flag. Fix: set its kind in config/expected-env.json.`,
      );
    }
    if (typeof v.default !== 'string' || !v.default.trim()) {
      errors.push(
        `${name}: default is empty. Fix: record in config/expected-env.json what the app does when ${name} is unset.`,
      );
    }
    if (typeof v.reason !== 'string' || !v.reason.trim()) {
      errors.push(`${name}: reason is empty. Fix: say in config/expected-env.json why the app reads it.`);
    }
  }
  for (const name of easEnvNames(root)) {
    if (!declared.has(name)) {
      errors.push(
        `${name} is set in eas.json but not declared in config/expected-env.json. Fix: declare it, or remove it from eas.json if nothing reads it.`,
      );
    }
  }
  const easNames = new Set(easEnvNames(root));
  for (const name of [...new Set([...reads.keys(), ...declared, ...easNames])].sort()) {
    if (!secretShape(name)) continue;
    const where = [
      reads.has(name) ? `read by ${reads.get(name).join(', ')}` : '',
      declared.has(name) ? 'declared in config/expected-env.json' : '',
      easNames.has(name) ? 'set in eas.json' : '',
    ]
      .filter(Boolean)
      .join(', ');
    errors.push(secretShapeError(name, where));
  }
  return { errors, reads, declared };
}

const PLACEHOLDER_VALUE =
  /^(?:your[_-].*|.*[_-]here|change[_-]?me|placeholder|todo|tbd|x{3,}|dummy|sample|null|undefined|none|false|true|0|-)$/i;
const PLACEHOLDER_ANYWHERE = /REPLACE_WITH_|<[^>]*>|\$\{[^}]*\}|^\$[A-Z_]+$|^\*{3,}/;
const URL_NAMES = new Set(['EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_HELP_BASE_URL']);
const BAD_HOST =
  /^(?:localhost|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.0\.2\.2|10\.0\.3\.2|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)$|(?:^|\.)example\.(?:com|org|net)$|\.(?:example|invalid|test|localhost|local)$/i;
const SENTRY_DSN = /^https:\/\/[A-Za-z0-9]+@[A-Za-z0-9.-]+(?::\d{1,5})?(?:\/[A-Za-z0-9._-]+)*\/\d+$/;

/** Why `value` is not a usable release value for `name`, or undefined. Never includes the value. */
function valueProblem(name, value, profileSpec = {}) {
  const v = String(value == null ? '' : value).trim();
  if (!v) return 'is unset or empty';
  if (PLACEHOLDER_VALUE.test(v) || PLACEHOLDER_ANYWHERE.test(v)) return 'is a placeholder, not a real value';
  if (URL_NAMES.has(name)) {
    let u;
    try {
      u = new URL(v);
    } catch {
      return 'is not a URL';
    }
    if (u.protocol !== 'https:') return `must be an https URL (got ${u.protocol.replace(':', '')})`;
    if (BAD_HOST.test(u.hostname)) return 'points at a local, private or example host';
  }
  if (name === 'EXPO_PUBLIC_SUPABASE_ANON_KEY') {
    if (/^sb_secret_/.test(v)) return 'is a Supabase SECRET key (sb_secret_); it bypasses row-level security and must never be in the app';
    if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(v)) {
      const parts = v.split('.');
      if (parts.length !== 3) return 'is not a Supabase anon key (expected a JWT or an sb_publishable_ key)';
      let payload;
      try {
        payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
      } catch {
        return 'is not a Supabase anon key (the JWT payload does not decode)';
      }
      if (payload && payload.role === 'service_role') return 'is the Supabase SERVICE ROLE key; it bypasses row-level security and must never be in the app';
      if (!payload || payload.role !== 'anon') return 'is not a Supabase anon key (JWT role is not "anon")';
    }
  }
  if (name === 'EXPO_PUBLIC_SENTRY_DSN' && !SENTRY_DSN.test(v)) return 'is not a Sentry DSN (https://<key>@<host>/<project-id>)';
  if (name === STRIPE_PUBLISHABLE) {
    if (!/^pk_(live|test)_/.test(v)) return 'does not start with pk_live_ or pk_test_; a secret (sk_) or restricted (rk_) key must never be in an EXPO_PUBLIC_* variable';
    if (profileSpec.stripe === 'live' && !/^pk_live_/.test(v)) return 'is a Stripe TEST key on a store profile (needs pk_live_)';
  }
  return undefined;
}

/** releaseProfiles entry plus its resolved eas.json profile, or { skip } / { error }. */
function releaseProfile(root, manifest, profile) {
  const specs = (manifest && manifest.releaseProfiles) || {};
  if (!profile) return { skip: 'no build profile given (use --profile <name>, or EAS_BUILD_PROFILE on EAS)' };
  const spec = specs[profile];
  if (!spec || typeof spec !== 'object' || profile.startsWith('$')) {
    return { skip: `profile "${profile}" is not a release profile in config/expected-env.json releaseProfiles` };
  }
  let resolved;
  try {
    const { loadEas, resolveProfile } = require('./eas-profile');
    resolved = resolveProfile(loadEas(root), profile);
  } catch (err) {
    return { error: `${err.message} Fix: keep config/expected-env.json releaseProfiles and eas.json build profiles in step.` };
  }
  return { spec, env: resolved.env || {} };
}

/** Names a release profile checks (kind:required plus `require`), sorted. */
function checkedNames(vars, spec) {
  const names = new Set(Object.keys(vars).filter((n) => vars[n] && vars[n].kind === 'required'));
  for (const n of (spec && spec.require) || []) names.add(n);
  return [...names].sort();
}

/**
 * Release-environment check for an EAS build hook. Reads names from `env`,
 * never prints a value. With `opts.profile` naming a release profile it also
 * runs the per-profile checks described at the top of this file.
 */
function checkReleaseEnv(root, env = process.env, opts = {}) {
  const manifest = loadManifest(root);
  const vars = manifest.vars || {};
  const errors = [];
  const notes = [];
  const rp = opts.profile !== undefined ? releaseProfile(root, manifest, opts.profile) : { skip: 'no profile' };
  if (rp.error) errors.push(rp.error);
  if (opts.hook) {
    // EAS pre-install: fail closed without a profile name; skip dev builds.
    if (!opts.profile) {
      return {
        errors: ['EAS_BUILD_PROFILE is unset, so the release-env check cannot tell which build profile this is (fails closed). Fix: run the build through eas build, or pass --profile <name>.'],
        notes,
        skipped: false,
      };
    }
    if (rp.skip) return { errors, notes: [rp.skip], skipped: true };
  }
  if (rp.spec) {
    // eas.json profile env sits under the build environment (on EAS the
    // builder already merged it; locally it fills what the shell lacks).
    const effective = { ...rp.env, ...env };
    const appExtraDsn = readAppExtraDsn(root);
    for (const name of checkedNames(vars, rp.spec)) {
      if (name === 'EXPO_PUBLIC_SENTRY_DSN' && !String(effective[name] || '').trim() && appExtraDsn) {
        const p = valueProblem(name, appExtraDsn, rp.spec);
        if (p) errors.push(`expo.extra.sentryDsn in app.json ${p} (value not printed). Fix: put the DSN from Sentry → Project Settings → Client Keys in the EAS environment as EXPO_PUBLIC_SENTRY_DSN, then rebuild.`);
        continue;
      }
      const p = valueProblem(name, effective[name], rp.spec);
      if (p) {
        errors.push(
          `${name} ${p} for release profile "${opts.profile}" (value not printed). Fix: set the real value in the EAS environment for this profile (eas env:create --environment <environment> --name ${name} --value <value>, or eas env:update), then rebuild.`,
        );
      }
    }
    for (const [name, want] of Object.entries(rp.env).sort()) {
      if (env[name] !== undefined && String(env[name]) !== String(want)) {
        errors.push(
          `${name} is ${JSON.stringify(String(want))} in eas.json build.${opts.profile}.env but this build environment has a different value (not printed). Fix: remove or correct the EAS variable or shell export so the binary gets the reviewed eas.json value, then rebuild.`,
        );
      }
    }
    notes.push(`release profile "${opts.profile}": checked ${checkedNames(vars, rp.spec).length} values and ${Object.keys(rp.env).length} eas.json profile values`);
  } else {
    if (rp.skip && opts.profile !== undefined) notes.push(rp.skip);
    for (const name of Object.keys(vars).sort()) {
      if (vars[name] && vars[name].kind === 'required' && !String(env[name] || '').trim()) {
        errors.push(
          `${name} is kind "required" in config/expected-env.json but is unset or empty in this build environment. Fix: set it for this EAS environment (eas env:create --name ${name} --environment <environment>), then rebuild.`,
        );
      }
    }
    const pk = String(env[STRIPE_PUBLISHABLE] || '').trim();
    if (pk && !/^pk_(live|test)_/.test(pk)) {
      errors.push(
        `${STRIPE_PUBLISHABLE} is set but does not start with pk_live_ or pk_test_ (value not printed). Fix: set it to the publishable key from the Stripe dashboard; a secret (sk_) or restricted (rk_) key must never be in an EXPO_PUBLIC_* variable.`,
      );
    }
  }
  for (const name of Object.keys(env).sort()) {
    if (name.startsWith('EXPO_PUBLIC_') && secretShape(name)) {
      errors.push(secretShapeError(name, 'set in this build environment'));
    }
  }
  return { errors, notes, skipped: !rp.spec };
}

function readAppExtraDsn(root) {
  try {
    const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
    const v = app && app.expo && app.expo.extra && app.expo.extra.sentryDsn;
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** Human list of what a release profile checks (names only). */
function describeProfile(root, profile) {
  const manifest = loadManifest(root);
  const rp = releaseProfile(root, manifest, profile);
  if (!rp.spec) return [rp.error || rp.skip];
  return [
    `release profile "${profile}" (stripe: ${rp.spec.stripe || 'any'}) checks these values are set and not placeholders:`,
    ...checkedNames(manifest.vars || {}, rp.spec).map((n) => `  ${n}`),
    `and that these eas.json build.${profile}.env values reach the build unchanged:`,
    ...Object.keys(rp.env)
      .sort()
      .map((n) => `  ${n}`),
  ];
}

module.exports = {
  checkReleaseEnv,
  valueProblem,
  checkedNames,
  describeProfile,
  secretShape,
  analyzeSource,
  findReads,
  runtimeFiles,
  scanReads,
  scanSources,
  easEnvNames,
  check,
  KINDS,
};

if (require.main === module) {
  const argOf = (flag) => {
    const i = process.argv.indexOf(flag);
    return i > -1 ? process.argv[i + 1] : undefined;
  };
  const root = argOf('--root') ? path.resolve(argOf('--root')) : path.resolve(__dirname, '..');
  const hook = process.argv.includes('--eas-hook');
  const releaseEnv = hook || process.argv.includes('--release-env');
  const profile = argOf('--profile') || (releaseEnv ? process.env.EAS_BUILD_PROFILE : undefined);
  if (process.argv.includes('--list')) {
    try {
      for (const line of describeProfile(root, profile)) console.log(`[expected-env] ${line}`);
    } catch (err) {
      console.error(`[expected-env] ${err && err.message ? err.message : err}`);
      process.exit(1);
    }
    process.exit(0);
  }
  let result;
  let release = { errors: [], notes: [], skipped: true };
  try {
    // The EAS pre-install hook runs before npm install: no TypeScript yet, so
    // the source scan is left to CI (node scripts/check-expected-env.js).
    result = hook ? { errors: [], reads: new Map() } : check(root);
    if (releaseEnv) {
      release = checkReleaseEnv(root, process.env, { profile, hook });
      result.errors.push(...release.errors);
    }
  } catch (err) {
    console.error(`[expected-env] ${err && err.message ? err.message : err}`);
    process.exit(1);
  }
  for (const n of release.notes) console.log(`[expected-env] ${n}`);
  const { errors, reads } = result;
  if (errors.length) {
    for (const e of errors) console.error(`[expected-env] ${e}`);
    console.error(`[expected-env] ${errors.length} problem(s); each line above says how to fix it.`);
    process.exit(1);
  }
  if (hook) {
    console.log(
      release.skipped
        ? `[expected-env] EAS pre-install: build profile ${JSON.stringify(profile || null)} is not a release profile; release-env check skipped.`
        : `[expected-env] EAS pre-install: release environment for "${profile}" OK.`,
    );
  } else {
    console.log(
      `[expected-env] OK: ${reads.size} EXPO_PUBLIC_* names read, all in the manifest${releaseEnv ? (release.skipped ? '; release environment has every required name' : `; release environment for "${profile}" passes every check`) : ''}.`,
    );
  }
}
