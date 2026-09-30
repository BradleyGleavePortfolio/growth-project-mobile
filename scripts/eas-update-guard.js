#!/usr/bin/env node
/**
 * Guarded EAS Update publish (audit #305 A1 / B1; re-audit B2).
 *
 *   npm run update:publish -- --channel production --environment production --message "<what changed>"
 *   npm run update:publish -- --channel preview --environment preview --message "<what changed>"
 *   add --dry-run to run every check without publishing
 *
 * It refuses to publish unless all of these hold:
 *   1. The channel is preview or production, --environment is given and
 *      equals the channel (SDK 55+ requires --environment; the update is
 *      exported with that EAS environment's EXPO_PUBLIC_* values, not with
 *      eas.json build-profile env), and --message is non-empty.
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

const ROOT = path.resolve(__dirname, '..');
const FLAG = 'EXPO_PUBLIC_FF_IOS_HIDE_NON_P2P_PURCHASES';
const CHANNELS = ['preview', 'production'];
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

function checkArgs(args) {
  const errors = [];
  if (!CHANNELS.includes(args.channel)) errors.push(`--channel must be one of ${CHANNELS.join(', ')}, got ${JSON.stringify(args.channel)}`);
  if (!args.environment) errors.push('--environment is required (SDK 55+); use the same value as --channel');
  else if (args.environment !== args.channel) errors.push(`--environment (${args.environment}) must equal --channel (${args.channel})`);
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
  const args = parseArgs(argv);
  const errors = [...checkArgs(args), ...checkPolicyHash(root)];
  if (env[FLAG] !== undefined && env[FLAG] !== 'true') errors.push(`local ${FLAG}=${JSON.stringify(env[FLAG])}; unset it or set it to "true"`);
  if (errors.length) {
    errors.forEach(log);
    return 1;
  }
  const remote = readRemoteFlag(args.environment, run, env);
  const envErrors = remote.error ? [remote.error] : checkEnvValue(remote.value);
  if (envErrors.length) {
    envErrors.forEach(log);
    log(`could not confirm ${FLAG}="true" in EAS environment "${args.environment}" (fails closed)`);
    return 1;
  }
  if (args.dryRun) {
    log('all checks passed (dry run, nothing published)');
    return 0;
  }
  const pub = run('npx', ['eas-cli', 'update', '--channel', args.channel, '--environment', args.environment, '--message', args.message], { env: lookupEnv(env) });
  return pub == null || pub.status == null ? 1 : pub.status;
}

module.exports = {
  parseArgs, checkArgs, checkPolicyHash, checkEnvValue, parseRemoteValue, readRemoteFlag, lookupEnv, policyHash, main,
  FLAG, POLICY_FILE, LOCK_FILE,
};

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
