#!/usr/bin/env node
/**
 * Guarded EAS Update publish (audit #305 A1 / B1; re-audit B2; S-RELEASE-MOB
 * clinic channel; S-RELEASE-3 B-305-5 / B-305-6 / B-305-8 / B-305-9).
 *
 *   npm run update:publish -- --channel clinic --environment production --message "<what changed>"
 *   npm run update:publish -- --channel production --environment production --message "<what changed>"
 *   npm run update:publish -- --channel preview --environment preview --message "<what changed>"
 *   add --rollout-percentage <1-100> for a staged rollout (forwarded to eas update)
 *   add --dry-run to run every check without publishing
 *
 *   npm run update:sourcemaps -- --channel clinic --environment production
 *     uploads the source maps of the update already exported in dist/ to
 *     Sentry again, without publishing (the next step after a failed upload)
 *
 * The channel names a build profile in eas.json (resolved through `extends`;
 * scripts/eas-profile.js). It refuses to publish unless all of these hold:
 *   1. Arguments: only the options above; exactly one eas.json build profile
 *      uses the channel; --environment equals that profile's `environment`
 *      (SDK 55+ requires it); --message is non-empty; --rollout-percentage,
 *      when given, is a whole number from 1 to 100.
 *   2. src/config/purchaseSurfaces.ts matches the reviewed hash in
 *      scripts/purchase-policy.sha256.
 *   3. The REMOTE EAS project variable EXPO_PUBLIC_FF_IOS_HIDE_NON_P2P_PURCHASES
 *      in the target environment is exactly "true" (`eas env:get`, flag
 *      removed from the child's environment, exactly one `NAME=true` record;
 *      missing, empty, masked, duplicate, unparsable and failed lookups all
 *      refuse). A locally exported value is never trusted.
 *   4. The same flag is not set to anything other than "true" in the local
 *      shell.
 *   5. The bundle this update would ship is the bundle the binary was built
 *      with. `eas update --environment <e>` exports with
 *      `{ ...process.env, ...EAS plaintext and sensitive values }` and never
 *      sees `secret` values (EAS builders only). The guard reads both scopes
 *      with `eas env:list <e> --format short --scope <s> --include-sensitive`
 *      and refuses when a name that reaches the bundle (every EXPO_PUBLIC_*
 *      and every eas.json profile env name):
 *        - has a secret, file, masked or unrevealed record (the update could
 *          not carry the value the binary has),
 *        - is set more than once with different values (project vs account
 *          precedence is not documented, so the shipped value is undefined),
 *        - differs from the eas.json build.<profile>.env value (after
 *          `extends`) that the channel's binaries were built with.
 *      The publish child gets the profile env; every other local EXPO_PUBLIC_*
 *      is dropped, so a stray export never reaches the bundle.
 *   6. The effective bundle values pass the same release-value checks as the
 *      build (scripts/check-expected-env.js valueProblem, #333): every
 *      `kind: required` name and the profile's `releaseProfiles.<p>.require`
 *      list is set, not a placeholder, and well formed (https URL on a real
 *      host, anon Supabase key, Sentry DSN, Stripe publishable key of the
 *      profile's mode); no secret-shaped EXPO_PUBLIC_* name is set.
 *   7. Sentry symbolication: when the bundle reports to Sentry (a DSN is set),
 *      a usable SENTRY_AUTH_TOKEN is available (local shell, else a plaintext
 *      or sensitive EAS variable in the target environment) and app.json names
 *      the Sentry organization and project. After eas update succeeds, the
 *      guard checks that dist/ holds fresh source maps with Sentry Debug IDs
 *      for iOS and Android and uploads them with sentry-expo-upload-sourcemaps
 *      (@sentry/react-native). A failed upload exits non-zero and names the
 *      re-upload command.
 *
 * Diagnostics never contain a configured value (B-305-8): only the variable
 * name, its scope, a fixed category and the repair command. The reviewed
 * eas.json value may be shown, because it is the expected policy.
 *
 * This is governance, not proof: someone with EAS access can still run
 * `eas update` directly. The runtime gate is anchored to the native build
 * number and the gate file is a fingerprint input (fingerprint.config.js),
 * so a changed threshold produces a new runtime that existing binaries
 * never download.
 */
'use strict';
/* eslint-disable @typescript-eslint/no-var-requires -- CommonJS node script */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadEas, resolveProfile, channelProfiles } = require('./eas-profile');
const { valueProblem, checkedNames, secretShape } = require('./check-expected-env');

const ROOT = path.resolve(__dirname, '..');
const FLAG = 'EXPO_PUBLIC_FF_IOS_HIDE_NON_P2P_PURCHASES';
const SENTRY_DSN = 'EXPO_PUBLIC_SENTRY_DSN';
const SENTRY_TOKEN = 'SENTRY_AUTH_TOKEN';
const SENTRY_PLUGIN = '@sentry/react-native/expo';
const POLICY_FILE = path.join('src', 'config', 'purchaseSurfaces.ts');
const LOCK_FILE = path.join('scripts', 'purchase-policy.sha256');
const METADATA_FILE = 'eas-update-metadata.json';
const PLATFORMS = ['ios', 'android'];
// Source maps written more than this long before the publish started belong
// to an older export (clock granularity margin only).
const FRESHNESS_SLACK_MS = 5000;

const VALUE_OPTIONS = ['channel', 'environment', 'message', 'rollout-percentage'];
const BOOLEAN_OPTIONS = ['dry-run', 'sourcemaps-only'];

/**
 * Strict argument parser. Returns { args, errors }; anything that is not one
 * of the supported options is refused rather than ignored (B-305-5).
 */
function parseArgs(argv) {
  const args = { dryRun: false, sourcemapsOnly: false };
  const errors = [];
  const list = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < list.length; i += 1) {
    const a = String(list[i]);
    if (!a.startsWith('--')) {
      errors.push(`unexpected argument at position ${i + 1}; options are --${[...VALUE_OPTIONS, ...BOOLEAN_OPTIONS].join(', --')}. Fix: quote a --message that contains spaces.`);
      continue;
    }
    const eq = a.indexOf('=');
    const key = eq === -1 ? a.slice(2) : a.slice(2, eq);
    if (BOOLEAN_OPTIONS.includes(key)) {
      if (eq !== -1) errors.push(`--${key} takes no value`);
      else if (key === 'dry-run') args.dryRun = true;
      else args.sourcemapsOnly = true;
      continue;
    }
    if (!VALUE_OPTIONS.includes(key)) {
      errors.push(`--${key} is not supported by the guarded publish (options: --${[...VALUE_OPTIONS, ...BOOLEAN_OPTIONS].join(', --')}). Fix: remove it; every publish goes through this guard.`);
      if (eq === -1 && i + 1 < list.length && !String(list[i + 1]).startsWith('--')) i += 1;
      continue;
    }
    let value;
    if (eq !== -1) value = a.slice(eq + 1);
    else if (i + 1 < list.length && !String(list[i + 1]).startsWith('--')) {
      value = String(list[i + 1]);
      i += 1;
    } else {
      errors.push(`--${key} needs a value`);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(args, key)) errors.push(`--${key} is given more than once`);
    args[key] = value;
  }
  return { args, errors };
}

/** channel -> { profile, environment, env } from eas.json, or { error }. */
function loadChannels(root = ROOT) {
  try {
    const eas = loadEas(root);
    const out = {};
    for (const [channel, profiles] of Object.entries(channelProfiles(eas))) {
      const p = resolveProfile(eas, profiles[0]);
      out[channel] = { profiles, profile: profiles[0], environment: p.environment, env: p.env || {} };
    }
    return out;
  } catch (err) {
    const msg = String((err && err.message) || err);
    // A JSON parse message can quote a fragment of the file; keep it out.
    return { error: /^eas\.json is not valid JSON/.test(msg) ? 'eas.json is not valid JSON. Fix: correct eas.json (your editor shows the position), then re-run.' : msg };
  }
}

/** Whole number from 1 to 100, else undefined. */
function rolloutPercentage(raw) {
  if (raw === undefined) return undefined;
  if (!/^\d{1,3}$/.test(String(raw))) return NaN;
  const n = Number(raw);
  return n >= 1 && n <= 100 ? n : NaN;
}

function checkArgs(args, channels = loadChannels(), opts = {}) {
  const errors = [];
  if (channels.error) return [channels.error];
  const known = Object.keys(channels).sort();
  const target = channels[args.channel];
  if (!target) {
    errors.push(`--channel must be one of ${known.join(', ')} (the channels set in eas.json), got ${JSON.stringify(args.channel)}`);
  } else if (target.profiles.length !== 1) {
    errors.push(`channel "${args.channel}" is used by ${target.profiles.length} eas.json profiles (${target.profiles.join(', ')}); each channel must belong to exactly one build profile`);
  }
  const expectedEnv = target && target.environment;
  if (!args.environment) {
    errors.push(`--environment is required (SDK 55+); use ${expectedEnv ? `"${expectedEnv}"` : "the profile's environment"}`);
  } else if (target && args.environment !== expectedEnv) {
    errors.push(`--environment (${args.environment}) must equal eas.json build.${target.profile}.environment (${JSON.stringify(expectedEnv)}) for channel "${args.channel}"`);
  }
  if (opts.sourcemapsOnly) {
    if (args.message !== undefined || args['rollout-percentage'] !== undefined || args.dryRun) {
      errors.push('--sourcemaps-only uploads the source maps of the update already in dist/ and publishes nothing; it takes only --channel and --environment');
    }
    return errors;
  }
  if (!args.message || !String(args.message).trim()) errors.push('--message is required');
  if (Number.isNaN(rolloutPercentage(args['rollout-percentage']))) {
    errors.push('--rollout-percentage must be a whole number from 1 to 100 (the share of this channel\'s devices that get the update first). Fix: for example --rollout-percentage 10, then raise it with eas update:edit once Sentry stays quiet.');
  }
  return errors;
}

function policyHash(root = ROOT) {
  const buf = fs.readFileSync(path.join(root, POLICY_FILE));
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function checkPolicyHash(root = ROOT) {
  const lockPath = path.join(root, LOCK_FILE);
  if (!fs.existsSync(lockPath)) return [`${LOCK_FILE} is missing`];
  const pinned = fs.readFileSync(lockPath, 'utf8').trim().split(/\s+/)[0];
  const actual = policyHash(root);
  return pinned === actual
    ? []
    : [`${POLICY_FILE} changed (sha256 ${actual}) but ${LOCK_FILE} pins ${pinned}; get the purchase-policy change reviewed and update the lock`];
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

/**
 * Parse `eas env:get <env> --variable-name FLAG --format short` output.
 * Returns { value } only for exactly one well-formed `FLAG=<value>` line.
 */
function parseRemoteValue(stdout, stderr) {
  const out = String(stdout || '').replace(ANSI, '');
  const err = String(stderr || '').replace(ANSI, '');
  if (/not found/i.test(out) || /not found/i.test(err)) return { error: `${FLAG} not found in the EAS environment` };
  const lines = out.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith(`${FLAG}=`));
  if (lines.length === 0) return { error: `no ${FLAG} record in eas env:get output` };
  if (lines.length > 1) return { error: `ambiguous: ${lines.length} ${FLAG} records` };
  return { value: lines[0].slice(FLAG.length + 1) };
}

/** Fixed description of a value that is not "true" (never the value itself). */
function flagValueCategory(value) {
  if (value === undefined || value === null) return 'is unset';
  const v = String(value);
  if (!v.trim()) return 'is empty';
  if (/^\*{3,}/.test(v)) return 'is masked (sensitive or secret), so it cannot be confirmed';
  return 'holds a value other than "true" (not printed)';
}

function checkEnvValue(value) {
  return value === 'true'
    ? []
    : [`${FLAG} ${flagValueCategory(value)} in the target EAS environment; it must be exactly "true". Fix: eas env:update --variable-name ${FLAG} --variable-environment <environment> --scope project --value true --visibility plaintext (or eas env:create), then re-run.`];
}

/** The lookup child never sees a locally exported flag. */
function lookupEnv(parentEnv = process.env) {
  const env = { ...parentEnv };
  delete env[FLAG];
  return env;
}

const NAME_LINE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

/** Parse `eas env:list <env> --format short` output into name -> [values]. */
function parseEnvList(stdout) {
  const out = new Map();
  for (const raw of String(stdout || '').replace(ANSI, '').split(/\r?\n/)) {
    const m = NAME_LINE.exec(raw.trim());
    if (!m) continue;
    const list = out.get(m[1]) || [];
    list.push(m[2]);
    out.set(m[1], list);
  }
  return out;
}

const MASKED = /^\*{5}/;

/**
 * What an `env:list --include-sensitive --format short` value is. eas-cli
 * prints plaintext and (with --include-sensitive) sensitive values as they
 * are, and a `*****` marker for everything it cannot show
 * (packages/eas-cli/src/utils/variableUtils.ts formatVariableValue).
 */
function classifyRecord(value) {
  const v = String(value == null ? '' : value);
  if (!MASKED.test(v)) return 'readable';
  if (/secret env variable/i.test(v)) return 'secret';
  if (/file env variable/i.test(v)) return 'file';
  if (/sensitive env variable/i.test(v)) return 'sensitive';
  return 'masked';
}

function readRemoteList(environment, scope, run = defaultRun, parentEnv = process.env) {
  const res = run('npx', ['eas-cli', 'env:list', environment, '--format', 'short', '--scope', scope, '--include-sensitive'], {
    capture: true,
    env: lookupEnv(parentEnv),
  });
  if (!res || res.error || res.status !== 0) {
    return {
      error: `eas env:list ${environment} --scope ${scope} --include-sensitive failed (status ${res && res.status}). Fix: run npx eas-cli login with an account that can read this project's ${environment} variables, check the network, then re-run.`,
    };
  }
  return { vars: parseEnvList(res.stdout) };
}

/** Names whose value is compiled into the update or shapes its config. */
function isBundleName(name, target) {
  return name.startsWith('EXPO_PUBLIC_') || Object.prototype.hasOwnProperty.call(target.env || {}, name);
}

function unreadableText(cls) {
  switch (cls) {
    case 'secret':
      return 'has secret visibility, which only EAS builders can read, so a JavaScript update cannot carry the value the binary was built with';
    case 'file':
      return 'is a file variable, and an app value must be a string';
    case 'sensitive':
      return 'is sensitive and was not revealed by eas env:list --include-sensitive, so it cannot be checked';
    default:
      return 'shows as ***** (empty or unreadable), so it cannot be checked';
  }
}

function unreadableFix(cls, name, scope, environment) {
  if (cls === 'secret') {
    return `Fix: eas env:update --variable-name ${name} --variable-environment ${environment} --scope ${scope} --visibility sensitive (an EXPO_PUBLIC_* value is readable in the app bundle anyway), then re-run.`;
  }
  if (cls === 'sensitive') return 'Fix: make sure npx eas-cli runs eas-cli 16 or newer (npm i -g eas-cli@latest), then re-run.';
  return `Fix: set a real string value (eas env:update --variable-name ${name} --variable-environment ${environment} --scope ${scope} --value <value>) or delete it (eas env:delete --variable-name ${name} --variable-environment ${environment} --scope ${scope}), then re-run.`;
}

/**
 * Remote analysis (5): unreadable, ambiguous and parity problems for every
 * bundle name, plus the single readable value of each bundle name.
 */
function analyzeRemote(target, channel, remoteByScope) {
  const errors = [];
  const values = {};
  const unresolved = new Set();
  const names = new Set();
  for (const vars of Object.values(remoteByScope)) for (const n of vars.keys()) names.add(n);
  for (const name of [...names].sort()) {
    if (!isBundleName(name, target)) continue;
    const recs = [];
    for (const [scope, vars] of Object.entries(remoteByScope)) {
      for (const v of vars.get(name) || []) recs.push({ scope, v, cls: classifyRecord(v) });
    }
    const unreadable = recs.filter((r) => r.cls !== 'readable');
    if (unreadable.length) {
      for (const r of unreadable) {
        errors.push(`${name}: the ${r.scope}-scope EAS variable in "${target.environment}" ${unreadableText(r.cls)}. ${unreadableFix(r.cls, name, r.scope, target.environment)}`);
      }
      unresolved.add(name);
      continue;
    }
    if (new Set(recs.map((r) => r.v)).size > 1) {
      const scopes = [...new Set(recs.map((r) => r.scope))].join(' and ');
      errors.push(
        `${name} is set ${recs.length} times in EAS environment "${target.environment}" (${scopes} scope) with different values (not printed), and which one eas update uses is not defined. Fix: keep one (eas env:delete --variable-name ${name} --variable-environment ${target.environment} --scope <project|account>), then re-run.`,
      );
      unresolved.add(name);
      continue;
    }
    values[name] = recs[0].v;
    if (Object.prototype.hasOwnProperty.call(target.env, name) && values[name] !== String(target.env[name])) {
      const scopes = [...new Set(recs.map((r) => r.scope))].join(' and ');
      errors.push(
        `${name} is ${JSON.stringify(String(target.env[name]))} in eas.json build.${target.profile}.env (what channel "${channel}" binaries were built with), but the ${scopes}-scope EAS variable in "${target.environment}" holds a different value (not printed), and eas update would ship the EAS value. Fix: make the EAS variable equal (eas env:update --variable-name ${name} --variable-environment ${target.environment} --scope ${recs[0].scope} --value <the eas.json value>) or delete it (eas env:delete with the same --variable-name, --variable-environment and --scope), then re-run.`,
      );
    }
  }
  return { errors, values, unresolved };
}

/**
 * Environment for the publish child: the shell minus every EXPO_PUBLIC_* name
 * and minus the hide flag (always taken from EAS), plus the profile env.
 */
function publishEnv(parentEnv, target) {
  const env = {};
  for (const [k, v] of Object.entries(parentEnv || {})) {
    if (!k.startsWith('EXPO_PUBLIC_')) env[k] = v;
  }
  for (const [k, v] of Object.entries(target.env || {})) {
    if (k !== FLAG) env[k] = String(v);
  }
  delete env[FLAG];
  return env;
}

/** What the export sees: the publish child env with EAS values on top (eas-cli order). */
function bundleEnv(parentEnv, target, remoteValues) {
  return { ...publishEnv(parentEnv, target), ...remoteValues };
}

function readJsonFile(file) {
  try {
    return { json: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (err) {
    return { error: err && err.code === 'ENOENT' ? 'missing' : 'unreadable' };
  }
}

function appJson(root) {
  const r = readJsonFile(path.join(root, 'app.json'));
  return (r.json && r.json.expo) || {};
}

function appExtraDsn(root) {
  const extra = appJson(root).extra || {};
  const v = extra.sentryDsn;
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * Release-value checks (6) on the effective bundle env, with the same
 * valueProblem rules the build-time check uses (#333). Never prints a value.
 * `unresolved` names were already refused by analyzeRemote (one line each).
 */
function checkBundleValues(root, target, channel, effective, unresolved = new Set()) {
  const manifest = readJsonFile(path.join(root, 'config', 'expected-env.json'));
  if (!manifest.json) {
    return [`config/expected-env.json is ${manifest.error}, so the values this update ships cannot be checked. Fix: restore it from main, then re-run.`];
  }
  const vars = manifest.json.vars || {};
  const spec = (manifest.json.releaseProfiles || {})[target.profile];
  if (!spec || typeof spec !== 'object') {
    return [`config/expected-env.json releaseProfiles has no "${target.profile}" entry, so the values this update ships cannot be checked the way the build checks them. Fix: add the profile there (docs/RELEASE_ENV_CHECK.md), then re-run.`];
  }
  const errors = [];
  for (const name of checkedNames(vars, spec)) {
    if (unresolved.has(name)) continue;
    let value = effective[name];
    let where = `${name}`;
    if (name === SENTRY_DSN && !String(value || '').trim() && appExtraDsn(root)) {
      value = appExtraDsn(root);
      where = 'expo.extra.sentryDsn in app.json';
    }
    const p = valueProblem(name, value, spec);
    if (p) {
      errors.push(
        `${where} ${p} in the bundle this update would ship to channel "${channel}" (value not printed). Fix: set the real value in EAS environment "${target.environment}" (eas env:create --environment ${target.environment} --name ${name} --value <value> --visibility sensitive, or eas env:update --variable-name ${name} --variable-environment ${target.environment} --value <value>), then re-run.`,
      );
    }
  }
  for (const name of Object.keys(effective).sort()) {
    if (name.startsWith('EXPO_PUBLIC_') && secretShape(name)) {
      errors.push(
        `${name} looks like a secret (name contains ${secretShape(name)}) and would be compiled into the update, where anyone with the app can read it. Fix: keep it server-side and delete it from EAS environment "${target.environment}" (eas env:delete --variable-name ${name} --variable-environment ${target.environment} --scope <project|account>), then re-run.`,
      );
    }
  }
  if (!unresolved.has(FLAG) && effective[FLAG] !== 'true') {
    errors.push(`${FLAG} ${flagValueCategory(effective[FLAG])} in the bundle this update would ship; it must be exactly "true". Fix: keep exactly one plaintext record with the value true in EAS environment "${target.environment}", then re-run.`);
  }
  return errors;
}

/** Sentry organization / project / url from the @sentry/react-native/expo plugin entry in app.json. */
function sentryProjectConfig(root) {
  const { plugins: list } = appJson(root);
  const plugins = Array.isArray(list) ? list : [];
  const entry = plugins.find((p) => Array.isArray(p) && p[0] === SENTRY_PLUGIN);
  const cfg = (entry && entry[1]) || {};
  if (typeof cfg.organization !== 'string' || !cfg.organization || typeof cfg.project !== 'string' || !cfg.project) {
    return { error: `app.json has no ${SENTRY_PLUGIN} plugin entry with "organization" and "project", so the update's source maps have nowhere to go. Fix: restore the plugin entry from main, then re-run.` };
  }
  return { org: cfg.organization, project: cfg.project, url: typeof cfg.url === 'string' && cfg.url ? cfg.url : 'https://sentry.io/' };
}

/**
 * SENTRY_AUTH_TOKEN for the source-map upload: the local shell first, else a
 * plaintext or sensitive EAS variable (project scope before account scope).
 * Returns { token, source } or { error }; the token is never printed.
 */
function resolveSentryToken(parentEnv, remoteByScope, environment) {
  const local = String((parentEnv && parentEnv[SENTRY_TOKEN]) || '').trim();
  const fix = `Fix: create a Sentry auth token with project:releases scope (Sentry → Settings → Auth Tokens) and either export ${SENTRY_TOKEN} in this shell or store it as a sensitive EAS variable (eas env:create --environment ${environment} --name ${SENTRY_TOKEN} --value <token> --visibility sensitive), then re-run.`;
  if (local) {
    return valueProblem(SENTRY_TOKEN, local) ? { error: `${SENTRY_TOKEN} in this shell is a placeholder, not a token (value not printed). ${fix}` } : { token: local, source: 'the local shell' };
  }
  for (const scope of ['project', 'account']) {
    const recs = ((remoteByScope[scope] && remoteByScope[scope].get(SENTRY_TOKEN)) || []).map((v) => ({ v, cls: classifyRecord(v) }));
    if (recs.length === 0) continue;
    if (recs.length > 1) return { error: `${SENTRY_TOKEN} has ${recs.length} ${scope}-scope records in EAS environment "${environment}" (values not printed). ${fix}` };
    const r = recs[0];
    if (r.cls === 'secret') {
      return { error: `${SENTRY_TOKEN} is stored in EAS environment "${environment}" (${scope} scope) with secret visibility, which only EAS builders can read, so this machine cannot upload the update's source maps. Fix: export ${SENTRY_TOKEN} in this shell, or change it to sensitive (eas env:update --variable-name ${SENTRY_TOKEN} --variable-environment ${environment} --scope ${scope} --visibility sensitive), then re-run.` };
    }
    if (r.cls !== 'readable' || valueProblem(SENTRY_TOKEN, r.v)) {
      return { error: `${SENTRY_TOKEN} in EAS environment "${environment}" (${scope} scope) cannot be used (masked, empty or a placeholder; value not printed). ${fix}` };
    }
    return { token: r.v, source: `EAS ${scope} scope` };
  }
  return { error: `${SENTRY_TOKEN} is set neither in this shell nor in EAS environment "${environment}", so errors from this update would reach Sentry with minified stack frames. ${fix}` };
}

function walkFiles(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

/**
 * dist/ must hold, for iOS and Android, a bundle source map with a Sentry
 * Debug ID (metro.config.js getSentryExpoConfig) written by this publish.
 * sentry-expo-upload-sourcemaps exits 0 even when it uploads nothing, so the
 * guard checks before it uploads.
 */
function checkDistSourceMaps(distDir, opts = {}) {
  if (!fs.existsSync(distDir)) {
    return { errors: [`${path.basename(distDir)}/ does not exist, so there are no source maps to upload. Fix: publish through npm run update:publish (it exports with source maps into dist/).`] };
  }
  const maps = walkFiles(distDir).filter((f) => f.endsWith('.map'));
  const errors = [];
  for (const platform of PLATFORMS) {
    const mine = maps.filter((f) => f.split(path.sep).includes(platform));
    if (!mine.length) {
      errors.push(`dist/ has no ${platform} source map, so ${platform} errors from this update could not be symbolicated. Fix: publish through npm run update:publish (eas update --source-maps true), then re-run the upload.`);
      continue;
    }
    let ok = 0;
    let stale = 0;
    for (const f of mine) {
      if (opts.since !== undefined && fs.statSync(f).mtimeMs < opts.since - FRESHNESS_SLACK_MS) {
        stale += 1;
        continue;
      }
      const r = readJsonFile(f);
      if (r.json && (typeof r.json.debugId === 'string' || typeof r.json.debug_id === 'string')) ok += 1;
    }
    if (stale && !ok) {
      errors.push(`dist/ holds only ${platform} source maps from an earlier export, not from this publish. Fix: check the eas update output above, then run npm run update:sourcemaps once dist/ holds this update.`);
    } else if (!ok) {
      errors.push(`the ${platform} source map in dist/ has no Sentry Debug ID, so Sentry could not match it to events. Fix: keep getSentryExpoConfig in metro.config.js (main has it), then publish again.`);
    }
  }
  return { errors, count: maps.length };
}

/** The sentry-expo-upload-sourcemaps script shipped with @sentry/react-native. */
function sentryUploadScript(root) {
  try {
    const pkgPath = require.resolve('@sentry/react-native/package.json', { paths: [root] });
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const rel = pkg && pkg.bin && pkg.bin['sentry-expo-upload-sourcemaps'];
    if (typeof rel !== 'string' || !rel) return { error: '@sentry/react-native has no sentry-expo-upload-sourcemaps script. Fix: run npm ci in the repository root, then re-run.' };
    return { script: path.resolve(path.dirname(pkgPath), rel) };
  } catch {
    return { error: '@sentry/react-native is not installed here. Fix: run npm ci in the repository root, then re-run.' };
  }
}

/** Update ids from dist/eas-update-metadata.json (written by --emit-metadata), for the Sentry search. */
function readUpdateIds(distDir) {
  const r = readJsonFile(path.join(distDir, METADATA_FILE));
  const list = Array.isArray(r.json) ? r.json : [];
  return list
    .filter((u) => u && typeof u.id === 'string' && typeof u.platform === 'string')
    .map((u) => ({ platform: u.platform, id: u.id.toLowerCase(), group: typeof u.group === 'string' ? u.group : undefined }));
}

function logSentrySearch(log, distDir, channel) {
  const ids = readUpdateIds(distDir);
  for (const u of ids) log(`Sentry: filter issues with expo.updates.update_id:${u.id} (${u.platform}${u.group ? `, update group ${u.group}` : ''})`);
  log(`Sentry: all updates on this channel: expo.updates.channel:${channel}; devices that fell back to the embedded bundle: expo.updates.emergency:true`);
}

function uploadSourceMaps(ctx) {
  const { run, log, distDir, plan, since, channel, environment, baseEnv } = ctx;
  const reupload = `npm run update:sourcemaps -- --channel ${channel} --environment ${environment}`;
  const dist = checkDistSourceMaps(distDir, { since });
  if (dist.errors.length) {
    dist.errors.forEach(log);
    return 1;
  }
  const res = run(process.execPath, [plan.script, distDir], {
    env: {
      ...baseEnv,
      [SENTRY_TOKEN]: plan.token,
      SENTRY_ORG: plan.org,
      SENTRY_PROJECT: plan.project,
      SENTRY_URL: plan.url,
    },
  });
  if (!res || res.error || res.status !== 0) {
    log(
      `the source maps did not reach Sentry (sentry-expo-upload-sourcemaps exited with status ${res && res.status}), so errors from this update would show minified stack frames. Fix: check the output above (token scope project:releases, network), then run ${reupload}.`,
    );
    return 1;
  }
  log(`source maps uploaded to Sentry project ${plan.org}/${plan.project} (token from ${plan.source})`);
  logSentrySearch(log, distDir, channel);
  return 0;
}

function defaultRun(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: opts.capture ? 'pipe' : 'inherit', env: opts.env || process.env });
}

function readRemoteFlag(environment, run = defaultRun, parentEnv = process.env) {
  const res = run(
    'npx',
    ['eas-cli', 'env:get', environment, '--variable-name', FLAG, '--format', 'short', '--scope', 'project', '--non-interactive'],
    { capture: true, env: lookupEnv(parentEnv) },
  );
  if (!res || res.error || res.status !== 0) return { error: `eas env:get failed (status ${res && res.status})` };
  return parseRemoteValue(res.stdout, res.stderr);
}

function readBothScopes(environment, run, env) {
  const remoteByScope = {};
  const errors = [];
  for (const scope of ['project', 'account']) {
    const r = readRemoteList(environment, scope, run, env);
    if (r.error) errors.push(r.error);
    else remoteByScope[scope] = r.vars;
  }
  return { remoteByScope, errors };
}

/**
 * Sentry upload plan: { skip } when the bundle has no DSN (it reports
 * nothing), else token + project + script, or { errors }. `force` (the
 * re-upload mode) always plans an upload.
 */
/** The file sentry-expo-upload-sourcemaps loads into its env from the project root. */
const SENTRY_PLUGIN_ENV_FILE = '.env.sentry-build-plugin';

/**
 * Opus C-305-10: sentry-expo-upload-sourcemaps runs
 * Object.assign(process.env, parse('.env.sentry-build-plugin')) from the
 * project root, so a stale local file would silently replace the token, org,
 * project and url this guard resolved. Refuse before anything is published.
 */
function sentryPluginEnvFileError(root) {
  if (!fs.existsSync(path.join(root, SENTRY_PLUGIN_ENV_FILE))) return null;
  return `${SENTRY_PLUGIN_ENV_FILE} exists in the project root; the Sentry upload would read its token and project instead of the ones this guard checked. Fix: delete or rename ${SENTRY_PLUGIN_ENV_FILE}, then run this again (nothing was published).`;
}

function sentryPlan(root, effective, remoteByScope, env, environment, force = false, resolveScript = sentryUploadScript) {
  const dsn = String(effective[SENTRY_DSN] || '').trim() || appExtraDsn(root);
  if (!dsn && !force) return { skip: true };
  const errors = [];
  const tok = resolveSentryToken(env, remoteByScope, environment);
  if (tok.error) errors.push(tok.error);
  const cfg = sentryProjectConfig(root);
  if (cfg.error) errors.push(cfg.error);
  const bin = resolveScript(root);
  if (bin.error) errors.push(bin.error);
  const pluginEnv = sentryPluginEnvFileError(root);
  if (pluginEnv) errors.push(pluginEnv);
  if (errors.length) return { errors };
  return { token: tok.token, source: tok.source, org: cfg.org, project: cfg.project, url: cfg.url, script: bin.script };
}

function main(argv, deps = {}) {
  const run = deps.run || defaultRun;
  const env = deps.env || process.env;
  const log = deps.log || ((m) => console.error(`eas-update-guard: ${m}`));
  const root = deps.root || ROOT;
  const easRoot = deps.easRoot || root;
  const distDir = deps.distDir || path.join(root, 'dist');
  const now = deps.now || Date.now;
  const resolveScript = deps.resolveUploadScript || sentryUploadScript;
  const parsed = parseArgs(argv);
  if (parsed.errors.length) {
    parsed.errors.forEach(log);
    return 1;
  }
  const args = parsed.args;
  const channels = loadChannels(easRoot);
  const errors = [...checkArgs(args, channels, { sourcemapsOnly: args.sourcemapsOnly })];
  if (!args.sourcemapsOnly) {
    errors.push(...checkPolicyHash(root));
    if (env[FLAG] !== undefined && env[FLAG] !== 'true') errors.push(`local ${FLAG} ${flagValueCategory(env[FLAG])}; unset it or set it to "true"`);
  }
  if (errors.length) {
    errors.forEach(log);
    return 1;
  }
  const target = channels[args.channel];

  if (args.sourcemapsOnly) {
    const lists = readBothScopes(args.environment, run, env);
    if (lists.errors.length) {
      lists.errors.forEach(log);
      return 1;
    }
    const plan = sentryPlan(root, {}, lists.remoteByScope, env, args.environment, true, resolveScript);
    if (plan.errors) {
      plan.errors.forEach(log);
      return 1;
    }
    if (!readUpdateIds(distDir).length) {
      log(`dist/${METADATA_FILE} is missing, so dist/ is not the export of a guarded publish and its source maps may belong to another update. Fix: publish through npm run update:publish (it writes that file), or re-run this after the next guarded publish.`);
      return 1;
    }
    return uploadSourceMaps({ run, log, distDir, plan, channel: args.channel, environment: args.environment, baseEnv: publishEnv(env, target) });
  }

  const remote = readRemoteFlag(args.environment, run, env);
  const envErrors = remote.error ? [remote.error] : checkEnvValue(remote.value);
  if (envErrors.length) {
    envErrors.forEach(log);
    log(`could not confirm ${FLAG}="true" in EAS environment "${args.environment}" (fails closed)`);
    return 1;
  }
  const lists = readBothScopes(args.environment, run, env);
  if (lists.errors.length) {
    lists.errors.forEach(log);
    log(`could not read EAS environment "${args.environment}" to compare it with eas.json build.${target.profile}.env (fails closed)`);
    return 1;
  }
  const remoteCheck = analyzeRemote(target, args.channel, lists.remoteByScope);
  const effective = bundleEnv(env, target, remoteCheck.values);
  const problems = [...remoteCheck.errors, ...checkBundleValues(root, target, args.channel, effective, remoteCheck.unresolved)];
  const plan = sentryPlan(root, effective, lists.remoteByScope, env, args.environment, false, resolveScript);
  if (plan.errors) problems.push(...plan.errors);
  if (problems.length) {
    problems.forEach(log);
    log(`${problems.length} problem(s); nothing was published. Each line above names the variable and the fix.`);
    return 1;
  }
  const rollout = rolloutPercentage(args['rollout-percentage']);
  const summary = `channel "${args.channel}" (profile ${target.profile}, environment ${args.environment}${rollout !== undefined ? `, rollout ${rollout}%` : ''})`;
  if (args.dryRun) {
    log(`all checks passed for ${summary}; ${plan.skip ? 'this bundle has no Sentry DSN, so no source maps would be uploaded' : `source maps would be uploaded to Sentry ${plan.org}/${plan.project}`}; dry run, nothing published`);
    return 0;
  }
  const since = now();
  const pubArgs = ['eas-cli', 'update', '--channel', args.channel, '--environment', args.environment, '--message', args.message, '--source-maps', 'true', '--emit-metadata'];
  if (rollout !== undefined) pubArgs.push('--rollout-percentage', String(rollout));
  const pub = run('npx', pubArgs, { env: publishEnv(env, target) });
  if (!pub || pub.status == null || pub.status !== 0) {
    log(
      `eas update did not finish (status ${pub && pub.status}); no source maps were uploaded. Fix: if the output above shows an update group ID, the update is live: run npm run update:sourcemaps -- --channel ${args.channel} --environment ${args.environment}. Otherwise nothing was published: correct the problem shown above and re-run the same command.`,
    );
    return pub && typeof pub.status === 'number' && pub.status !== 0 ? pub.status : 1;
  }
  if (plan.skip) {
    log(`published ${summary}; this bundle has no Sentry DSN, so no source maps were uploaded`);
    return 0;
  }
  return uploadSourceMaps({ run, log, distDir, plan, since, channel: args.channel, environment: args.environment, baseEnv: publishEnv(env, target) });
}

module.exports = {
  parseArgs, checkArgs, loadChannels, checkPolicyHash, checkEnvValue, parseRemoteValue, readRemoteFlag, lookupEnv, policyHash,
  parseEnvList, readRemoteList, classifyRecord, analyzeRemote, checkBundleValues, publishEnv, bundleEnv, rolloutPercentage,
  resolveSentryToken, sentryProjectConfig, checkDistSourceMaps, sentryUploadScript, readUpdateIds, sentryPluginEnvFileError, main,
  SENTRY_PLUGIN_ENV_FILE,
  FLAG, POLICY_FILE, LOCK_FILE, METADATA_FILE,
};

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
