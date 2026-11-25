/**
 * LO-956R1 B1 (m#956 @ d4c76205): rowRoutes.test.tsx certifies F1 (SpaceTree space row, SpaceTree.tsx:96) and F16
 * (Today cohort card, CommunityTodayScreen.tsx:153) as "opens" CommunitySpace { space: 'cohort', cohortId }, but
 * CommunitySpaceScreen reads no route params: it has no useRoute, `space` is a prop that defaults to 'hall'
 * (CommunitySpaceScreen.tsx:78-85) and its posts are the whole workspace's (useCommunity.ts:129-139). So every space
 * row lands on the same Hall feed, whichever space was tapped. A row whose destination drops its ids is not "opens"
 * (ROW-ROUTE-TEST.txt:25: "with the params the destination screen reads").
 *
 * Red at the head. Green when either the screen reads the cohortId the rows send, or rowRoutes.test.tsx stops
 * certifying those rows as opening CommunitySpace with a cohortId (marks them as gaps with both marks).
 */
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');

describe('LO-956R1 B1: a space row is not "opens" while its destination drops the cohortId', () => {
  it('no row in rowRoutes.test.tsx opens CommunitySpace with a cohortId that CommunitySpaceScreen never reads', () => {
    const screen = read('screens/community/CommunitySpaceScreen.tsx');
    const readsCohortId = /useRoute/.test(screen) && /cohortId/.test(screen);
    const rows = read('__tests__/rowRoutes.test.tsx');
    const certified = [...rows.matchAll(/opens\('CommunitySpace', \{ space: 'cohort', cohortId: (\w+) \}\)/g)].map((m) => m[1]);
    expect(readsCohortId ? [] : certified).toEqual([]);
  });
});
