#!/usr/bin/env node
/**
 * Guarded EAS Update publish (audit #305 A1 / B1; re-audit B2; S-RELEASE-MOB clinic channel).
 *
 *   npm run update:publish -- --channel clinic --environment production --message "<what changed>"
 *   npm run update:publish -- --channel production --environment production --message "<what changed>"
 *   npm run update:publish -- --channel preview --environment preview --message "<what changed>"
 *   add --dry-run to run every check without publishing
 *
 * The channel names a build profile in eas.json (resolved through `extends`;
 * scripts/eas-profile.js). It refuses to publish unless all of these hold:
 *   1. Exactly one eas.json build profile uses the channel, --environment is
 *      given and equals that profile's `environment` (SDK 55+ requires it),
 *      and --message is non-empty.
 *   2. src/config/purchaseSurfaces.ts matches the reviewed hash in
 *      scripts/purchase-policy.sha256.
 *   3. The REMOTE EAS project variable EXPO_PUBLIC_FF_IOS_HIDE_NON_P2P_PURCHASES
 *      in the target environment is exactly "true". It is read explicitly
 *      with `eas env:get <env> --variable-name … --format short`, with the
 *      flag removed from the child's environment, and the output must be
 *      exactly one `NAME=true` record. Missing ("not found" exits 0 in
 *      eas-cli), empty, masked (sensitive/secret), duplicate or unparsable
 *      records, and a failed lookup all refuse (fail closed). A locally
 *      exported value is never trusted (re-audit B2: `eas env:exec` merges
 *      the parent env and drops absent remote values).
 *   4. The same flag is not set to anything other than "true" in the local
 *      shell (a local "false" would be baked in by some workflows).
 *   5. Build parity: `eas update` does not apply eas.json `build.<profile>.env`
 *      (Expo docs), and eas-cli exports with `{ ...process.env, ...EAS env }`,
 *      so the EAS environment wins over the shell. The guard therefore passes
 *      the profile's env to the publish child (so e.g. the clinic flags reach
 *      the update exactly as they reached the binary) and requires that no
 *      project- or account-scope EAS variable of the same name holds a
 *      different (or masked) value. Every other EXPO_PUBLIC_* in the local
 *      shell is dropped, so a stray export never reaches the bundle.
 *   6. Every `kind: required` name in config/expected-env.json is present in
 *      the EAS environment or the profile env (an update without the API URL
 *      would throw at import on every launch).
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

const ROOT = path.resolve(__dirname, '..');
const FLAG = 'EXPO_PUBLIC_FF_IOS_HIDE_NON_P2P_PURCHASES';
const POLICY_FILE = path.join('src', 'config', 'purchaseSurfaces.ts');
const LOCK_FILE = path.join('scripts', 'purchase-policy.sha256');

function parseArgs(argv) {
  const out = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a.startsWith('--') && a.includes('=')) {
      const [k, ...v] = a.slice(2).split('=');
      out[k] = v.join('=');
    } else if (a.startsWith('--')) {
      out[a.slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return out;
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
    return { error: err.message };
  }
}

function checkArgs(args, channels = loadChannels()) {
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
  if (!args.message || !String(args.message).trim()) errors.push('--message is required');
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

function checkEnvValue(value) {
  return value === 'true' ? [] : [`${FLAG} must be "true" in the target EAS environment, got ${JSON.stringify(value)}`];
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

function readRemoteList(environment, scope, run = defaultRun, parentEnv = process.env) {
  const res = run('npx', ['eas-cli', 'env:list', environment, '--format', 'short', '--scope', scope], {
    capture: true,
    env: lookupEnv(parentEnv),
  });
  if (!res || res.error || res.status !== 0) return { error: `eas env:list ${environment} --scope ${scope} failed (status ${res && res.status})` };
  return { vars: parseEnvList(res.stdout) };
}

/**
 * Build parity (5): every eas.json profile env value must reach the update
 * unchanged. The EAS environment wins over the shell, so a remote record of
 * the same name must be identical. Masked values cannot be compared and
 * refuse.
 */
function checkProfileParity(target, channel, remoteByScope) {
  const errors = [];
  for (const [name, want] of Object.entries(target.env).sort()) {
    for (const [scope, vars] of Object.entries(remoteByScope)) {
      const got = vars.get(name);
      if (!got) continue;
      if (got.length !== 1 || MASKED.test(got[0]) || got[0] !== String(want)) {
        const shown = got.length !== 1 ? `${got.length} records` : MASKED.test(got[0]) ? 'a masked value' : JSON.stringify(got[0]);
        errors.push(
          `${name} is ${JSON.stringify(String(want))} in eas.json build.${target.profile}.env (what channel "${channel}" binaries were built with) but the ${scope}-scope EAS variable in "${target.environment}" holds ${shown}; eas update would ship the EAS value. Fix: make the EAS variable equal (eas env:update) or delete it (eas env:delete), then re-run.`,
        );
      }
    }
  }
  return errors;
}

/** Required-name presence (6). */
function checkRequiredPresent(root, target, remoteByScope) {
  let vars;
  try {
    vars = JSON.parse(fs.readFileSync(path.join(root, 'config', 'expected-env.json'), 'utf8')).vars || {};
  } catch (err) {
    return [`config/expected-env.json could not be read (${err.message}); required EXPO_PUBLIC_* names cannot be confirmed`];
  }
  const errors = [];
  for (const name of Object.keys(vars).sort()) {
    if (!vars[name] || vars[name].kind !== 'required') continue;
    const inProfile = String(target.env[name] || '').trim() !== '';
    const inRemote = Object.values(remoteByScope).some((m) => (m.get(name) || []).some((v) => String(v).trim() !== ''));
    if (!inProfile && !inRemote) {
      errors.push(
        `${name} is kind "required" in config/expected-env.json but is set neither in EAS environment "${target.environment}" nor in eas.json build.${target.profile}.env; the update would throw at launch. Fix: eas env:create --environment ${target.environment} --name ${name} --value <value>, then re-run.`,
      );
    }
  }
  return errors;
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

function main(argv, deps = {}) {
  const run = deps.run || defaultRun;
  const env = deps.env || process.env;
  const log = deps.log || ((m) => console.error(`eas-update-guard: ${m}`));
  const root = deps.root || ROOT;
  const easRoot = deps.easRoot || root;
  const args = parseArgs(argv);
  const channels = loadChannels(easRoot);
  const errors = [...checkArgs(args, channels), ...checkPolicyHash(root)];
  if (env[FLAG] !== undefined && env[FLAG] !== 'true') errors.push(`local ${FLAG}=${JSON.stringify(env[FLAG])}; unset it or set it to "true"`);
  if (errors.length) {
    errors.forEach(log);
    return 1;
  }
  const target = channels[args.channel];
  const remote = readRemoteFlag(args.environment, run, env);
  const envErrors = remote.error ? [remote.error] : checkEnvValue(remote.value);
  if (envErrors.length) {
    envErrors.forEach(log);
    log(`could not confirm ${FLAG}="true" in EAS environment "${args.environment}" (fails closed)`);
    return 1;
  }
  const remoteByScope = {};
  const listErrors = [];
  for (const scope of ['project', 'account']) {
    const r = readRemoteList(args.environment, scope, run, env);
    if (r.error) listErrors.push(r.error);
    else remoteByScope[scope] = r.vars;
  }
  if (listErrors.length) {
    listErrors.forEach(log);
    log(`could not read EAS environment "${args.environment}" to compare it with eas.json build.${target.profile}.env (fails closed)`);
    return 1;
  }
  const parity = [...checkProfileParity(target, args.channel, remoteByScope), ...checkRequiredPresent(root, target, remoteByScope)];
  if (parity.length) {
    parity.forEach(log);
    return 1;
  }
  if (args.dryRun) {
    log(`all checks passed for channel "${args.channel}" (profile ${target.profile}, environment ${args.environment}); dry run, nothing published`);
    return 0;
  }
  const pub = run('npx', ['eas-cli', 'update', '--channel', args.channel, '--environment', args.environment, '--message', args.message], {
    env: publishEnv(env, target),
  });
  return pub == null || pub.status == null ? 1 : pub.status;
}

module.exports = {
  parseArgs, checkArgs, loadChannels, checkPolicyHash, checkEnvValue, parseRemoteValue, readRemoteFlag, lookupEnv, policyHash,
  parseEnvList, readRemoteList, checkProfileParity, checkRequiredPresent, publishEnv, main,
  FLAG, POLICY_FILE, LOCK_FILE,
};

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
