/**
 * Command Center — navigation reachability test.
 *
 * Asserts that:
 *   1. All 5 Command Center screen files exist.
 *   2. All 3 shared components exist.
 *   3. CoachNavigator imports CommandCenterScreen and registers it.
 *   4. The CommandCenterScreen root host file references all 5 tabs.
 *   5. commandCenterApi.ts exports the 6 expected functions.
 *   6. The navigator README mentions the Command Center.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');

describe('command center navigation reachability', () => {
  it('all 5 Command Center screen files exist', () => {
    const screens = [
      'screens/coach/command-center/OverviewScreen.tsx',
      'screens/coach/command-center/AtRiskScreen.tsx',
      'screens/coach/command-center/WinStreaksScreen.tsx',
      'screens/coach/command-center/InboxScreen.tsx',
      'screens/coach/command-center/ActionQueueScreen.tsx',
    ];
    for (const screen of screens) {
      expect(fs.existsSync(path.join(ROOT, screen))).toBe(true);
    }
  });

  it('CommandCenterScreen root host file exists', () => {
    expect(
      fs.existsSync(
        path.join(ROOT, 'screens/coach/command-center/CommandCenterScreen.tsx'),
      ),
    ).toBe(true);
  });

  it('all 3 shared component files exist', () => {
    const components = [
      'components/command-center/KpiTile.tsx',
      'components/command-center/AlertRow.tsx',
      'components/command-center/MessagePreviewRow.tsx',
    ];
    for (const comp of components) {
      expect(fs.existsSync(path.join(ROOT, comp))).toBe(true);
    }
  });

  it('MockDataBanner component exists in command-center', () => {
    expect(
      fs.existsSync(
        path.join(ROOT, 'components/command-center/MockDataBanner.tsx'),
      ),
    ).toBe(true);
  });

  it('commandCenterApi.ts exports __USING_MOCK_DATA and commandCenterApi', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'services/commandCenterApi.ts'),
      'utf8',
    );
    expect(src).toContain('export const __USING_MOCK_DATA');
    expect(src).toContain('export const commandCenterApi');
    // All 6 methods
    expect(src).toContain('getOverview');
    expect(src).toContain('getAtRisk');
    expect(src).toContain('getWinStreaks');
    expect(src).toContain('getInbox');
    expect(src).toContain('getActionQueue');
    expect(src).toContain('dismissAlert');
  });

  it('CoachNavigator imports CommandCenterScreen', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'navigation/CoachNavigator.tsx'),
      'utf8',
    );
    expect(src).toContain("import CommandCenterScreen");
    expect(src).toContain('CommandCenter');
    expect(src).toContain('name="CommandCenter"');
  });

  // Sessions screens non-regression test removed: those screens were never
  // merged into main (PR #104 not landed). This PR doesn't introduce them.

  it('CoachNavigator still registers BloodworkReviewQueue (non-regression PR #103)', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'navigation/CoachNavigator.tsx'),
      'utf8',
    );
    expect(src).toContain("import BloodworkReviewQueueScreen");
    expect(src).toContain('name="BloodworkReviewQueue"');
  });

  it('CoachNavigator still registers RiskBoard (non-regression PR #106)', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'navigation/CoachNavigator.tsx'),
      'utf8',
    );
    expect(src).toContain("import RiskBoardScreen");
    expect(src).toContain('name="RiskBoard"');
  });

  it('CommandCenterScreen references all 5 tab keys', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'screens/coach/command-center/CommandCenterScreen.tsx'),
      'utf8',
    );
    expect(src).toContain("'overview'");
    expect(src).toContain("'at-risk'");
    expect(src).toContain("'win-streaks'");
    expect(src).toContain("'inbox'");
    expect(src).toContain("'action-queue'");
  });

  it('command-center README exists', () => {
    expect(
      fs.existsSync(
        path.join(ROOT, 'screens/coach/command-center/README.md'),
      ),
    ).toBe(true);
  });

  it('navigator README mentions Command Center', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'navigation/README.md'),
      'utf8',
    );
    expect(src).toContain('Command Center');
  });
});
