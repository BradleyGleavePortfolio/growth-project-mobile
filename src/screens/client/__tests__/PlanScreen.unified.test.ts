/**
 * P0-1 guardrail — PlanScreen reads from BOTH the legacy Sprint-A
 * `mealPlansApi` AND the canonical Sprint-B `mealTemplatesApi` surface so
 * a coach who assigns a plan via either path lands on the same client
 * screen.
 *
 * Before the unification a coach who created a plan via
 * CoachMealTemplatesScreen (Sprint B) saw nothing on the client because
 * PlanScreen only called `mealPlansApi.list()` — exactly the
 * "coach said plan, client sees nothing" failure mode the audit flagged.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SRC = fs.readFileSync(
  path.join(ROOT, 'src', 'screens', 'client', 'PlanScreen.tsx'),
  'utf8',
);

describe('PlanScreen — P0-1 meal-plan source unification', () => {
  it('imports both the Sprint-A and Sprint-B clients', () => {
    expect(SRC).toMatch(/from '\.\.\/\.\.\/services\/api'/);
    expect(SRC).toMatch(/from '\.\.\/\.\.\/api\/mealTemplatesApi'/);
  });

  it('reads from both surfaces in parallel with Promise.allSettled', () => {
    // allSettled, not Promise.all — a single endpoint failure must not blank
    // the other source's results.
    expect(SRC).toMatch(/Promise\.allSettled/);
    expect(SRC).toMatch(/mealPlansApi\.list\(\)/);
    expect(SRC).toMatch(/mealTemplatesApi\.todayForClient\(\)/);
  });

  it('adapts the Sprint-B today response into the legacy MealPlan shape', () => {
    expect(SRC).toMatch(/todayAssignmentsToPlans/);
    // The adapter must sort by starts_on DESC defensively — the API does
    // not document the ordering and we always want the most-recent plan.
    expect(SRC).toMatch(/starts_on/);
  });

  it('only surfaces an error banner when BOTH sources fail', () => {
    // Single-source failure should be tolerated silently (we just lose that
    // half of the merged list) — surfacing it would falsely tell the user
    // their plan is missing when in fact one path returned data.
    expect(SRC).toMatch(/legacyRes\.status === 'rejected' && todayRes\.status === 'rejected'/);
  });
});
