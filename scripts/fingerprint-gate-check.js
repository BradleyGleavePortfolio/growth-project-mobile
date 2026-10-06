#!/usr/bin/env node
/**
 * Re-audit #305 A1 / #304 B3 evidence: prove that JS-only edits to the iOS
 * purchase gate change the fingerprint runtime (so an OTA carrying them never
 * reaches an installed binary). Native inputs are untouched: the edits are
 * applied in-memory via @expo/fingerprint's fileHookTransform.
 *
 *   node scripts/fingerprint-gate-check.js [--platform ios|android]
 *
 * Prints JSON; exits 1 if any mutation keeps the baseline runtime.
 */
'use strict';
/* eslint-disable @typescript-eslint/no-var-requires -- CommonJS node script */
const path = require('path');
const { createFingerprintAsync } = require('@expo/fingerprint');

const ROOT = path.resolve(__dirname, '..');
const GATE = 'src/config/purchaseSurfaces.ts';
const MUTATIONS = {
  threshold600: (s) => s.replace('IOS_P2P_ONLY_MIN_NATIVE_BUILD = 6;', 'IOS_P2P_ONLY_MIN_NATIVE_BUILD = 600;'),
  alwaysShow: (s) => s.replace('return nativeBuild >= IOS_P2P_ONLY_MIN_NATIVE_BUILD;', 'return false;'),
};

function transformFor(replacer) {
  return (source, chunk) => {
    if (source.type === 'file' && source.filePath === GATE && chunk != null) {
      return replacer(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
    }
    return chunk;
  };
}

async function run(platform = 'ios') {
  const base = await createFingerprintAsync(ROOT, { platforms: [platform] });
  const gateSource = base.sources.find((s) => s.filePath === GATE);
  const nonGate = (fp) => JSON.stringify(fp.sources.filter((s) => s.filePath !== GATE).map((s) => [s.filePath || s.id, s.hash]));
  const result = { platform, baseline: base.hash, gateIsSource: Boolean(gateSource), gateReasons: gateSource ? gateSource.reasons : [], mutations: {} };
  for (const [name, fn] of Object.entries(MUTATIONS)) {
    const fp = await createFingerprintAsync(ROOT, { platforms: [platform], fileHookTransform: transformFor(fn) });
    result.mutations[name] = { runtime: fp.hash, changed: fp.hash !== base.hash, nativeInputsUnchanged: nonGate(fp) === nonGate(base) };
  }
  result.ok = result.gateIsSource && Object.values(result.mutations).every((m) => m.changed && m.nativeInputsUnchanged);
  return result;
}

module.exports = { run, MUTATIONS, GATE };

if (require.main === module) {
  const i = process.argv.indexOf('--platform');
  run(i > 0 ? process.argv[i + 1] : 'ios')
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(r.ok ? 0 : 1);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
