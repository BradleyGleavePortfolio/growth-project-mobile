/**
 * ImportDataScreen — process-restart continuity (M5-C, S6-A2 / S6-B-3).
 *
 * The pairing panel only mounts while the screen is in `awaitingExtension`,
 * and that phase lived in component state. After an OS kill mid-pairing the
 * app relaunched into `intro`, so the durable mirror written by
 * useExtensionPairing was never read: the coach re-entered the flow, a fresh
 * code was minted, and the server expired the one they may already have typed
 * into the extension. This suite renders the REAL screen + panel + hook +
 * storage module (only transport, analytics, theme and navigation are mocked)
 * with the production identity timing — `useCurrentUser()` null on first
 * render, resolved later — and proves:
 *   - a pending session puts the screen straight into the awaiting state for
 *     the platform it was minted for, the panel shows the SAME code, and
 *     /pair/init is never called (no second server-side session),
 *   - a phase the coach already moved to is never overridden by the peek,
 *   - a flag-OFF build touches no storage,
 *   - no pending session → ordinary intro.
 */
import React from 'react';
import { render, cleanup, act, fireEvent } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../../../theme/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#fff', surface: '#f5f5f5', border: '#ddd', primary: '#2c4a36',
      textPrimary: '#111', textSecondary: '#555', textMuted: '#999',
      textOnPrimary: '#fff', info: '#2b6cb0', error: '#c0392b',
      success: '#2e7d32', textTertiary: '#777',
    },
    semanticColors: {
      bgPrimary: '#fff', bgSurface: '#f5f5f5', textPrimary: '#111', textMuted: '#999',
      textOnAccent: '#fff', textOnDisabled: '#999', disabledBg: '#eee',
    },
  }),
}));
jest.mock('../../../analytics/posthog.service', () => ({ track: jest.fn() }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));
jest.mock('../../../hooks/useRosterReviewDelta', () => ({
  useRosterReviewDelta: () => ({ delta: 0, refresh: jest.fn() }),
}));
jest.mock('../../../api/extensionPairApi', () => ({
  extensionPairApi: { init: jest.fn(), status: jest.fn() },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// The kill switch is read at module scope by the screen and as the hook's
// default `enabled`; flip it per test through a getter.
let mockFlagOn = true;
jest.mock('../../../config/featureFlags', () => ({
  get featureFlags() {
    return { extensionImport: mockFlagOn, importReview: false };
  },
}));

// Production timing: the cached user is NOT available on first render.
let mockUserId: string | null = null;
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => (mockUserId ? { id: mockUserId, email: 'c@x.io' } : null),
}));

import ImportDataScreen from '../ImportDataScreen';
import { extensionPairApi } from '../../../api/extensionPairApi';
import {
  IMPORT_PAIRING_MIRROR_VERSION,
  importPairingMirrorKey,
} from '../../../storage/importPairingMirror';

const mockInit = extensionPairApi.init as jest.Mock;
const mockStatus = extensionPairApi.status as jest.Mock;

async function seedMirror(userId: string, platformId = 'trainerize', code = '482913') {
  await AsyncStorage.setItem(
    importPairingMirrorKey(userId),
    JSON.stringify({
      version: IMPORT_PAIRING_MIRROR_VERSION,
      userId,
      platformId,
      code,
      expiresAt: '2026-07-27T10:15:00.000Z',
      idempotencyKey: 'seeded-key-0001',
      setupNonce: 'seeded-nonce-0001',
    }),
  );
}

/** Let the async identity + storage reads settle without a real clock. */
async function settle() {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockFlagOn = true;
  mockUserId = null;
  mockInit.mockReset();
  mockStatus.mockReset();
  mockStatus.mockResolvedValue({ data: { status: 'pending' } });
  mockInit.mockResolvedValue({ data: { pairing_code: '000000', expires_at: 'x' } });
  jest.useFakeTimers();
});

afterEach(async () => {
  jest.clearAllTimers();
  jest.useRealTimers();
  await cleanup();
  jest.restoreAllMocks();
});

describe('ImportDataScreen — resumes a pairing session after a process restart', () => {
  it('re-enters the awaiting state for the mirrored platform and shows the SAME code, minting nothing', async () => {
    await seedMirror('coach-1', 'trainerize', '482913');

    const screen = await render(<ImportDataScreen />);
    await settle();
    // Identity unknown yet: still intro, no panel, no network.
    expect(screen.queryByTestId('import-status')).toBeNull();
    expect(mockInit).not.toHaveBeenCalled();

    mockUserId = 'coach-1';
    await screen.rerender(<ImportDataScreen />);
    await settle();
    await settle();

    expect(screen.getByTestId('import-status')).toBeTruthy();
    expect(screen.getByText(/Log in to Trainerize in your browser/)).toBeTruthy();
    expect(screen.getByTestId('pairing-waiting')).toBeTruthy();
    expect(screen.getByText('482913')).toBeTruthy();
    // Restoration is not a mint: the server-side session the coach may already
    // have typed into the extension is left alive, and /status re-validates it.
    expect(mockInit).not.toHaveBeenCalled();
    expect(mockStatus).toHaveBeenCalledWith('482913');
  });

  it('starts at intro when there is no pending session', async () => {
    mockUserId = 'coach-1';
    const screen = await render(<ImportDataScreen />);
    await settle();
    await settle();
    expect(screen.queryByTestId('import-status')).toBeNull();
    expect(mockInit).not.toHaveBeenCalled();
    expect(mockStatus).not.toHaveBeenCalled();
  });

  it('never overrides a phase the coach already moved to while the peek was in flight', async () => {
    await seedMirror('coach-1', 'trainerize', '482913');
    mockUserId = 'coach-1';
    // Make the mirror read slow so the coach's tap provably lands first.
    const realGetItem = AsyncStorage.getItem.bind(AsyncStorage);
    jest.spyOn(AsyncStorage, 'getItem').mockImplementation(async (key: string) => {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      return realGetItem(key);
    });
    const screen = await render(<ImportDataScreen />);
    // J3 source-selection presentation: highlight Custom/Other, then confirm
    // with Continue — the same two-step donor contract exercised elsewhere.
    await fireEvent.press(screen.getByLabelText('Custom / Other'));
    await fireEvent.press(screen.getByLabelText('Continue'));
    expect(screen.getByLabelText(/site address/i)).toBeTruthy();
    // Now the peek resolves with a pending record — and must not override.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1_500);
    });
    await settle();
    expect(screen.getByLabelText(/site address/i)).toBeTruthy();
    expect(screen.queryByTestId('import-status')).toBeNull();
    expect(mockStatus).not.toHaveBeenCalled();
  });

  it('reads no storage at all when the kill switch is OFF', async () => {
    mockFlagOn = false;
    await seedMirror('coach-1');
    mockUserId = 'coach-1';
    const getItem = jest.spyOn(AsyncStorage, 'getItem');
    const screen = await render(<ImportDataScreen />);
    await settle();
    await settle();
    expect(getItem).not.toHaveBeenCalled();
    expect(screen.queryByTestId('import-status')).toBeNull();
    expect(mockStatus).not.toHaveBeenCalled();
  });

  it('names the platform honestly for a custom-URL session too', async () => {
    await seedMirror('coach-1', 'custom', '135790');
    mockUserId = 'coach-1';
    const screen = await render(<ImportDataScreen />);
    await settle();
    await settle();
    expect(screen.getByText(/Log in to your platform in your browser/)).toBeTruthy();
    expect(screen.getByText('135790')).toBeTruthy();
    expect(mockInit).not.toHaveBeenCalled();
  });
});
