/**
 * Flag-off guarantees for the coach Import Data (v0.3 extension) surface.
 *
 * When featureFlags.extensionImport is OFF (the default), the ImportData route
 * must NOT register and the Settings entry row must NOT render. Asserted
 * STATICALLY by reading the sources and pinning the flag gate (mirrors
 * romanFlagOff.test.ts), plus a runtime assertion that the flag defaults false
 * and reads its env var.
 */
import * as fs from 'fs';
import * as path from 'path';
import { featureFlags } from '../../config/featureFlags';

const ROOT = path.resolve(__dirname, '..', '..');
function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const COACH_NAV = read(path.join('navigation', 'CoachNavigator.tsx'));
const COACH_SETTINGS = read(path.join('screens', 'coach', 'SettingsScreen.tsx'));
const FLAGS = read(path.join('config', 'featureFlags.ts'));

describe('extensionImport flag defaults', () => {
  it('defaults OFF at runtime', () => {
    expect(featureFlags.extensionImport).toBe(false);
  });

  it('reads EXPO_PUBLIC_FF_EXTENSION_IMPORT with a false default (not isDev)', () => {
    expect(FLAGS).toMatch(
      /extensionImport:\s*readFlag\(\s*'EXPO_PUBLIC_FF_EXTENSION_IMPORT',\s*false\s*\)/,
    );
  });
});

describe('ImportData route is gated behind featureFlags.extensionImport', () => {
  it('registers the ImportData <Screen> only AFTER the flag guard', () => {
    const guardIdx = COACH_NAV.search(/\{featureFlags\.extensionImport\s*&&/);
    const screenIdx = COACH_NAV.search(/name=["']ImportData["']/);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(screenIdx).toBeGreaterThan(guardIdx);
  });

  it('registers exactly one ImportData route, never unconditionally', () => {
    const occurrences = COACH_NAV.match(/name=["']ImportData["']/g) ?? [];
    expect(occurrences).toHaveLength(1);
  });
});

describe('Import Data settings row is gated behind featureFlags.extensionImport', () => {
  it('renders the row only AFTER the flag guard', () => {
    const guardIdx = COACH_SETTINGS.search(/\{featureFlags\.extensionImport\s*&&/);
    const rowIdx = COACH_SETTINGS.search(/navigate\(['"]ImportData['"]\)/);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(rowIdx).toBeGreaterThan(guardIdx);
  });

  it('does NOT touch the Day-1 client-invite CoachPairing flow', () => {
    expect(COACH_SETTINGS).not.toMatch(/CoachPairing/);
  });
});

describe('extensionImport kill switch resolves from the env var', () => {
  const KEY = 'EXPO_PUBLIC_FF_EXTENSION_IMPORT';
  const original = process.env[KEY];

  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
    jest.resetModules();
  });

  function loadFlag(): boolean {
    let value = false;
    jest.isolateModules(() => {
      value = require('../../config/featureFlags').featureFlags.extensionImport;
    });
    return value;
  }

  it.each(['true', '1', 'yes', 'on', 'TRUE', ' On '])(
    'is ON when the env var is a truthy string %p',
    (raw) => {
      process.env[KEY] = raw;
      expect(loadFlag()).toBe(true);
    },
  );

  it.each(['false', '0', 'no', 'off', ''])(
    'is OFF when the env var is a falsy string %p',
    (raw) => {
      process.env[KEY] = raw;
      expect(loadFlag()).toBe(false);
    },
  );

  it('is OFF when the env var is entirely absent (production-safe default)', () => {
    delete process.env[KEY];
    expect(loadFlag()).toBe(false);
  });
});
