/**
 * LO-917R2 B1, test-only artifact acceptance check.
 * Usage: node src/__tests__/lo917r2PlanCardRender.check.cjs <WK-1-M render folder>
 *
 * The plan card on Train (PlanExplanationCard, featureFlags.clientTutorial,
 * ON in every store profile) now reads its "Next: <plan>, <weekday>" day
 * through assignmentDay (see lo917r2PlanCardWeekday.test.ts: a package
 * workout bought Monday 18:30 Pacific said "Tuesday" on main and says
 * "Monday" at the head). A changed state a client sees needs a before/after
 * render ([R41], [KT-14]). This fails while no delivered render shows the card.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = process.argv[2];
assert(root, 'Pass the actual exported WK-1-M render folder');
const read = (side) => JSON.parse(fs.readFileSync(path.join(root, side, 'checks.json'), 'utf8')).renders || [];
const after = read('after');
const before = read('before');

// Control: the delivered artifact has real Train renders.
assert(after.some((r) => r.scenario === 'train-week'), 'Control: Train render missing');

const showsCard = (renders) => renders.some((r) => /Why this plan/.test(r.text || '') && /Next: /.test(r.text || ''));
console.log(`Plan card rendered: before ${showsCard(before)}, after ${showsCard(after)}`);
assert(showsCard(before) && showsCard(after), 'The plan card weekday changed: it needs before and after renders');
