/**
 * coachHomeThreeArcFlagOff — proves the Roman ED.2 three-arc router is fully
 * contained on Coach Home when `featureFlags.romanThreeArcRouter` is OFF (the
 * production default posture).
 *
 * CoachHomeScreen is a heavy host (dashboard + risk + alerts + AI-budget +
 * Stripe banners), so this pins the contract STATICALLY — the same Layer-2
 * approach used by romanP3FlagOff.test.tsx — rather than attempting a full
 * render. Two guarantees:
 *
 *   1. FLAG DEFAULT — `romanThreeArcRouter` reads its env flag and defaults to
 *      `false` UNCONDITIONALLY (not `isDev`), so no build surfaces the widget
 *      before the backend lands.
 *   2. MOUNT GUARD — both the `<CoachThreeArcRouter />` mount AND the
 *      `useCoachThreeArcCounts` fetch live behind a `featureFlags
 *      .romanThreeArcRouter` (`threeArcEnabled`) guard, and the fetch's
 *      `enabled` option is wired to that same flag — so a flag-OFF build
 *      neither renders the widget nor issues the daily-rings request.
 *
 * A regression that mounts the widget unconditionally, drops the `enabled`
 * gate, or flips the default to `true`/`isDev` fails here.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
function readSrc(...rel: string[]): string {
  return fs.readFileSync(path.join(ROOT, 'src', ...rel), 'utf8');
}

const HOME = readSrc('screens', 'coach', 'CoachHomeScreen.tsx');
const FLAGS = readSrc('config', 'featureFlags.ts');

describe('ED.2 three-arc router — flag-OFF containment on Coach Home', () => {
  it('romanThreeArcRouter reads its env flag and defaults to false (not isDev)', () => {
    expect(FLAGS).toMatch(
      /romanThreeArcRouter:\s*readFlag\(\s*'EXPO_PUBLIC_FF_ROMAN_THREE_ARC_ROUTER',\s*false,?\s*\)/,
    );
    // Guard against a sneaky isDev default for this flag.
    expect(FLAGS).not.toMatch(
      /romanThreeArcRouter:\s*readFlag\(\s*'EXPO_PUBLIC_FF_ROMAN_THREE_ARC_ROUTER',\s*isDev/,
    );
  });

  it('CoachHomeScreen derives threeArcEnabled from featureFlags.romanThreeArcRouter', () => {
    expect(HOME).toMatch(
      /const\s+threeArcEnabled\s*=\s*featureFlags\.romanThreeArcRouter\s*;/,
    );
  });

  it('the daily-rings fetch is gated — enabled is wired to threeArcEnabled', () => {
    expect(HOME).toMatch(
      /useCoachThreeArcCounts\(\{\s*enabled:\s*threeArcEnabled\s*\}\)/,
    );
  });

  it('the CoachThreeArcRouter mount lives behind the threeArcEnabled guard', () => {
    // The widget mounts only inside a `{threeArcEnabled && ( ... )}` branch.
    expect(HOME).toMatch(/\{threeArcEnabled\s*&&\s*\([\s\S]*<CoachThreeArcRouter/);
  });

  it('the mount wires the three onPress deep-links to REAL coach routes', () => {
    expect(HOME).toMatch(/onPressCheckIns=\{\(\)\s*=>\s*navigation\.navigate\('ClientsStack'\)\}/);
    expect(HOME).toMatch(
      /onPressBrief=\{[\s\S]*navigation\.navigate\('SettingsStack',\s*\{\s*screen:\s*'CoachBrief'\s*\}\)/,
    );
    expect(HOME).toMatch(/onPressReview=\{\(\)\s*=>\s*navigation\.navigate\('Messages'\)\}/);
  });

  it('the widget mount appears AFTER the header and BEFORE the Key Metrics block', () => {
    const headerIdx = HOME.indexOf('Here\'s your coaching overview');
    const mountIdx = HOME.indexOf('<CoachThreeArcRouter');
    const metricsIdx = HOME.indexOf('{/* Key Metrics */}');
    expect(headerIdx).toBeGreaterThan(-1);
    expect(mountIdx).toBeGreaterThan(headerIdx);
    expect(metricsIdx).toBeGreaterThan(mountIdx);
  });
});
