#!/usr/bin/env node
/**
 * Guarded EAS Update publish (audit #305 A1 / B1).
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
 *      scripts/purchase-policy.sha256. Any edit to the iOS purchase gate
 *      needs a reviewed lock bump and cannot ride along in an OTA silently.
 *   3. In the target EAS environment, EXPO_PUBLIC_FF_IOS_HIDE_NON_P2P_PURCHASES
 *      is exactly "true". This is read through `eas env:exec`; if the read
 *      fails, the guard fails closed.
 *
 * This is governance, not proof: someone with EAS access can still run
 * `eas update` directly. The runtime gate is also anchored to the native
 * build number (config/purchaseSurfaces.ts), so flipping the flag alone
 * cannot show non-P2P purchases on iOS build 6 or later.
 */
'use strict';
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
    else if (a === '--assert-env') out.assertEnv = true;
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

function checkEnvValue(value) {
  return value === 'true' ? [] : [`${FLAG} must be "true" in the target EAS environment, got ${JSON.stringify(value)}`];
}

function run(cmd, args) {
  return spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', encoding: 'utf8' });
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.assertEnv) {
    // Runs INSIDE `eas env:exec <environment>`.
    const errs = checkEnvValue(process.env[FLAG]);
    errs.forEach((e) => console.error(`eas-update-guard: ${e}`));
    return errs.length ? 1 : 0;
  }
  const errors = [...checkArgs(args), ...checkPolicyHash()];
  if (errors.length) {
    errors.forEach((e) => console.error(`eas-update-guard: ${e}`));
    return 1;
  }
  const envCheck = run('npx', ['eas-cli', 'env:exec', args.environment, `node scripts/eas-update-guard.js --assert-env`]);
  if (envCheck.status !== 0) {
    console.error(`eas-update-guard: could not confirm ${FLAG}="true" in EAS environment "${args.environment}" (fails closed)`);
    return 1;
  }
  if (args.dryRun) {
    console.log('eas-update-guard: all checks passed (dry run, nothing published)');
    return 0;
  }
  const pub = run('npx', ['eas-cli', 'update', '--channel', args.channel, '--environment', args.environment, '--message', args.message]);
  return pub.status == null ? 1 : pub.status;
}

module.exports = { parseArgs, checkArgs, checkPolicyHash, checkEnvValue, policyHash, FLAG, POLICY_FILE, LOCK_FILE };

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
