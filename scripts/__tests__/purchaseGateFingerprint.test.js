/**
 * Re-audit #305 A1 / #304 B3: a JS-only change to the iOS purchase gate
 * (threshold 6 → 600, or always-show) with unchanged native inputs must
 * resolve to a DIFFERENT runtime, so installed binaries never download it.
 * Runs scripts/fingerprint-gate-check.js in a plain node process
 * (@expo/fingerprint does not run inside the RN jest environment).
 */
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
jest.setTimeout(180000);

describe('purchase gate is a fingerprint (runtime) input', () => {
  it.each(['ios', 'android'])('%s: gate edits change the runtime; native inputs unchanged', (platform) => {
    const res = spawnSync(process.execPath, ['scripts/fingerprint-gate-check.js', '--platform', platform], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 170000,
    });
    expect(res.status).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.gateIsSource).toBe(true);
    expect(out.gateReasons).toContain('iosPurchasePolicyGate');
    for (const name of ['threshold600', 'alwaysShow']) {
      expect(out.mutations[name].changed).toBe(true);
      expect(out.mutations[name].nativeInputsUnchanged).toBe(true);
      expect(out.mutations[name].runtime).not.toBe(out.baseline);
    }
  });
});
