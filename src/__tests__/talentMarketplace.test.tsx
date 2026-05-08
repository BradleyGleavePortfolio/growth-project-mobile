/**
 * ApplicationStatusScreen — snapshot + interaction tests
 *
 * Tests are source-level and import-level — we do not mount the full screen
 * in Jest (heavy RN mocking required) but we validate:
 *   1. The API module is imported and used correctly.
 *   2. Status label and description maps are exhaustive (both STATUS_LABEL
 *      and STATUS_DESCRIPTION reference every status value).
 *   3. Accessibility attributes are referenced in source.
 *
 * A full interaction test (rendering with mocked provider) is tracked as a
 * follow-up for Track 8.5 once the React Native test renderer is wired up.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
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
    // The check strips line comments first so colour tokens used in comments
    // (e.g. JSDoc) do not cause false positives.
    const nonCommentLines = SCREEN_SRC
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
    const hexInCode = nonCommentLines.some((l) => /#[0-9a-fA-F]{3,6}\b/.test(l));
    expect(hexInCode).toBe(false);
  });

  it('has STATUS_LABEL entry for every status value', () => {
    for (const status of ALL_STATUSES) {
      // Object keys may be quoted ('pending':) or unquoted (pending:)
      const quotedPattern = new RegExp(`'${status}'\\s*:`);
      const unquotedPattern = new RegExp(`\\b${status}\\s*:`);
      const found = quotedPattern.test(SCREEN_SRC) || unquotedPattern.test(SCREEN_SRC);
      expect(found).toBe(true);
    }
  });

  it('has STATUS_DESCRIPTION entry for every status value', () => {
    for (const status of ALL_STATUSES) {
      // Verify the status appears at least twice in the file (once per map).
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

  it('does not contain any emoji characters', () => {
    // Pictograph ranges only
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

  it('does not contain any API keys or hardcoded service URLs', () => {
    // Stripe keys start with sk_ or pk_
    expect(API_SRC).not.toMatch(/sk_live|pk_live|sk_test|pk_test/);
    // No hardcoded API base URLs (api.ts handles base URL via env)
    expect(API_SRC).not.toMatch(/https:\/\/api\./);
  });
});
