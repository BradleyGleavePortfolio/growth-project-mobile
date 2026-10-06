/**
 * ExtensionPairingPanel — behavioral tests (v0.3 import, PR-M2; UX-03a
 * paired-state truth correction).
 *
 * The useExtensionPairing hook is mocked so we can drive each lifecycle state
 * deterministically and assert the panel's honest rendering:
 *   - auto-mints exactly once on mount (single-flight guard is the hook's job),
 *   - minting spinner, waiting (code + cancel — no client-clock countdown),
 *     paired (a calm "Connected to your computer" confirmation with a
 *     truthful checklist — no roster/reconstruct progress or completion
 *     claim), and the shared recoverable/attention layout,
 *   - the paired state names the server-owned identity from useCurrentUser
 *     and never claims more than "pair/status" proves,
 *   - cancel and retry are wired to the hook,
 *   - Quiet-Luxury doctrine: no 700/800 font weights,
 *   - accessibility: polite live regions, spaced code label, button roles.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent, cleanup, act } from '@testing-library/react-native';

// Mirrors the mocked theme below — used by the B1 tests to distinguish
// ChecklistRow's pending-icon colour (textMuted) from its done-icon colour
// (primary), since the Ionicons glyph name itself is not literal text in
// this test environment's render tree (see the B1 describe block).
const MUTED_ICON_COLOR = '#999';
const PRIMARY_ICON_COLOR = '#2c4a36';

jest.mock('../../../theme/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#fff', surface: '#f5f5f5', border: '#ddd', primary: '#2c4a36',
      textPrimary: '#111', textSecondary: '#555', textMuted: '#999',
      textOnPrimary: '#fff', info: '#2b6cb0', error: '#c0392b',
    },
  }),
}));

const mockStart = jest.fn();
const mockRetry = jest.fn();
const mockCancel = jest.fn();
let mockHookState: {
  status: string;
  code: string | null;
  supportReference?: string | null;
  reason?: 'conflict' | 'challengeUnavailable' | null;
  readiness?: { run: 'none' | 'open' | 'terminal'; sourceDeclared: boolean; declaredPlatforms: number | null };
};
// UX-03c: PAIRING_REASON_COPY is the real, frozen contract-named copy from
// the hook module. The panel imports it directly (not through the mocked
// hook's return value), so the mock factory re-exports the actual constant
// alongside the mocked hook function.
jest.mock('../../../hooks/useExtensionPairing', () => {
  const actual = jest.requireActual('../../../hooks/useExtensionPairing');
  return {
    PAIRING_REASON_COPY: actual.PAIRING_REASON_COPY,
    useExtensionPairing: () => ({
      ...mockHookState,
      start: mockStart,
      retry: mockRetry,
      cancel: mockCancel,
    }),
  };
});

// UX-03a: server-owned identity for the paired checklist comes only from
// useCurrentUser (never a client-edited field). Mocked so the identity line
// is deterministic; the hook's own behaviour is covered elsewhere.
let mockCurrentUser: { id: string; email: string; name?: string } | null;
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => mockCurrentUser,
}));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

const mockTrack = jest.fn();
jest.mock('../../../analytics/posthog.service', () => ({
  track: (...a: unknown[]) => mockTrack(...a),
}));

import ExtensionPairingPanel from '../ExtensionPairingPanel';
import { AnalyticsEvents } from '../../../analytics/events';

beforeEach(() => {
  mockStart.mockClear();
  mockRetry.mockClear();
  mockCancel.mockClear();
  mockNavigate.mockClear();
  mockTrack.mockClear();
  mockHookState = { status: 'idle', code: null, supportReference: null };
  mockCurrentUser = { id: 'coach-1', email: 'coach@example.com', name: 'Jordan Coach' };
});

afterEach(() => {
  cleanup();
});

describe('ExtensionPairingPanel — mount', () => {
  it('auto-mints exactly once on mount', async () => {
    mockHookState = { status: 'minting', code: null };
    await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it('does not re-mint across re-renders', async () => {
    mockHookState = { status: 'minting', code: null };
    const { rerender } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    await rerender(<ExtensionPairingPanel platformId="truecoach" />);
    expect(mockStart).toHaveBeenCalledTimes(1);
  });
});

describe('ExtensionPairingPanel — lifecycle rendering', () => {
  it('shows the minting spinner state', async () => {
    mockHookState = { status: 'minting', code: null };
    const { getByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(getByTestId('pairing-minting')).toBeTruthy();
  });

  it('shows the code + cancel in the waiting state (no client-clock countdown)', async () => {
    mockHookState = { status: 'waiting', code: '482913' };
    const { getByTestId, queryByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(getByTestId('pairing-code')).toHaveTextContent('482913');
    expect(getByTestId('pairing-cancel')).toBeTruthy();
    // Expiry is server-authoritative — the panel renders no local countdown.
    expect(queryByTestId('pairing-countdown')).toBeNull();
  });

  it('reads the code out spaced for screen readers and never claims completion', async () => {
    mockHookState = { status: 'waiting', code: '482913' };
    const { getByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(getByTestId('pairing-code').props.accessibilityLabel).toBe('Pairing code 4 8 2 9 1 3');
  });

  it('wires cancel to the hook', async () => {
    mockHookState = { status: 'waiting', code: '482913' };
    const { getByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    fireEvent.press(getByTestId('pairing-cancel'));
    expect(mockCancel).toHaveBeenCalledTimes(1);
  });

  it('shows an HONEST paired state — a calm confirmation, no progress, percentage, or entity counts', async () => {
    mockHookState = { status: 'paired', code: null };
    const { getByTestId, toJSON } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(getByTestId('pairing-paired')).toBeTruthy();
    const serialized = JSON.stringify(toJSON());
    expect(serialized).toMatch(/Connected to your computer/);
    expect(serialized).not.toMatch(/\b\d{1,3}%/);
    expect(serialized).not.toMatch(/imported successfully|import complete|\b\d+ (records|entities|pages)\b/i);
  });

  it('names the server-owned identity from useCurrentUser in the checklist', async () => {
    mockCurrentUser = { id: 'coach-1', email: 'coach@example.com', name: 'Jordan Coach' };
    mockHookState = { status: 'paired', code: null };
    const { getByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(getByTestId('pairing-check-identity')).toHaveTextContent('Jordan Coach', { exact: false });
  });

  it('falls back to email when no display name has resolved', async () => {
    mockCurrentUser = { id: 'coach-1', email: 'coach@example.com' };
    mockHookState = { status: 'paired', code: null };
    const { getByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(getByTestId('pairing-check-identity')).toHaveTextContent('coach@example.com', { exact: false });
  });

  it('shows the truthful checklist: importer available, identity, and previous platform not yet known', async () => {
    mockHookState = { status: 'paired', code: null };
    const { getByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(getByTestId('pairing-check-importer')).toHaveTextContent('Importer available', { exact: false });
    expect(getByTestId('pairing-check-platform')).toHaveTextContent('Not yet known', { exact: false });
  });

  it('shows the instructional primary action with no URL or locator', async () => {
    mockHookState = { status: 'paired', code: null };
    const { getByTestId, toJSON } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(getByTestId('pairing-paired')).toHaveTextContent('Continue on your computer', { exact: false });
    const serialized = JSON.stringify(toJSON());
    expect(serialized).not.toMatch(/https?:\/\//);
  });

  it('exposes a typed, reachable "Review clients" link with no count or progress claim, and fires review analytics', async () => {
    mockHookState = { status: 'paired', code: null };
    const { getByTestId, toJSON } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    fireEvent.press(getByTestId('pairing-review-cta'));
    expect(mockNavigate).toHaveBeenCalledWith('ClientsStack', { screen: 'ClientsList' });
    expect(mockTrack).toHaveBeenCalledWith(AnalyticsEvents.IMPORT_REVIEW_OPENED, {
      platform: 'truecoach',
    });
    const serialized = JSON.stringify(toJSON());
    expect(serialized).not.toMatch(/\b\d+ (new )?clients?\b/i);
  });

  it('review analytics payload carries ONLY the platform slug — no counts, IDs, or PII', async () => {
    mockHookState = { status: 'paired', code: null };
    const { getByTestId } = await render(<ExtensionPairingPanel platformId="trainerize" />);
    fireEvent.press(getByTestId('pairing-review-cta'));
    const [, props] = mockTrack.mock.calls.find(
      ([name]) => name === AnalyticsEvents.IMPORT_REVIEW_OPENED,
    )!;
    expect(props).toEqual({ platform: 'trainerize' });
  });

  it.each([
    ['expired', 'pairing-retry'],
    ['failed', 'pairing-retry'],
    ['authExpired', 'pairing-retry'],
    ['cancelled', 'pairing-retry'],
  ])('renders the %s attention state with a recovery CTA', async (status, cta) => {
    mockHookState = { status, code: null };
    const { getByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(getByTestId(`pairing-${status}`)).toBeTruthy();
    fireEvent.press(getByTestId(cta));
    expect(mockRetry).toHaveBeenCalledTimes(1);
  });

  it('renders the unavailable state WITHOUT a retry CTA (nothing to retry)', async () => {
    mockHookState = { status: 'unavailable', code: null };
    const { getByTestId, queryByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(getByTestId('pairing-unavailable')).toBeTruthy();
    expect(queryByTestId('pairing-retry')).toBeNull();
  });

  it('does not render a code, countdown, or cancel once paired', async () => {
    mockHookState = { status: 'paired', code: null };
    const { queryByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(queryByTestId('pairing-code')).toBeNull();
    expect(queryByTestId('pairing-countdown')).toBeNull();
    expect(queryByTestId('pairing-cancel')).toBeNull();
  });

  it('does not render a retry CTA in the paired state', async () => {
    mockHookState = { status: 'paired', code: null };
    const { queryByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(queryByTestId('pairing-retry')).toBeNull();
  });

  it.each([
    ['expired', /expired/i],
    ['failed', /couldn.t reach|try again/i],
    ['authExpired', /session/i],
    ['unavailable', /available/i],
    ['cancelled', /cancelled/i],
  ])('renders honest, distinct copy for the %s state', async (status, matcher) => {
    mockHookState = { status, code: null };
    const { getByTestId, toJSON } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(getByTestId(`pairing-${status}`)).toBeTruthy();
    expect(JSON.stringify(toJSON())).toMatch(matcher);
  });

  it.each(['expired', 'failed', 'authExpired', 'unavailable', 'cancelled'])(
    'never claims progress, percentage, or counts in the %s attention state',
    async (status) => {
      mockHookState = { status, code: null };
      const { toJSON } = await render(<ExtensionPairingPanel platformId="truecoach" />);
      const serialized = JSON.stringify(toJSON());
      expect(serialized).not.toMatch(/\b\d{1,3}%/);
      expect(serialized).not.toMatch(/imported successfully|import complete|\b\d+ (clients|records|entities|pages)\b/i);
    },
  );

  it.each(['expired', 'failed', 'authExpired', 'unavailable', 'cancelled'])(
    'never claims a retirement, revocation, or disconnect in the %s attention state',
    async (status) => {
      mockHookState = { status, code: null };
      const { toJSON } = await render(<ExtensionPairingPanel platformId="truecoach" />);
      const serialized = JSON.stringify(toJSON());
      expect(serialized).not.toMatch(/revoked|disconnected|retired/i);
    },
  );
});

// UX-03c: contract-named reason copy. When the hook supplies `reason`
// alongside `failed`/`expired`, the panel must render the exact frozen
// PAIRING_REASON_COPY message and remedy for that reason — not the generic
// fallback — and a null/absent reason must keep the pre-existing UX-03a
// copy exactly as it was, unchanged.
describe('ExtensionPairingPanel — contract-named reason copy (UX-03c)', () => {
  it('renders the frozen conflict copy when failed with reason: conflict', async () => {
    mockHookState = { status: 'failed', code: null, reason: 'conflict' };
    const { getByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(getByTestId('pairing-reason-message')).toHaveTextContent(
      /This setup was started for a different platform/,
    );
    expect(getByTestId('pairing-failed')).toHaveTextContent(/Get a new code/);
  });

  it('renders the frozen challengeUnavailable copy when expired with reason: challengeUnavailable', async () => {
    mockHookState = { status: 'expired', code: null, reason: 'challengeUnavailable' };
    const { getByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(getByTestId('pairing-reason-message')).toHaveTextContent(
      /Your code is no longer valid; your setup is kept/,
    );
    expect(getByTestId('pairing-expired')).toHaveTextContent(/Get a new code/);
  });

  it('keeps the existing generic failed copy when reason is null', async () => {
    mockHookState = { status: 'failed', code: null, reason: null };
    const { getByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(getByTestId('pairing-reason-message')).toHaveTextContent(/pairing status could not be checked/i);
    expect(getByTestId('pairing-failed')).toHaveTextContent(/Try again/);
  });

  it('keeps the existing generic expired copy when reason is absent (undefined)', async () => {
    mockHookState = { status: 'expired', code: null };
    const { getByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(getByTestId('pairing-reason-message')).toHaveTextContent(/Your setup is kept/);
    expect(getByTestId('pairing-expired')).toHaveTextContent(/Get a new code/);
  });

  it('never renders the setup nonce, intent id, or a locator for either reason', async () => {
    mockHookState = { status: 'failed', code: null, reason: 'conflict' };
    const { toJSON } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    const serialized = JSON.stringify(toJSON());
    expect(serialized).not.toMatch(/nonce|intent.?id|https?:\/\//i);
  });

  it('retains the polite live region on the reason-driven failed/expired card', async () => {
    mockHookState = { status: 'failed', code: null, reason: 'conflict' };
    const { getByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(getByTestId('pairing-failed').props.accessibilityLiveRegion).toBe('polite');
  });
});

describe('ExtensionPairingPanel — doctrine + accessibility', () => {
  it.each(['minting', 'waiting', 'paired', 'failed'] as const)(
    'uses no 700/800 font weights in the %s state (Quiet Luxury)',
    async (status) => {
      mockHookState = {
        status,
        code: status === 'waiting' ? '482913' : null,
      };
      const { toJSON } = await render(<ExtensionPairingPanel platformId="truecoach" />);
      const flatten = (node: unknown): void => {
        const n = node as { props?: { style?: unknown }; children?: unknown[] } | null;
        if (!n || typeof n !== 'object') return;
        const style = StyleSheet.flatten(n.props?.style) as { fontWeight?: string } | undefined;
        if (style?.fontWeight) expect(['700', '800']).not.toContain(String(style.fontWeight));
        (n.children ?? []).forEach(flatten);
      };
      const tree = toJSON();
      (Array.isArray(tree) ? tree : [tree]).forEach(flatten);
    },
  );

  // R300-A3-B2: the "paired" card's OWN `polite` region was removed —
  // it sat directly around `ImportRunStatusJourney` (mounted only when an
  // intent id is present), so Android's live-region propagation
  // re-announced that ENTIRE card, including the import status child,
  // whenever anything changed inside it. That status now announces its
  // own material changes via `AccessibilityInfo.announceForAccessibility`
  // with no live region anywhere on its own path
  // (`ImportRunStatusJourney.host.test.tsx` covers the real paired host
  // tree end to end); no ancestor here may set one around it.
  it('the paired card no longer carries its own polite live region (the import status child announces itself imperatively instead)', async () => {
    mockHookState = { status: 'paired', code: null };
    const { getByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(getByTestId('pairing-paired').props.accessibilityLiveRegion).toBeUndefined();
  });

  it.each([
    ['minting', 'pairing-minting'],
    ['waiting', 'pairing-waiting'],
    ['failed', 'pairing-failed'],
  ])('uses a polite live region in the %s state too', async (status, testId) => {
    mockHookState = {
      status,
      code: status === 'waiting' ? '482913' : null,
    };
    const { getByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(getByTestId(testId).props.accessibilityLiveRegion).toBe('polite');
  });

  it('titles the paired card honestly as "Connected to your computer" (not "Complete"/"Imported"/"Paired")', async () => {
    mockHookState = { status: 'paired', code: null };
    const { toJSON } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    const serialized = JSON.stringify(toJSON());
    expect(serialized).toMatch(/Connected to your computer/);
    expect(serialized).not.toMatch(/complete|imported|finished|done/i);
    expect(serialized).not.toMatch(/\bPaired\b/);
  });

  it('gives the cancel control a button role and label', async () => {
    mockHookState = { status: 'waiting', code: '482913' };
    const { getByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    const cancel = getByTestId('pairing-cancel');
    expect(cancel.props.accessibilityRole).toBe('button');
    expect(cancel.props.accessibilityLabel).toMatch(/cancel/i);
  });
});

/**
 * Round-2 audit C7 fix: collect every string leaf out of an RTL toJSON()
 * host-node tree. toJSON() is RTL's own serializable snapshot (plain
 * strings/objects/arrays) — never a React element, so it can never carry a
 * circular _owner Fiber the way `element.props.children` can under React
 * 19.2 dev (that circularity is what threw "Converting circular structure to
 * JSON" — the CI red this fix closes). Safe to JSON.stringify directly, but
 * walking to exact string leaves also means a false match can't hide inside
 * a coincidentally-matching object key.
 */
function collectText(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') {
    out.push(node);
  } else if (Array.isArray(node)) {
    for (const child of node) collectText(child, out);
  } else if (node && typeof node === 'object') {
    // RTL's toJSON() node shape is `{ type, props, children }` — `children`
    // is a sibling of `props`, not nested inside it.
    const n = node as { children?: unknown };
    if ('children' in n) collectText(n.children, out);
  }
  return out;
}

/**
 * Finds the toJSON() host-node subtree carrying a given testID, without a
 * live RTL query. RTL's toJSON() node shape is `{ type, props, children }`
 * — `children` is a SIBLING of `props`, not nested inside it — so a walker
 * has to descend via the node's own `children` field.
 */
function findByTestId(node: unknown, testID: string): unknown {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByTestId(child, testID);
      if (found) return found;
    }
    return null;
  }
  const n = node as { props?: { testID?: string }; children?: unknown };
  if (n.props?.testID === testID) return node;
  if ('children' in n) return findByTestId(n.children, testID);
  return null;
}

// Applies to the readiness row/labels ALONE, where every rendered word is
// something readinessCopy() produced — an unqualified match is correct
// there. The full-card sweep below deliberately keeps the narrower
// "source ... connected"-shaped match, because the pre-existing, out-of-scope
// pairing copy legitimately says "Connected to your computer" / "Connected to
// TGP as ..." (about the PAIRING, never the import source) elsewhere on the
// same card.
function expectNoBannedWords(strings: string[]): void {
  const joined = strings.join(' \u241F ');
  expect(joined).not.toMatch(/\bauthorized\b/i);
  expect(joined).not.toMatch(/\bready\b/i);
  expect(joined).not.toMatch(/\bconnected\b/i);
  expect(joined).not.toMatch(/\bverified\b/i);
}

function expectNoBannedSourceClaims(strings: string[]): void {
  const joined = strings.join(' \u241F ');
  expect(joined).not.toMatch(/source (is )?authorized/i);
  expect(joined).not.toMatch(/source (is )?ready/i);
  expect(joined).not.toMatch(/source (is )?connected/i);
  expect(joined).not.toMatch(/source (is )?verified/i);
}

/**
 * S11-C (D-S11-5, UX-03/04) readiness row — ExtensionPairingPanel.
 *
 * The panel renders a neutral readiness row inside the `paired` checklist
 * ONLY when useExtensionPairing's `readiness` is a known reading; absence
 * renders NOTHING (never a "no"/zero row). These tests pin the row's
 * presence/absence per state and the exact honesty-compliant copy, plus a
 * banned-words sweep (collected via collectText/toJSON — round-2 audit C7,
 * never via JSON.stringify on a raw React element) across every readiness
 * string and a11y label this module can render.
 */
describe('ExtensionPairingPanel — S11-C readiness row', () => {
  it('renders no readiness row when readiness is absent (not known)', async () => {
    mockHookState = { status: 'paired', code: null };
    const { queryByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(queryByTestId('pairing-check-readiness')).toBeNull();
  });

  it('run=none, no declaration: "Not started yet" — never reads as a negative/zero claim', async () => {
    mockHookState = {
      status: 'paired',
      code: null,
      readiness: { run: 'none', sourceDeclared: false, declaredPlatforms: null },
    };
    const { getByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(getByTestId('pairing-check-readiness')).toHaveTextContent('Not started yet', { exact: false });
  });

  it('run=open, no declaration yet: "Waiting for a declaration"', async () => {
    mockHookState = {
      status: 'paired',
      code: null,
      readiness: { run: 'open', sourceDeclared: false, declaredPlatforms: null },
    };
    const { getByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(getByTestId('pairing-check-readiness')).toHaveTextContent('Waiting for a declaration', { exact: false });
  });

  it('run=open, source declared with a platform count: "Declaration received (N source(s))" — count only, no name', async () => {
    mockHookState = {
      status: 'paired',
      code: null,
      readiness: { run: 'open', sourceDeclared: true, declaredPlatforms: 1 },
    };
    const { getByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(getByTestId('pairing-check-readiness')).toHaveTextContent('Declaration received (1 source)', { exact: false });
  });

  it('run=open, source declared with multiple platforms: pluralizes the count, still no platform name', async () => {
    mockHookState = {
      status: 'paired',
      code: null,
      readiness: { run: 'open', sourceDeclared: true, declaredPlatforms: 3 },
    };
    const { getByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(getByTestId('pairing-check-readiness')).toHaveTextContent('Declaration received (3 sources)', { exact: false });
  });

  it('run=terminal: points to the existing import status read, invents no detail', async () => {
    mockHookState = {
      status: 'paired',
      code: null,
      readiness: { run: 'terminal', sourceDeclared: true, declaredPlatforms: 1 },
    };
    const { getByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    const row = getByTestId('pairing-check-readiness');
    expect(row).toHaveTextContent('import status', { exact: false });
  });

  // Round-2 audit B1: 'terminal' covers failed, cancelled AND timed_out alike
  // (D-S11 G4) with no detail carried in this block — a completed/success
  // checkmark next to it would fabricate an outcome never reported here. The
  // row must render the SAME neutral icon and no " checkmark" suffix as
  // every other state, specifically for terminal (the state a naive
  // "pending = run !== 'terminal'" reading would get wrong).
  // The Ionicons glyph itself resolves to an empty-string Text child in this
  // test environment (no font glyph map loaded) — "ellipse-outline" vs
  // "checkmark" is not a literal string anywhere in the render tree. The
  // reliably inspectable signal ChecklistRow actually varies by `pending` is
  // the icon's colour (colors.textMuted when pending vs colors.primary when
  // not — see ChecklistRow's two Ionicons branches) and the label's " ✓"
  // text suffix, which IS a literal string. Both are asserted below.
  it('B1: run=terminal renders the neutral (pending-coloured) icon, never a success checkmark or "✓" suffix', async () => {
    mockHookState = {
      status: 'paired',
      code: null,
      readiness: { run: 'terminal', sourceDeclared: true, declaredPlatforms: 1 },
    };
    const { getByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    const row = getByTestId('pairing-check-readiness');
    const serialized = JSON.stringify(row.toJSON());
    expect(serialized).not.toContain('✓');
    expect(serialized).not.toContain('checkmark');
    expect(serialized).toContain(MUTED_ICON_COLOR); // the pending-icon colour, never PRIMARY_ICON_COLOR
    expect(serialized).not.toContain(PRIMARY_ICON_COLOR);
  });

  it.each<['none' | 'open' | 'terminal', { run: 'none' | 'open' | 'terminal'; sourceDeclared: boolean; declaredPlatforms: number | null }]>([
    ['none', { run: 'none', sourceDeclared: false, declaredPlatforms: null }],
    ['open', { run: 'open', sourceDeclared: true, declaredPlatforms: 1 }],
    ['terminal', { run: 'terminal', sourceDeclared: true, declaredPlatforms: 1 }],
  ])('B1: the readiness row never shows a checkmark, a "✓" suffix, or the done-icon colour for run=%s', async (_run, readiness) => {
    mockHookState = { status: 'paired', code: null, readiness };
    const { getByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    const serialized = JSON.stringify(getByTestId('pairing-check-readiness').toJSON());
    expect(serialized).not.toContain('✓');
    expect(serialized).not.toMatch(/"checkmark"/);
    expect(serialized).not.toContain(PRIMARY_ICON_COLOR);
  });

  it('never renders the readiness row outside the paired state', async () => {
    mockHookState = { status: 'waiting', code: '482913', readiness: { run: 'open', sourceDeclared: true, declaredPlatforms: 1 } };
    const { queryByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(queryByTestId('pairing-check-readiness')).toBeNull();
  });

  it.each<[string, { run: 'none' | 'open' | 'terminal'; sourceDeclared: boolean; declaredPlatforms: number | null }]>([
    ['none/undeclared', { run: 'none', sourceDeclared: false, declaredPlatforms: null }],
    ['open/undeclared', { run: 'open', sourceDeclared: false, declaredPlatforms: null }],
    ['open/declared-1', { run: 'open', sourceDeclared: true, declaredPlatforms: 1 }],
    ['open/declared-2', { run: 'open', sourceDeclared: true, declaredPlatforms: 2 }],
    ['terminal/declared', { run: 'terminal', sourceDeclared: true, declaredPlatforms: 1 }],
  ])(
    'banned-words sweep (%s): never says authorized/ready/connected/verified about the source',
    async (_label, readiness) => {
      mockHookState = { status: 'paired', code: null, readiness };
      const { getByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
      // Round-2 audit C7: collect rendered text SAFELY via the row's toJSON()
      // string leaves, never via .props.children + JSON.stringify(element) —
      // React elements can carry a circular _owner Fiber under React 19.2 dev,
      // which throws "Converting circular structure to JSON" (CI's C7 red).
      // toJSON() is RTL's own serializable host-node snapshot; no element, no
      // Fiber, no cycle.
      const serialized = collectText(getByTestId('pairing-check-readiness').toJSON());
      expectNoBannedWords(serialized);
    },
  );

  it('banned-words sweep over every rendered a11y label on the readiness row, every state', async () => {
    const states: Array<{ run: 'none' | 'open' | 'terminal'; sourceDeclared: boolean; declaredPlatforms: number | null }> = [
      { run: 'none', sourceDeclared: false, declaredPlatforms: null },
      { run: 'open', sourceDeclared: false, declaredPlatforms: null },
      { run: 'open', sourceDeclared: true, declaredPlatforms: 1 },
      { run: 'open', sourceDeclared: true, declaredPlatforms: 4 },
      { run: 'terminal', sourceDeclared: true, declaredPlatforms: 2 },
    ];
    for (const readiness of states) {
      mockHookState = { status: 'paired', code: null, readiness };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let toJSON: () => unknown = null as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let unmount: () => void = null as any;
      // Flushed explicitly via act(): this panel's mount-time effects
      // (auto-mint, the copyState reset keyed on `code`) schedule a
      // post-mount update on every instance. Repeated manual
      // render()+unmount() cycles inside ONE `it` (needed to sweep every
      // readiness state without a separate `it` per state) were observed to
      // leave one iteration's pending effect unflushed into the next
      // iteration's render, corrupting that render's own tree ("overlapping
      // act() calls" from React, and a missing row despite the component
      // source rendering it unconditionally whenever readiness is set).
      // Awaiting act() around render, and again as an explicit flush before
      // moving on, settles each iteration fully before the next begins.
      await act(async () => {
        const rendered = await render(<ExtensionPairingPanel platformId="truecoach" />);
        toJSON = rendered.toJSON;
        unmount = rendered.unmount;
        await Promise.resolve();
      });
      const row = findByTestId(toJSON(), 'pairing-check-readiness');
      expect(row).not.toBeNull();
      // RN Text has no accessibilityLabel override on this row (the plain
      // string children ARE the accessible name — see the module doc
      // comment), so the a11y-relevant surface is exactly the row's own
      // string-leaf text, walked safely off the SAME toJSON() snapshot used
      // to locate it above (never JSON.stringify on a raw element/fiber —
      // the C7 fix this closes).
      expectNoBannedWords(collectText(row));
      await act(async () => {
        unmount();
        await Promise.resolve();
      });
    }
  });

  it('banned-words sweep over the FULL rendered paired card, every readiness state', async () => {
    const states: Array<{ run: 'none' | 'open' | 'terminal'; sourceDeclared: boolean; declaredPlatforms: number | null }> = [
      { run: 'none', sourceDeclared: false, declaredPlatforms: null },
      { run: 'open', sourceDeclared: false, declaredPlatforms: null },
      { run: 'open', sourceDeclared: true, declaredPlatforms: 1 },
      { run: 'open', sourceDeclared: true, declaredPlatforms: 4 },
      { run: 'terminal', sourceDeclared: true, declaredPlatforms: 2 },
    ];
    for (const readiness of states) {
      mockHookState = { status: 'paired', code: null, readiness };
      const { toJSON, unmount } = await render(<ExtensionPairingPanel platformId="truecoach" />);
      expectNoBannedSourceClaims(collectText(toJSON()));
      unmount();
    }
  });
});
