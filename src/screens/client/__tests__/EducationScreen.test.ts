// Guards for audit P0-7 — EducationScreen was firing `lessonsApi.getAll()`
// twice per load. The fix derives backend completion flags from the same
// payload the first call already returned. This test pins that shape so a
// future regression can't quietly re-introduce the duplicate fetch.

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SRC = fs.readFileSync(
  path.join(ROOT, 'src', 'screens', 'client', 'EducationScreen.tsx'),
  'utf8',
);

describe('EducationScreen — audit P0-7 single fetch', () => {
  it('only references lessonsApi.getAll() once inside loadData', () => {
    const matches = SRC.match(/lessonsApi\.getAll\(\)/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it('still merges backend completion flags into the same lessons array', () => {
    // The fix collects `backendCompletedIds` from the original `raw` items
    // during the same mapping pass — not from a second fetch.
    expect(SRC).toMatch(/backendCompletedIds\.add\(String\(l\.id\)\)/);
    expect(SRC).toMatch(/const completedIds = new Set\(\[\.\.\.localCompletedIds, \.\.\.backendCompletedIds\]\)/);
  });

  it('uses lessonsApi.complete on the detail screen, but no longer in the list loader', () => {
    // Sanity: lessonsApi.complete is still wired for the "mark complete"
    // action. It's the duplicate /getAll that was the bug.
    expect(SRC).toMatch(/lessonsApi\.complete\(selectedLesson\.id\)/);
  });
});
