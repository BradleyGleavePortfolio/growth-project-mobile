/**
 * Flag-off guarantees for the Roman P1 chat surface.
 *
 * The Roman chat route + its entry rows must NOT exist when
 * featureFlags.romanChat is OFF (the default). We assert this STATICALLY by
 * reading the navigator / screen sources and pinning the flag gate, rather than
 * mounting React Navigation (which pulls in reanimated / gesture-handler). This
 * mirrors the existing communityFlagOff.test.ts pattern.
 *
 * Also asserts the romanChat flag reads its EXPO_PUBLIC_FF_ROMAN_CHAT env var
 * with a `false` default, so the surface is OFF regardless of environment.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const CLIENT_NAV = read(path.join('navigation', 'ClientNavigator.tsx'));
const COACH_NAV = read(path.join('navigation', 'CoachNavigator.tsx'));
const MORE_SCREEN = read(path.join('screens', 'client', 'MoreScreen.tsx'));
const COACH_SETTINGS = read(path.join('screens', 'coach', 'SettingsScreen.tsx'));
const FLAGS = read(path.join('config', 'featureFlags.ts'));

describe('Roman chat — client navigator route gated by featureFlags.romanChat (default OFF)', () => {
  it('registers the RomanChat <Screen> only AFTER the featureFlags.romanChat guard', () => {
    expect(CLIENT_NAV).toMatch(/\{featureFlags\.romanChat\s*&&\s*\(/);
    const guardIdx = CLIENT_NAV.search(/\{featureFlags\.romanChat\s*&&/);
    const screenIdx = CLIENT_NAV.search(/name=["']RomanChat["']/);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(screenIdx).toBeGreaterThan(guardIdx);
  });

  it('registers exactly one RomanChat client route, never unconditionally', () => {
    const occurrences = CLIENT_NAV.match(/name=["']RomanChat["']/g) ?? [];
    expect(occurrences).toHaveLength(1);
  });

  it('passes surface="client" so the backend @IsIn value is fixed at the navigator', () => {
    expect(CLIENT_NAV).toMatch(/surface=["']client["']/);
  });
});

describe('Roman chat — coach navigator route gated by featureFlags.romanChat (default OFF)', () => {
  it('registers the RomanChat <Screen> only AFTER the featureFlags.romanChat guard', () => {
    expect(COACH_NAV).toMatch(/\{featureFlags\.romanChat\s*&&\s*\(/);
    const guardIdx = COACH_NAV.search(/\{featureFlags\.romanChat\s*&&/);
    const screenIdx = COACH_NAV.search(/name=["']RomanChat["']/);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(screenIdx).toBeGreaterThan(guardIdx);
  });

  it('registers exactly one RomanChat coach route, never unconditionally', () => {
    const occurrences = COACH_NAV.match(/name=["']RomanChat["']/g) ?? [];
    expect(occurrences).toHaveLength(1);
  });

  it('passes surface="coach" so the backend @IsIn value is fixed at the navigator', () => {
    expect(COACH_NAV).toMatch(/surface=["']coach["']/);
  });
});

describe('Roman chat — entry rows gated by the same flag (no dead-end when OFF)', () => {
  it('client More entry row is built behind featureFlags.romanChat', () => {
    expect(MORE_SCREEN).toMatch(/featureFlags\.romanChat\s*\?/);
    // The row targets the flag-gated RomanChat route.
    expect(MORE_SCREEN).toMatch(/screen:\s*['"]RomanChat['"]/);
  });

  it('coach Settings entry row is rendered behind featureFlags.romanChat', () => {
    expect(COACH_SETTINGS).toMatch(/featureFlags\.romanChat\s*\?/);
    const guardIdx = COACH_SETTINGS.search(/featureFlags\.romanChat\s*\?/);
    const navIdx = COACH_SETTINGS.search(/navigate\(['"]RomanChat['"]\)/);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(navIdx).toBeGreaterThan(guardIdx);
  });
});

describe('Roman chat — feature flag defaults OFF', () => {
  it('reads EXPO_PUBLIC_FF_ROMAN_CHAT via readFlag(..., false)', () => {
    expect(FLAGS).toMatch(/readFlag\([^)]*EXPO_PUBLIC_FF_ROMAN_CHAT[^)]*,\s*false\s*\)/);
  });

  it('exposes a romanChat key on featureFlags', () => {
    expect(FLAGS).toMatch(/romanChat\s*:/);
  });
});
