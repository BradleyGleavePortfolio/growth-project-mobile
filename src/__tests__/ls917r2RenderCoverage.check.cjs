/**
 * LS-917R2 B2: the three additional real day-changing views need previews.
 * Usage: node src/__tests__/ls917r2RenderCoverage.check.cjs <WK-1-M folder>
 * Root imports are a necessary condition, not proof that pixels are correct.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = process.argv[2];
assert(root, 'Pass the actual exported WK-1-M render folder');
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return entry.name === 'mocks' ? [] : files(full);
  return /\.(?:tsx?|jsx?|mjs)$/.test(entry.name) ? [full] : [];
});
const imports = files(path.join(root, 'harness')).flatMap((file) =>
  [...fs.readFileSync(file, 'utf8').matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((match) => match[1]));
const rendered = (view) => imports.some((value) => value.endsWith(`/${view}`));
for (const view of ['ActiveWorkoutScreen', 'CalendarWeekScreen', 'WorkoutScreen',
  'RingsHomeScreen', 'YouScreen', 'ClientWorkoutViewerScreen', 'ProgressV2',
  'WorkoutsTab', 'ClientPeekSheet']) {
  assert(rendered(view), `Control: ${view} render root missing`);
}
console.log('All nine supplied-view controls passed');
const missing = ['TrainToday', 'PlanExplanationCard', 'ProgramAssignScreen'].filter((view) => !rendered(view));
console.log(`Missing changed visible day states: ${missing.join(', ') || 'none'}`);
assert.deepEqual(missing, [], 'Every changed visible day state needs before/after previews');
