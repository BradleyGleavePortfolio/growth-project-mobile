/**
 * LS-917 B4, test-only artifact acceptance check.
 * Usage: node src/__tests__/ls917RenderCoverage.check.cjs <WK-1-M render folder>
 *
 * This reads the delivered render harness, not a hardcoded copy of its
 * manifest. It checks only root-view coverage; a human must still inspect
 * the resulting before/after PNGs, sizes, text scales and GOAL differences.
 * With a differently structured harness, trace the actual root imports
 * instead of dropping an affected view from this inventory.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = process.argv[2];
assert(root, 'Pass the actual exported WK-1-M render folder');
const harness = path.join(root, 'harness');
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return entry.name === 'mocks' ? [] : files(full);
  return /\.(?:tsx?|jsx?|mjs)$/.test(entry.name) ? [full] : [];
});
const imports = files(harness).flatMap((file) =>
  [...fs.readFileSync(file, 'utf8').matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((match) => match[1]));
const rendered = (view) => imports.some((value) => value.endsWith(`/${view}`));

// Control: the delivered artifact genuinely renders these two real roots.
assert(rendered('ActiveWorkoutScreen'), 'Control: real live workout render root missing');
assert(rendered('CalendarWeekScreen'), 'Control: real Calendar render root missing');

// These consume the changed workout/assignment day and visibly change a
// count, ring segment, date label, grouping, best-set date or next-workout day.
const affected = [
  'WorkoutScreen',
  'RingsHomeScreen',
  'YouScreen',
  'ClientWorkoutViewerScreen',
  'ProgressV2',
  'WorkoutsTab',
  'ClientPeekSheet',
];
const missing = affected.filter((view) => !rendered(view));
console.log('Rendered controls: ActiveWorkoutScreen, CalendarWeekScreen');
console.log(`Missing changed day views: ${missing.join(', ') || 'none'}`);
assert.deepEqual(missing, [], 'Changed visible day views need actual before/after render roots');
