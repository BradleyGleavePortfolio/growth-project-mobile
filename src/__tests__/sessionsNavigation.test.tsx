/**
 * Navigation reachability test — asserts that all 7 sessions screens are
 * registered in their respective navigators and are not dead code.
 *
 * We check by importing the navigator files and inspecting that every
 * sessions screen is referenced. This is the simplest reachability assertion
 * that does not require a full navigation container mount.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');

describe('sessions navigation reachability', () => {
  it('ClientNavigator registers all three client sessions screens', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'navigation', 'ClientNavigator.tsx'),
      'utf8',
    );
    // Import statements — screens must be imported to be usable.
    expect(src).toContain("import SessionsUpcomingScreen");
    expect(src).toContain("import SessionRequestScreen");
    expect(src).toContain("import SessionPrepareScreen");
    // Screen registrations in the param list.
    expect(src).toContain('SessionsUpcoming');
    expect(src).toContain('SessionRequest');
    expect(src).toContain('SessionPrepare');
    // Screen components registered in the navigator.
    expect(src).toContain('name="SessionsUpcoming"');
    expect(src).toContain('name="SessionRequest"');
    expect(src).toContain('name="SessionPrepare"');
  });

  it('CoachNavigator registers all four coach sessions screens', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'navigation', 'CoachNavigator.tsx'),
      'utf8',
    );
    // Import statements.
    expect(src).toContain("import CoachAvailabilityScreen");
    expect(src).toContain("import CoachSessionRequestsScreen");
    expect(src).toContain("import CoachUpcomingCallsScreen");
    expect(src).toContain("import CoachSessionBriefScreen");
    // Param list entries.
    expect(src).toContain('CoachSessionRequests');
    expect(src).toContain('CoachUpcomingCalls');
    expect(src).toContain('CoachAvailability');
    expect(src).toContain('CoachSessionBrief');
    // Screen component registrations.
    expect(src).toContain('name="CoachSessionRequests"');
    expect(src).toContain('name="CoachUpcomingCalls"');
    expect(src).toContain('name="CoachAvailability"');
    expect(src).toContain('name="CoachSessionBrief"');
  });

  it('all 7 sessions screen files exist', () => {
    const screens = [
      'screens/client/SessionsUpcomingScreen.tsx',
      'screens/client/SessionRequestScreen.tsx',
      'screens/client/SessionPrepareScreen.tsx',
      'screens/coach/CoachAvailabilityScreen.tsx',
      'screens/coach/CoachSessionRequestsScreen.tsx',
      'screens/coach/CoachUpcomingCallsScreen.tsx',
      'screens/coach/CoachSessionBriefScreen.tsx',
    ];
    for (const screen of screens) {
      const fullPath = path.join(ROOT, screen);
      expect(fs.existsSync(fullPath)).toBe(true);
    }
  });

  it('MockDataBanner component exists', () => {
    const bannerPath = path.join(ROOT, 'components', 'sessions', 'MockDataBanner.tsx');
    expect(fs.existsSync(bannerPath)).toBe(true);
  });

  it('sessions README exists', () => {
    const readmePath = path.join(ROOT, 'screens', 'sessions', 'README.md');
    expect(fs.existsSync(readmePath)).toBe(true);
  });
});
