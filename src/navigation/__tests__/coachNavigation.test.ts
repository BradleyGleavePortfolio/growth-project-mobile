// Pure source-level inspection of CoachNavigator: no NavigationContainer is
// mounted. The aim is to fail loud if someone removes the Settings → Billing
// or Settings → TrustCenter route, or accidentally re-introduces a broken
// 'Settings' bottom-tab name when the rest of the codebase has migrated to
// 'SettingsStack'. Mounting a real navigator pulls in react-native-screens +
// reanimated, which jest-expo can do, but the wiring assertions below are
// faster and catch the same regressions.

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const NAV_SRC = fs.readFileSync(
  path.join(ROOT, 'src', 'navigation', 'CoachNavigator.tsx'),
  'utf8',
);

describe('CoachNavigator wiring', () => {
  it('registers a Billing route inside the Settings stack', () => {
    expect(NAV_SRC).toMatch(/SettingsStack\.Screen\s+name="Billing"/);
    expect(NAV_SRC).toMatch(/component=\{CoachBillingScreen\}/);
  });

  it('registers a TrustCenter route inside the Settings stack', () => {
    expect(NAV_SRC).toMatch(/SettingsStack\.Screen\s+name="TrustCenter"/);
    expect(NAV_SRC).toMatch(/component=\{TrustCenterScreen\}/);
  });

  it('exposes Settings via SettingsStack tab (not a bare Settings screen)', () => {
    expect(NAV_SRC).toMatch(/name="SettingsStack"/);
    // The old bare-screen wiring used `name="Settings"` directly on the tab.
    // If someone reverts that, child screens (Billing, TrustCenter) become
    // unreachable. Catch it at test time.
    expect(NAV_SRC).not.toMatch(/Tab\.Screen[^>]*name="Settings"\b/);
  });
});

describe('CoachHomeScreen → settings tab navigation', () => {
  it('navigates to SettingsStack rather than the removed Settings screen', () => {
    const homeSrc = fs.readFileSync(
      path.join(ROOT, 'src', 'screens', 'coach', 'CoachHomeScreen.tsx'),
      'utf8',
    );
    expect(homeSrc).toMatch(/navigation\.navigate\('SettingsStack'\)/);
    expect(homeSrc).not.toMatch(/navigation\.navigate\('Settings'\)/);
  });
});
