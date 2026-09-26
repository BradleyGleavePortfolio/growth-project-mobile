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
import { render, fireEvent, cleanup } from '@testing-library/react-native';

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
    expect(getByTestId('pairing-reason-message')).toHaveTextContent(/could not check the pairing status/i);
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

  it('announces each state via a polite live region', async () => {
    mockHookState = { status: 'paired', code: null };
    const { getByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(getByTestId('pairing-paired').props.accessibilityLiveRegion).toBe('polite');
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
 * S11-C (D-S11-5, UX-03/04) readiness row — ExtensionPairingPanel.
 *
 * The panel renders a neutral readiness row inside the `paired` checklist
 * ONLY when useExtensionPairing's `readiness` is a known reading; absence
 * renders NOTHING (never a "no"/zero row). These tests pin the row's
 * presence/absence per state and the exact honesty-compliant copy, plus a
 * banned-words sweep across every readiness string this module can render.
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
      const text = getByTestId('pairing-check-readiness').props.children ?? '';
      const serialized = JSON.stringify(text);
      expect(serialized).not.toMatch(/\bauthorized\b/i);
      expect(serialized).not.toMatch(/\bready\b/i);
      expect(serialized).not.toMatch(/\bconnected\b/i);
      expect(serialized).not.toMatch(/\bverified\b/i);
    },
  );

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
      const serialized = JSON.stringify(toJSON());
      expect(serialized).not.toMatch(/source (is )?authorized/i);
      expect(serialized).not.toMatch(/source (is )?ready/i);
      expect(serialized).not.toMatch(/source (is )?connected/i);
      expect(serialized).not.toMatch(/source (is )?verified/i);
      unmount();
    }
  });
});
