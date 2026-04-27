// Source-level guard for the coach invite share path.
//
// The full screen (Modals, Alerts, ScrollView) is heavy to mount in jest, but
// the wire we actually care about is small: `handleShare` must build a
// universal link via `buildInviteUniversalLink` and pass it into
// React Native's Share.share. We assert that contract by reading the source —
// this fails loud if a future edit drops the universal link and goes back to
// the bare "use code XYZ" copy that doesn't open the app.

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SCREEN_SRC = fs.readFileSync(
  path.join(ROOT, 'src', 'screens', 'coach', 'InviteCodesScreen.tsx'),
  'utf8',
);

describe('InviteCodesScreen share', () => {
  it('imports buildInviteUniversalLink from the deep-link util', () => {
    expect(SCREEN_SRC).toMatch(
      /import\s*\{\s*buildInviteUniversalLink\s*\}\s*from\s*['"]\.\.\/\.\.\/utils\/deepLink['"]/,
    );
  });

  it('passes a built universal link as the share URL', () => {
    expect(SCREEN_SRC).toMatch(/buildInviteUniversalLink\(code\)/);
    expect(SCREEN_SRC).toMatch(/Share\.share\(\{\s*url/);
  });
});
