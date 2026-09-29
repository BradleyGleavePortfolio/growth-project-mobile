/**
 * R300-A3-B2 — the paired host tree, end to end: `ImportRunStatusJourney`
 * mounted through its REAL parent `ExtensionPairingPanel` (status
 * `paired`), not in isolation. R300-A3's review explicitly flagged that the
 * r3 Jest helper "renders `ImportRunStatusJourney` alone, omitting its
 * actual `pairing-paired` parent", which still carried its own
 * `accessibilityLiveRegion="polite"` around the child. This suite proves,
 * against the REAL composed tree:
 *   - no ancestor node anywhere in the tree carries a `polite` live region
 *     around the changing import status card,
 *   - exactly one accessible announcement path exists (the imperative
 *     `AccessibilityInfo.announceForAccessibility` call), fired on BOTH
 *     platforms, not a live region.
 *
 * Only the hooks below `ExtensionPairingPanel` are mocked (pairing status,
 * current user, navigation, analytics, the run-status read) — the panel and
 * the journey both render their REAL implementation.
 */
import React from 'react';
import { Platform, AccessibilityInfo } from 'react-native';
import { render, cleanup } from '@testing-library/react-native';

// Both ExtensionPairingPanel (`colors`) and ImportStatusFrame/importJourneyUI
// (`semanticColors`) import this SAME module — the mock must satisfy both
// shapes at once, since this suite mounts both real implementations.
jest.mock('../../../theme/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#fff', surface: '#f5f5f5', border: '#ddd', primary: '#2c4a36',
      textPrimary: '#111', textSecondary: '#555', textMuted: '#999',
      textOnPrimary: '#fff', info: '#2b6cb0', error: '#c0392b',
    },
    semanticColors: {
      bgPrimary: '#fff', bgSurface: '#f5f5f5', border: '#ddd',
      textPrimary: '#111', textMuted: '#999', textOnAccent: '#fff', textOnDisabled: '#999', disabledBg: '#eee',
    },
  }),
}));

let mockHookState: { status: string; code: string | null; importIntentId?: string | null };
jest.mock('../../../hooks/useExtensionPairing', () => {
  const actual = jest.requireActual('../../../hooks/useExtensionPairing');
  return {
    PAIRING_REASON_COPY: actual.PAIRING_REASON_COPY,
    useExtensionPairing: () => ({ ...mockHookState, start: jest.fn(), retry: jest.fn(), cancel: jest.fn() }),
  };
});
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'coach-1', email: 'coach@example.com' }),
}));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }) }));
jest.mock('../../../analytics/posthog.service', () => ({ track: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

let mockRunState: Record<string, unknown>;
const mockRefresh = jest.fn();
jest.mock('../../../hooks/useImportRunStatus', () => ({
  useImportRunStatus: () => ({ stale: false, readAt: null, isRefreshing: false, refresh: mockRefresh, ...mockRunState }),
  useImportedRoster: () => ({ view: 'disabled' }),
}));

const flags: { romanChat: boolean; importReview: boolean } = { romanChat: false, importReview: false };
jest.mock('../../../config/featureFlags', () => ({
  get featureFlags() {
    return flags;
  },
}));

import ExtensionPairingPanel from '../ExtensionPairingPanel';

let announceSpy: jest.SpyInstance;
beforeEach(() => {
  flags.romanChat = false;
  flags.importReview = false;
  mockRefresh.mockClear();
  announceSpy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
});
afterEach(() => {
  announceSpy.mockRestore();
  cleanup();
});

/** Walks RTL's `toJSON()` host-node tree collecting every prop bag. */
function collectProps(node: unknown, out: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const child of node) collectProps(child, out);
    return out;
  }
  const n = node as { props?: Record<string, unknown>; children?: unknown };
  if (n.props) out.push(n.props);
  if (n.children) collectProps(n.children, out);
  return out;
}

describe('ImportRunStatusJourney mounted through its real paired host (ExtensionPairingPanel)', () => {
  it('no node anywhere in the composed tree carries a polite live region — the paired card ancestor no longer sets one around the import status child', async () => {
    mockHookState = { status: 'paired', code: null, importIntentId: 'intent-42' };
    mockRunState = { view: 'reading', reading: { intentId: 'intent-42', status: 'complete', mode: 'server', phase: null, reasonCode: null, claimedStatus: null, completedAt: null, startedAt: null }, stale: false };
    const v = await render(<ExtensionPairingPanel platformId="truecoach" />);
    const props = collectProps(v.toJSON());
    const liveRegions = props.filter((p) => p.accessibilityLiveRegion === 'polite');
    expect(liveRegions).toHaveLength(0);
    expect(v.getByTestId('pairing-paired').props.accessibilityLiveRegion).toBeUndefined();
  });

  it('the import status announces its own material change via AccessibilityInfo.announceForAccessibility, exactly once, when mounted in the real host', async () => {
    mockHookState = { status: 'paired', code: null, importIntentId: 'intent-42' };
    mockRunState = { view: 'reading', reading: { intentId: 'intent-42', status: 'complete', mode: 'server', phase: null, reasonCode: null, claimedStatus: null, completedAt: null, startedAt: null }, stale: false, readAt: 1700000000000 };
    const v = await render(<ExtensionPairingPanel platformId="truecoach" />);
    expect(v.getByText('Import complete')).toBeTruthy();
    announceSpy.mockClear();
    mockRunState = { ...mockRunState, stale: true };
    await v.rerender(<ExtensionPairingPanel platformId="truecoach" />);
    expect(v.getByText(/Couldn.t refresh\. Showing what the server said/)).toBeTruthy();
    expect(announceSpy).toHaveBeenCalledTimes(1);
    expect(announceSpy.mock.calls[0][0]).not.toMatch(/\bstale\b/);
  });

  it('fires the announcement API regardless of platform (both iOS and Android take the imperative path, never a live region)', async () => {
    const original = Platform.OS;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Platform as any).OS = 'android';
    mockHookState = { status: 'paired', code: null, importIntentId: 'intent-42' };
    mockRunState = { view: 'reading', reading: { intentId: 'intent-42', status: 'running', mode: 'server', phase: 'discovering', reasonCode: null, claimedStatus: null, completedAt: null, startedAt: null }, stale: false };
    const v = await render(<ExtensionPairingPanel platformId="truecoach" />);
    announceSpy.mockClear();
    mockRunState = { ...mockRunState, reading: { ...(mockRunState.reading as object), phase: 'transferring' } };
    await v.rerender(<ExtensionPairingPanel platformId="truecoach" />);
    expect(announceSpy).toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Platform as any).OS = original;
  });
});
