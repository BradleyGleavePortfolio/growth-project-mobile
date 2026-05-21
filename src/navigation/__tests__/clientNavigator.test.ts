/**
 * Static guarantees for ClientNavigator. We don't mount React Navigation here
 * (it would pull in reanimated and gesture-handler), we just read the source
 * file and assert structural invariants that have caused regressions before:
 *
 *   1. AIGuide is registered as a real screen (no longer orphan).
 *   2. Membership is registered (sale-readiness surface).
 *   3. RecipeDetail's typed param is a serializable id, not a recipe object —
 *      passing whole records via navigation params triggers React Navigation's
 *      "non-serializable values were found" warning and breaks state hydration.
 *   4. MoreScreen exposes entry points to the new surfaces so they're
 *      reachable from the client UI.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const NAV_SRC = fs.readFileSync(
  path.join(ROOT, 'navigation', 'ClientNavigator.tsx'),
  'utf8',
);
const MORE_SRC = fs.readFileSync(
  path.join(ROOT, 'screens', 'client', 'MoreScreen.tsx'),
  'utf8',
);

describe('ClientNavigator — sale-readiness completion', () => {
  it('imports AIGuideScreen and MembershipScreen', () => {
    expect(NAV_SRC).toMatch(/import\s+AIGuideScreen\s+from/);
    expect(NAV_SRC).toMatch(/import\s+MembershipScreen\s+from/);
  });

  it('registers AIGuide and Membership as named stack screens', () => {
    // Components may be wrapped with withProtectedScreen (paywall gating), so
    // accept either the raw screen import or a Protected* wrapper of it.
    expect(NAV_SRC).toMatch(/name=["']AIGuide["']\s+component=\{(?:Protected)?AIGuideScreen\}/);
    expect(NAV_SRC).toMatch(/name=["']Membership["']\s+component=\{(?:Protected)?MembershipScreen\}/);
  });

  it('declares AIGuide and Membership in MoreStackParamList', () => {
    // Pull just the MoreStackParamList block so a stray match elsewhere in the
    // file (e.g., a comment) can't accidentally satisfy this assertion. The
    // closing `};` is anchored to start-of-line so an inner `{ recipeId }`
    // doesn't truncate the slice early.
    const block = NAV_SRC.match(/MoreStackParamList\s*=\s*\{([\s\S]*?)^\};/m);
    expect(block).not.toBeNull();
    const body = block![1];
    expect(body).toMatch(/AIGuide:\s*undefined/);
    expect(body).toMatch(/Membership:\s*undefined/);
  });

  it('typed RecipeDetail params use a serializable id, not a recipe object', () => {
    // The whole-recipe variant produces a non-serializable param warning. The
    // detail screen now refetches by id (cache-first), keeping params primitive.
    expect(NAV_SRC).toMatch(/RecipeDetail:\s*\{\s*recipeId:\s*string\s*\}/);
    expect(NAV_SRC).not.toMatch(/RecipeDetail:\s*\{\s*recipe:\s*any\s*\}/);
  });
});

describe('MoreScreen — sale-readiness entry points', () => {
  it('exposes a Guidance row that targets the AIGuide stack screen', () => {
    expect(MORE_SRC).toMatch(/screen:\s*['"]AIGuide['"]/);
    expect(MORE_SRC).toMatch(/label:\s*['"]Guidance['"]/);
  });

  it('exposes a Membership row that targets the Membership stack screen', () => {
    expect(MORE_SRC).toMatch(/screen:\s*['"]Membership['"]/);
    expect(MORE_SRC).toMatch(/label:\s*['"]Membership['"]/);
  });
});
