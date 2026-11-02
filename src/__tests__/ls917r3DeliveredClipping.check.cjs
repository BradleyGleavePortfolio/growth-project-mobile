/** LS-917R3 B4: use actual delivered DOM measurements and inspect the PNGs too.
 * node src/__tests__/ls917r3DeliveredClipping.check.cjs <WK-1-M artifact folder>
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = process.argv[2];
assert(root, 'Pass the exported actual render artifact');
const rows = JSON.parse(fs.readFileSync(path.join(root, 'after', 'checks.json'), 'utf8')).renders;
const scenarios = ['plan-card', 'home-train-dial'];
for (const scenario of scenarios) {
  const cases = rows.filter((row) => row.scenario === scenario);
  assert(cases.length >= 12, `Control: ${scenario} has its full size matrix`);
  assert(cases.every((row) => !row.errors.length), 'Control: no crashed render');
}
// HomeDial requests native adjustsFontSizeToFit; this harness cannot emulate
// that behavior. Its four ellipses are not proof of a native clipping defect.
// PlanExplanationCard requests single-line ellipsis without native auto-fit.
const clipped = rows.filter((row) => row.scenario === 'plan-card').flatMap((row) =>
  row.issues.filter((issue) => /^clipped (sideways|vertically):/.test(issue))
    .map((issue) => `${row.file}: ${issue}`));
console.log(clipped.join('\n'));
assert.deepEqual(clipped, [], 'LS-917R3 B4: changed states must not cut text at 320 and 130%');
