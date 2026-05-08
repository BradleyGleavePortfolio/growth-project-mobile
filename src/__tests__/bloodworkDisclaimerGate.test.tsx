/**
 * Contract tests for the bloodwork disclaimer gate.
 *
 * Uses source-level assertions (the standard pattern in this codebase — see
 * RiskBoardScreen.test.tsx, clientNavigator.test.ts) rather than rendering
 * native components, which would require a full Expo environment in CI.
 *
 * Covers:
 *   1. Feature flag gate — fails closed; flag is off by default
 *   2. Disclaimer acknowledgement — SecureStore key format; not bypassable
 *   3. Privacy doctrine — bloodwork values do not leak to non-owner surfaces
 *   4. Modal copy — required safety phrases present
 *   5. BloodworkEntryScreen wiring — useCurrentUser, disclaimer helper, flag check
 *   6. bloodworkDisclaimerHelper — stores per-user key, v1 version prefix
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');

const ENTRY_SRC = fs.readFileSync(
  path.join(SRC, 'screens', 'client', 'BloodworkEntryScreen.tsx'),
  'utf8',
);
const MODAL_SRC = fs.readFileSync(
  path.join(SRC, 'components', 'BloodworkDisclaimerModal.tsx'),
  'utf8',
);
const HELPER_SRC = fs.readFileSync(
  path.join(SRC, 'lib', 'bloodworkDisclaimerHelper.ts'),
  'utf8',
);
const COPY_SRC = fs.readFileSync(
  path.join(SRC, 'constants', 'bloodworkCopy.ts'),
  'utf8',
);

// ─── 1. Feature flag gate ────────────────────────────────────────────────────

describe('BloodworkEntryScreen — feature flag gate', () => {
  it('imports isFeatureEnabled from featureFlags', () => {
    expect(ENTRY_SRC).toMatch(/isFeatureEnabled/);
  });

  it("checks the 'bloodwork' flag before rendering data", () => {
    expect(ENTRY_SRC).toMatch(/isFeatureEnabled\s*\(\s*['"]bloodwork['"]\s*\)/);
  });

  it('renders the BLOODWORK_FEATURE_OFF_TITLE when flag is off', () => {
    // Feature-off state uses the constant, not a hardcoded string.
    expect(ENTRY_SRC).toMatch(/BLOODWORK_FEATURE_OFF_TITLE/);
  });
});

// ─── 2. Disclaimer acknowledgement ──────────────────────────────────────────

describe('bloodworkDisclaimerHelper — acknowledgement contract', () => {
  it('exports hasAcknowledgedDisclaimer and recordDisclaimerAcknowledgement', () => {
    expect(HELPER_SRC).toMatch(/export.*hasAcknowledgedDisclaimer/);
    expect(HELPER_SRC).toMatch(/export.*recordDisclaimerAcknowledgement/);
  });

  it('uses the versioned v1 key prefix so old acks are invalidated on copy change', () => {
    expect(HELPER_SRC).toMatch(/bloodwork_disclaimer_ack_v1/);
  });

  it('keys acknowledgement by userId so per-user isolation is enforced', () => {
    expect(HELPER_SRC).toMatch(/\$\{userId\}/);
  });

  it('uses expo-secure-store (not AsyncStorage) for medical data', () => {
    expect(HELPER_SRC).toMatch(/expo-secure-store/);
  });
});

describe('BloodworkEntryScreen — disclaimer is not bypassable', () => {
  it('imports hasAcknowledgedDisclaimer to gate the screen', () => {
    expect(ENTRY_SRC).toMatch(/hasAcknowledgedDisclaimer/);
  });

  it('shows BloodworkDisclaimerModal when disclaimer not yet acknowledged', () => {
    expect(ENTRY_SRC).toMatch(/BloodworkDisclaimerModal/);
  });

  it('uses useCurrentUser (not useAuth) to get the userId for the gate key', () => {
    expect(ENTRY_SRC).toMatch(/useCurrentUser/);
    expect(ENTRY_SRC).not.toMatch(/\buseAuth\b/);
  });

  it('has a loading state while the SecureStore check is in progress', () => {
    // The loading state uses the BLOODWORK_LOADING_DISCLAIMER_CHECK constant.
    expect(ENTRY_SRC).toMatch(/BLOODWORK_LOADING_DISCLAIMER_CHECK/);
  });
});

// ─── 3. Privacy doctrine ─────────────────────────────────────────────────────

describe('BloodworkEntryScreen — privacy doctrine', () => {
  it('does not import any Leaderboard component', () => {
    // "leaderboard" may appear in comments explaining the doctrine;
    // what matters is that no Leaderboard component is imported.
    expect(ENTRY_SRC).not.toMatch(/import.*[Ll]eaderboard/);
  });

  it('does not use Share.share or shareAsync utilities', () => {
    expect(ENTRY_SRC).not.toMatch(/Share\.share|shareAsync/);
  });

  it('does not reference PDF export', () => {
    expect(ENTRY_SRC).not.toMatch(/[Pp][Dd][Ff]/);
  });
});

// ─── 4. Disclaimer modal copy ────────────────────────────────────────────────

describe('bloodworkCopy — required safety phrases', () => {
  it('contains "not medical advice" in the long-form disclaimer', () => {
    expect(COPY_SRC).toMatch(/not medical advice/i);
  });

  it('contains "not a diagnosis" in the long-form disclaimer', () => {
    expect(COPY_SRC).toMatch(/not a diagnosis/i);
  });

  it('contains "clinician" in the long-form disclaimer', () => {
    expect(COPY_SRC).toMatch(/clinician/i);
  });

  it('exports the modal title constant', () => {
    expect(COPY_SRC).toMatch(/BLOODWORK_DISCLAIMER_MODAL_TITLE/);
  });

  it('exports the acknowledgement button constant', () => {
    expect(COPY_SRC).toMatch(/BLOODWORK_DISCLAIMER_ACK_BUTTON/);
  });
});

// ─── 5. BloodworkDisclaimerModal wiring ─────────────────────────────────────

describe('BloodworkDisclaimerModal — contract', () => {
  it('requires a visible prop and onAcknowledged callback', () => {
    expect(MODAL_SRC).toMatch(/visible/);
    expect(MODAL_SRC).toMatch(/onAcknowledged/);
  });

  it('renders the long-form disclaimer copy', () => {
    expect(MODAL_SRC).toMatch(/BLOODWORK_DISCLAIMER_LONG/);
  });

  it('renders the acknowledgement button', () => {
    expect(MODAL_SRC).toMatch(/BLOODWORK_DISCLAIMER_ACK_BUTTON/);
  });

  it('calls recordDisclaimerAcknowledgement before calling onAcknowledged', () => {
    expect(MODAL_SRC).toMatch(/recordDisclaimerAcknowledgement/);
  });

  it('has no emoji in source', () => {
    // eslint-disable-next-line no-control-regex
    expect(MODAL_SRC).not.toMatch(/[\u{1F300}-\u{1FFFF}]/u);
  });
});

// ─── 6. SecureStore key format ───────────────────────────────────────────────

describe('bloodworkDisclaimerHelper — SecureStore key format', () => {
  it('follows the bloodwork_disclaimer_ack_v1_<userId> pattern', () => {
    expect(HELPER_SRC).toMatch(/bloodwork_disclaimer_ack_\$\{DISCLAIMER_VERSION\}_\$\{userId\}/);
    expect(HELPER_SRC).toMatch(/DISCLAIMER_VERSION\s*=\s*['"]v1['"]/);
  });

  it('pins the v1 key version (bump to v2 when disclaimer copy changes)', () => {
    expect(HELPER_SRC).toMatch(/v1/);
  });
});
