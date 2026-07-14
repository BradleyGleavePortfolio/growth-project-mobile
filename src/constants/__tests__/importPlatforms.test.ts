import { Ionicons } from '@expo/vector-icons';
import {
  IMPORT_PLATFORMS,
  CUSTOM_PLATFORM_ID,
  findImportPlatform,
} from '../importPlatforms';
import { safeImportLoginUrl } from '../../utils/safeImportLoginUrl';

describe('IMPORT_PLATFORMS catalog', () => {
  it('is data-driven with at least one shortcut plus the custom entry', () => {
    expect(IMPORT_PLATFORMS.length).toBeGreaterThanOrEqual(2);
  });

  it('includes the Custom/Other entry so the flow stays site-agnostic', () => {
    const custom = findImportPlatform(CUSTOM_PLATFORM_ID);
    expect(custom).toBeDefined();
    expect(custom?.label).toBe('Custom / Other');
    expect(custom?.loginUrl).toBeNull();
  });

  it('always lists Custom/Other last as an always-present option', () => {
    expect(IMPORT_PLATFORMS[IMPORT_PLATFORMS.length - 1].id).toBe(CUSTOM_PLATFORM_ID);
  });

  it('uses unique, lowercase-slug ids', () => {
    const ids = IMPORT_PLATFORMS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach((id) => expect(id).toMatch(/^[a-z0-9_-]+$/));
  });

  it('every shortcut loginUrl is a safe public https URL', () => {
    IMPORT_PLATFORMS.filter((p) => p.id !== CUSTOM_PLATFORM_ID).forEach((p) => {
      expect(p.loginUrl).not.toBeNull();
      expect(safeImportLoginUrl(p.loginUrl)).toBe(p.loginUrl);
    });
  });

  it('every entry has a non-empty label and icon', () => {
    IMPORT_PLATFORMS.forEach((p) => {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.icon.length).toBeGreaterThan(0);
    });
  });

  it('every shortcut icon is a real Ionicons glyph name', () => {
    IMPORT_PLATFORMS.forEach((p) => {
      expect(Object.prototype.hasOwnProperty.call(Ionicons.glyphMap, p.icon)).toBe(true);
    });
  });

  it('only the Custom/Other entry has a null loginUrl', () => {
    const nullUrlIds = IMPORT_PLATFORMS.filter((p) => p.loginUrl == null).map((p) => p.id);
    expect(nullUrlIds).toEqual([CUSTOM_PLATFORM_ID]);
  });

  it('every shortcut loginUrl points at the login/sign-in path of its own domain', () => {
    IMPORT_PLATFORMS.filter((p) => p.loginUrl != null).forEach((p) => {
      const u = new URL(p.loginUrl as string);
      expect(u.protocol).toBe('https:');
      expect(u.hostname).toMatch(/\.[a-z]{2,}$/);
      expect(u.pathname.toLowerCase()).toMatch(/login|signin|sign-in/);
    });
  });

  it('exposes the canonical launch shortcuts (TrueCoach, Trainerize, Everfit, My PT Hub)', () => {
    const labels = IMPORT_PLATFORMS.map((p) => p.label);
    ['TrueCoach', 'Trainerize', 'Everfit', 'My PT Hub'].forEach((label) => {
      expect(labels).toContain(label);
    });
  });

  it('findImportPlatform round-trips every catalog id back to its own entry', () => {
    IMPORT_PLATFORMS.forEach((p) => {
      expect(findImportPlatform(p.id)).toBe(p);
    });
  });

  it('findImportPlatform returns undefined for an unknown id', () => {
    expect(findImportPlatform('does-not-exist')).toBeUndefined();
  });

  it('CUSTOM_PLATFORM_ID is a stable lowercase slug', () => {
    expect(CUSTOM_PLATFORM_ID).toBe('custom');
    expect(CUSTOM_PLATFORM_ID).toMatch(/^[a-z0-9_-]+$/);
  });

  it('every shortcut points at a distinct host (no duplicate launch targets)', () => {
    const hosts = IMPORT_PLATFORMS
      .filter((p) => p.loginUrl != null)
      .map((p) => new URL(p.loginUrl as string).hostname);
    expect(new Set(hosts).size).toBe(hosts.length);
  });

  it('labels are human-readable display strings, not raw slugs', () => {
    IMPORT_PLATFORMS.forEach((p) => {
      expect(p.label).not.toMatch(/^[a-z0-9_-]+$/); // would signal an un-humanised slug
    });
  });

  it('only the sentinel id equals CUSTOM_PLATFORM_ID', () => {
    const customs = IMPORT_PLATFORMS.filter((p) => p.id === CUSTOM_PLATFORM_ID);
    expect(customs).toHaveLength(1);
  });
});
