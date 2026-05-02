/**
 * Smoke tests for the screenshot harness. The full simulator flow is
 * impossible to exercise in jest, but these checks catch the most common
 * breakages: a missing fixture for an endpoint a target screen hits, a
 * route slug that does not match a registered screen, a mode flag that
 * leaks state between tests.
 */
import * as fs from 'fs';
import * as path from 'path';
import { isScreenshotMode } from '../mode';
import { SCREENSHOT_TARGETS } from '../screens';
import { DEMO_USER, DEMO_FOOD_LOGS, DEMO_RECIPES } from '../fixtures';

describe('screenshot mode flag', () => {
  const orig = process.env.EXPO_PUBLIC_SCREENSHOT_MODE;
  afterEach(() => {
    if (orig === undefined) delete process.env.EXPO_PUBLIC_SCREENSHOT_MODE;
    else process.env.EXPO_PUBLIC_SCREENSHOT_MODE = orig;
  });

  it('is off by default', () => {
    delete process.env.EXPO_PUBLIC_SCREENSHOT_MODE;
    expect(isScreenshotMode()).toBe(false);
  });

  it('treats "0" and "false" as off', () => {
    process.env.EXPO_PUBLIC_SCREENSHOT_MODE = '0';
    expect(isScreenshotMode()).toBe(false);
    process.env.EXPO_PUBLIC_SCREENSHOT_MODE = 'false';
    expect(isScreenshotMode()).toBe(false);
  });

  it('treats "1" / "true" / any other non-empty string as on', () => {
    process.env.EXPO_PUBLIC_SCREENSHOT_MODE = '1';
    expect(isScreenshotMode()).toBe(true);
    process.env.EXPO_PUBLIC_SCREENSHOT_MODE = 'true';
    expect(isScreenshotMode()).toBe(true);
    process.env.EXPO_PUBLIC_SCREENSHOT_MODE = 'yes';
    expect(isScreenshotMode()).toBe(true);
  });
});

describe('screenshot targets', () => {
  it('every entry has a unique slug and a non-empty route', () => {
    const slugs = new Set<string>();
    for (const t of SCREENSHOT_TARGETS) {
      expect(t.slug).toMatch(/^\d{2}-[a-z0-9-]+$/);
      expect(slugs.has(t.slug)).toBe(false);
      slugs.add(t.slug);
      expect(t.route).toBeTruthy();
    }
  });

  it('routes match registered ClientNavigator screen names', () => {
    // We do not import ClientNavigator (it pulls react-native-screens) — we
    // grep its source instead so the test stays JS-only and fast.
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'navigation', 'ClientNavigator.tsx'),
      'utf8',
    );
    for (const t of SCREENSHOT_TARGETS) {
      const re = new RegExp(`name=["']${t.route}["']`);
      expect(src).toMatch(re);
    }
  });
});

describe('demo fixtures', () => {
  it('demo user has macro targets so HomeScreen renders ring/grid', () => {
    expect(DEMO_USER.profile?.calorie_target).toBeGreaterThan(0);
    expect(DEMO_USER.profile?.protein_target).toBeGreaterThan(0);
    expect(DEMO_USER.profile?.carbs_target).toBeGreaterThan(0);
    expect(DEMO_USER.profile?.fat_target).toBeGreaterThan(0);
  });

  it('food logs cover three meal types', () => {
    const types = new Set(DEMO_FOOD_LOGS.map((l) => l.meal_type));
    expect(types.size).toBeGreaterThanOrEqual(3);
  });

  it('recipes have non-zero protein/calories', () => {
    for (const r of DEMO_RECIPES) {
      expect(r.calories).toBeGreaterThan(0);
      expect(r.protein).toBeGreaterThan(0);
    }
  });
});
