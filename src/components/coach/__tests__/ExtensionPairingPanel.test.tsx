/**
 * ExtensionPairingPanel — behavioral tests (v0.3 import, PR-M2).
 *
 * The useExtensionPairing hook is mocked so we can drive each lifecycle state
 * deterministically and assert the panel's honest rendering:
 *   - auto-mints exactly once on mount (single-flight guard is the hook's job),
 *   - minting spinner, waiting (code + cancel — no client-clock countdown),
 *     paired (NO progress or completion claim), and the shared recoverable
 *     /attention layout,
 *   - the paired copy never claims import progress/percentage/entity counts,
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
};
jest.mock('../../../hooks/useExtensionPairing', () => ({
  useExtensionPairing: () => ({
    ...mockHookState,
    start: mockStart,
    retry: mockRetry,
    cancel: mockCancel,
  }),
}));

// PR-M3: the roster-derived review delta is mocked so we can drive the paired
// review copy deterministically; the hook's own behaviour is covered in
// useRosterReviewDelta.test.tsx.
let mockDelta = 0;
const mockRefresh = jest.fn();
jest.mock('../../../hooks/useRosterReviewDelta', () => ({
  useRosterReviewDelta: () => ({ delta: mockDelta, refresh: mockRefresh }),
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
  mockRefresh.mockClear();
  mockNavigate.mockClear();
  mockTrack.mockClear();
  mockDelta = 0;
  mockHookState = { status: 'idle', code: null };
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

  it('shows an HONEST paired state — no progress, percentage, or entity counts', async () => {
    mockHookState = { status: 'paired', code: null };
    const { getByTestId, toJSON } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(getByTestId('pairing-paired')).toBeTruthy();
    const serialized = JSON.stringify(toJSON());
    expect(serialized).toMatch(/runs in the browser extension/i);
    expect(serialized).not.toMatch(/\b\d{1,3}%/);
    expect(serialized).not.toMatch(/imported successfully|import complete|\b\d+ (records|entities|pages)\b/i);
  });

  it('renders the roster-derived delta copy (3→5 = 2) in the paired review', async () => {
    mockDelta = 2;
    mockHookState = { status: 'paired', code: null };
    const { getByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(getByTestId('pairing-review-delta')).toHaveTextContent(
      '2 new clients since you started this import',
    );
  });

  it('uses the singular form when exactly one new client has arrived', async () => {
    mockDelta = 1;
    mockHookState = { status: 'paired', code: null };
    const { getByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(getByTestId('pairing-review-delta')).toHaveTextContent(
      '1 new client since you started this import',
    );
  });

  it('renders a calm still-running copy when no new clients yet (3→3 = 0) — never claims completion', async () => {
    mockDelta = 0;
    mockHookState = { status: 'paired', code: null };
    const { getByTestId, toJSON } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(getByTestId('pairing-review-delta')).toHaveTextContent(
      'No new clients have arrived yet. Your import is still running in the browser extension.',
    );
    const serialized = JSON.stringify(toJSON());
    expect(serialized).not.toMatch(/imported successfully|import complete|completed|\bsuccess\b|\b\d{1,3}%/i);
  });

  it('exposes a typed, reachable CTA to the existing ClientsList and fires review analytics', async () => {
    mockDelta = 2;
    mockHookState = { status: 'paired', code: null };
    const { getByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    fireEvent.press(getByTestId('pairing-review-cta'));
    expect(mockNavigate).toHaveBeenCalledWith('ClientsStack', { screen: 'ClientsList' });
    expect(mockTrack).toHaveBeenCalledWith(AnalyticsEvents.IMPORT_REVIEW_OPENED, {
      platform: 'truecoach',
    });
  });

  it('review analytics payload carries ONLY the platform slug — no counts, IDs, or PII', async () => {
    mockDelta = 4;
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

  it('titles the paired card honestly as "Paired" (not "Complete"/"Imported")', async () => {
    mockHookState = { status: 'paired', code: null };
    const { toJSON } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    const serialized = JSON.stringify(toJSON());
    expect(serialized).toMatch(/Paired/);
    expect(serialized).not.toMatch(/complete|imported|finished|done/i);
  });

  it('gives the cancel control a button role and label', async () => {
    mockHookState = { status: 'waiting', code: '482913' };
    const { getByTestId } = await render(<ExtensionPairingPanel platformId="truecoach" />);
    const cancel = getByTestId('pairing-cancel');
    expect(cancel.props.accessibilityRole).toBe('button');
    expect(cancel.props.accessibilityLabel).toMatch(/cancel/i);
  });
});
