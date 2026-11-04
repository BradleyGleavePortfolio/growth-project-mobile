/**
 * LS-917R2 B5: acceptance check over the actual delivered render measurements.
 * Usage: node this-file.cjs <WK-1-M render folder>
 * Inspect the PNGs too: this check is not native-device certification.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = process.argv[2];
assert(root, 'Pass the actual exported WK-1-M render folder');
const rows = JSON.parse(fs.readFileSync(path.join(root, 'after', 'checks.json'), 'utf8')).renders;
const selected = rows.filter((r) => r.scenario === 'train-week');
assert(selected.length >= 12, 'Control: retain the real Train size/text matrix');
assert(selected.every((r) => r.errors.length === 0), 'Control: render errors must not masquerade as clipping');
const clipped = selected.flatMap((r) =>
  r.issues.filter((issue) => /^clipped (sideways|vertically):/.test(issue))
    .map((issue) => `${r.file}: ${issue}`));
console.log(`Real measured shots: ${selected.length}; clipped text findings: ${clipped.length}`);
assert.deepEqual(clipped, [], 'LS-917R2 B5: changed Train view has no clipped text at 320/360/390 and 100/130%');
