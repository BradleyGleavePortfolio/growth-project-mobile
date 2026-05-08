/**
 * TeamManagementScreen snapshot test.
 *
 * Validates the screen's static structure by reading the source and checking
 * structural contracts — same pattern used in InviteCodesShare.test.ts so the
 * test can run in a plain Node environment without JSX / Expo transforms.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SCREEN_SRC = fs.readFileSync(
  path.join(ROOT, 'src', 'screens', 'coach', 'TeamManagementScreen.tsx'),
  'utf8',
);
const API_SRC = fs.readFileSync(
  path.join(ROOT, 'src', 'api', 'subCoachApi.ts'),
  'utf8',
);

describe('TeamManagementScreen', () => {
  it('imports subCoachApi', () => {
    expect(SCREEN_SRC).toMatch(/from ['"].*subCoachApi['"]/);
  });

  it('imports Colors from constants', () => {
    expect(SCREEN_SRC).toMatch(/from ['"].*constants\/colors['"]/);
  });

  it('renders a capacity bar component', () => {
    expect(SCREEN_SRC).toMatch(/CapacityBar/);
  });

  it('renders a score badge component', () => {
    expect(SCREEN_SRC).toMatch(/ScoreBadge/);
  });

  it('renders an upgrade gate for non-Scale tiers', () => {
    expect(SCREEN_SRC).toMatch(/UpgradeGate/);
    expect(SCREEN_SRC).toMatch(/scale/);
  });

  it('uses accessibilityRole on interactive elements', () => {
    expect(SCREEN_SRC).toMatch(/accessibilityRole/);
  });

  it('uses accessibilityLabel on interactive elements', () => {
    expect(SCREEN_SRC).toMatch(/accessibilityLabel/);
  });

  it('does not contain hardcoded color hex values (should use Colors.*)', () => {
    // Quick guard: no #RGB or #RRGGBB literals outside the import statement
    const bodyWithoutImports = SCREEN_SRC
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('import'))
      .join('\n');
    const hexMatches = bodyWithoutImports.match(/'#[0-9A-Fa-f]{3,8}'/g) ?? [];
    expect(hexMatches).toHaveLength(0);
  });

  it('does not use emoji characters', () => {
    // eslint-disable-next-line no-control-regex
    const emojiRegex = /[\u{1F300}-\u{1FAFF}]/u;
    expect(emojiRegex.test(SCREEN_SRC)).toBe(false);
  });
});

describe('subCoachApi', () => {
  it('exports listSubCoaches', () => {
    expect(API_SRC).toMatch(/listSubCoaches/);
  });

  it('exports getSubCoach', () => {
    expect(API_SRC).toMatch(/getSubCoach/);
  });

  it('exports reassignClient', () => {
    expect(API_SRC).toMatch(/reassignClient/);
  });

  it('exports getAnalytics', () => {
    expect(API_SRC).toMatch(/getAnalytics/);
  });

  it('does not contain hardcoded API keys or secrets', () => {
    expect(API_SRC).not.toMatch(/sk-|Bearer [A-Za-z0-9]{20}/);
  });
});
