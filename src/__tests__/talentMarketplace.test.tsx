/**
 * talentMarketplace.test.tsx — Phase 11 / Track 8
 *
 * Source-level and import-level guards for ApplicationStatusScreen and
 * talentMarketplaceApi. We do not mount the full screen in Jest (React Native
 * renderer setup is tracked for Track 8.5) but we validate:
 *   1. The API module is imported and used correctly.
 *   2. Status label and description maps are exhaustive.
 *   3. Accessibility attributes are present in source.
 *   4. Quiet-luxury doctrine compliance (no emoji, no forbidden tokens).
 */

import * as fs from 'fs';
import * as path from 'path';

// ROOT resolves to the repository root: src/__tests__/ → src/ → project-root.
const ROOT = path.resolve(__dirname, '..', '..');

const SCREEN_SRC = fs.readFileSync(
  path.join(ROOT, 'src', 'screens', 'applicant', 'ApplicationStatusScreen.tsx'),
  'utf8',
);
const API_SRC = fs.readFileSync(
  path.join(ROOT, 'src', 'services', 'talentMarketplaceApi.ts'),
  'utf8',
);

const ALL_STATUSES = [
  'pending',
  'reviewed',
  'approved',
  'pool',
  'placed',
  'inactive',
] as const;

describe('ApplicationStatusScreen', () => {
  it('imports talentMarketplaceApi', () => {
    expect(SCREEN_SRC).toMatch(/talentMarketplaceApi/);
  });

  it('uses theme tokens and not hardcoded colour hex values', () => {
    // Hardcoded hex values are forbidden by the design doctrine.
    // Strip line/block comments first so colour tokens mentioned in JSDoc do
    // not cause false positives.
    const noComments = SCREEN_SRC
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const hexInCode = /#[0-9a-fA-F]{3,6}\b/.test(noComments);
    expect(hexInCode).toBe(false);
  });

  it('has a STATUS_LABEL entry for every status value', () => {
    for (const status of ALL_STATUSES) {
      // Object keys may be quoted ('pending':) or unquoted (pending:).
      const quotedPattern = new RegExp(`'${status}'\\s*:`);
      const unquotedPattern = new RegExp(`\\b${status}\\s*:`);
      const found = quotedPattern.test(SCREEN_SRC) || unquotedPattern.test(SCREEN_SRC);
      expect(found).toBe(true);
    }
  });

  it('has a STATUS_DESCRIPTION entry for every status value', () => {
    // Each status should appear as an object key at least twice in the file:
    // once in STATUS_LABEL and once in STATUS_DESCRIPTION.
    for (const status of ALL_STATUSES) {
      const pattern = new RegExp(`(?:'${status}'|\\b${status})\\s*:`, 'g');
      const occurrences = (SCREEN_SRC.match(pattern) ?? []).length;
      expect(occurrences).toBeGreaterThanOrEqual(2);
    }
  });

  it('includes accessibilityLabel on the status badge', () => {
    expect(SCREEN_SRC).toMatch(/accessibilityLabel.*Application status/);
  });

  it('includes accessibilityRole on interactive elements', () => {
    expect(SCREEN_SRC).toMatch(/accessibilityRole="button"/);
  });

  it('does not contain pictograph emoji characters', () => {
    // Pictograph ranges only — bare typographic marks (✓ etc.) are allowed.
    // eslint-disable-next-line no-control-regex
    const emojiPattern = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]/u;
    expect(emojiPattern.test(SCREEN_SRC)).toBe(false);
  });

  it('does not contain forbidden token names', () => {
    const forbidden = ['income', 'finance', 'netWorth', 'confetti', 'trophy'];
    for (const token of forbidden) {
      expect(SCREEN_SRC).not.toContain(token);
    }
  });
});

describe('talentMarketplaceApi', () => {
  it('exports getMyApplications function', () => {
    expect(API_SRC).toMatch(/getMyApplications/);
  });

  it('calls GET /applications/me', () => {
    expect(API_SRC).toMatch(/\/applications\/me/);
  });

  it('types CoachApplicationStatus with all valid statuses', () => {
    for (const status of ALL_STATUSES) {
      expect(API_SRC).toContain(`'${status}'`);
    }
  });

  it('exports MyCoachApplication interface', () => {
    expect(API_SRC).toMatch(/MyCoachApplication/);
  });

  it('does not contain API keys or hardcoded service base URLs', () => {
    expect(API_SRC).not.toMatch(/sk_live|pk_live|sk_test|pk_test/);
    expect(API_SRC).not.toMatch(/https:\/\/api\./);
  });
});
