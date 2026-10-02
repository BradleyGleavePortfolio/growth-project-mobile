/**
 * WearablesShell — shell switcher + recovery-surface tests.
 *
 * Verifies:
 *   • the Fitness bucket mounts <HealthFitnessScreen/> (mocked),
 *   • switching to Recovery mounts <SleepRecoveryScreen/> (mocked) — the screen
 *     owns its own connect/empty/error states, so the shell no longer renders a
 *     placeholder surface,
 *   • the freshness chip renders from the connections hook.
 *
 * Both bucket screens, the connections hook, and navigation are mocked so the
 * test isolates the shell's own switching + routing logic.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children, style }: { children: React.ReactNode; style?: object }) =>
      ReactLocal.createElement(View, { style }, children),
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

// The bucket screens render their `aiPanelSlot` so the test can assert the
// HK-5b AI panel is mounted into each bucket (the shell pipes a
// <ClientWearableInsightPanel/> into that slot).
jest.mock('../HealthFitnessScreen', () => {
  const ReactLocal = require('react');
  const { Text, View } = require('react-native');
  return {
    __esModule: true,
    default: ({ aiPanelSlot }: { aiPanelSlot?: React.ReactNode }) =>
      ReactLocal.createElement(
        View,
        null,
        ReactLocal.createElement(Text, null, 'FITNESS_OVERVIEW'),
        aiPanelSlot,
      ),
  };
});

jest.mock('../SleepRecoveryScreen', () => {
  const ReactLocal = require('react');
  const { Text, View } = require('react-native');
  return {
    __esModule: true,
    default: ({ aiPanelSlot }: { aiPanelSlot?: React.ReactNode }) =>
      ReactLocal.createElement(
        View,
        null,
        ReactLocal.createElement(Text, null, 'RECOVERY_OVERVIEW'),
        aiPanelSlot,
      ),
  };
});

// Stub the AI panel to a bucket-tagged marker so we can assert which bucket it
// was mounted for without exercising the real React Query hook here.
jest.mock('../ClientWearableInsightPanel', () => {
  const ReactLocal = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: ({ bucket }: { bucket: string }) =>
      ReactLocal.createElement(Text, null, `AI_PANEL_${bucket}`),
  };
});

const mockUseWearableConnections = jest.fn();
const mockInvalidateWearables = jest.fn();
jest.mock('../../../../hooks/useWearableConnections', () => ({
  useWearableConnections: () => mockUseWearableConnections(),
  useInvalidateWearableConnections: () => mockInvalidateWearables,
}));

// S14: the AI panel is behind a default-off flag (D2 consent); the getter
// lets each test choose the value without re-importing the shell.
let mockAiInsightsFlag = true;
jest.mock('../../../../config/featureFlags', () => ({
  featureFlags: {
    get wearableAiInsights() {
      return mockAiInsightsFlag;
    },
  },
}));

// S14: refresh-on-open runs the on-device import seam.
const mockImportHistory = jest.fn();
let mockDeviceSource: string | null = 'APPLE_HEALTHKIT';
jest.mock('../../../../services/health/onDeviceSync', () => {
  const actual = jest.requireActual('../../../../services/health/onDeviceSync');
  return {
    OnDeviceNotSignedInError: actual.OnDeviceNotSignedInError,
    OnDeviceStepError: actual.OnDeviceStepError,
    deviceSourceForPlatform: () => mockDeviceSource,
    refreshOnDevice: (...args: unknown[]) => mockImportHistory(...args),
  };
});

const mockReportUnexpected = jest.fn();
jest.mock('../../../../lib/consultation/report', () => ({
  reportUnexpected: (...args: unknown[]) => mockReportUnexpected(...args),
}));

jest.mock('../../../../utils/logger', () => ({
  logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// Reduce-motion ON ⇒ the shell takes its documented instant-swap path, so the
// bucket switch is synchronous and the test asserts on the settled UI without
// coupling to the 200ms cross-fade animation timing.
jest.mock('../components/useReduceMotion', () => ({
  useReduceMotion: () => true,
}));

const mockNavigate = jest.fn();
const mockSetParams = jest.fn();
let mockRouteParams: { bucket?: 'fitness' | 'recovery' } = {};
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, setParams: mockSetParams }),
  useRoute: () => ({ params: mockRouteParams }),
}));

import WearablesShell from '../WearablesShell';

beforeEach(() => {
  mockAiInsightsFlag = true;
  mockDeviceSource = 'APPLE_HEALTHKIT';
  mockImportHistory.mockReset();
  mockImportHistory.mockResolvedValue({
    kind: 'imported',
    source: 'APPLE_HEALTHKIT',
    connectionId: 'c1',
    postedCount: 0,
    complete: true,
  });
  mockReportUnexpected.mockReset();
  mockInvalidateWearables.mockReset();
  mockNavigate.mockReset();
  mockSetParams.mockReset();
  mockRouteParams = {};
  mockUseWearableConnections.mockReturnValue({
    data: [
      {
        id: 'c1',
        user_id: 'u1',
        provider: 'APPLE_HEALTHKIT',
        external_account_id: null,
        access_token_expires_at: null,
        scopes: [],
        webhook_subscription_id: null,
        channel_expires_at: null,
        status: 'connected',
        last_error: null,
        // Synced just now so the chip reads `current` (post R1 P1 #3, a sync
        // older than 6h would read as the new `stale` tier).
        last_synced_at: new Date().toISOString(),
        backfilled_until: null,
        disconnected_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-06-01T00:00:00.000Z',
      },
    ],
  });
});

describe('WearablesShell', () => {
  it('mounts the Fitness overview by default and renders the freshness chip', async () => {
    await render(<WearablesShell />);
    expect(screen.getByText('FITNESS_OVERVIEW')).toBeTruthy();
    expect(screen.getByText('All sources current')).toBeTruthy();
  });

  it('switches to Recovery → mounts the Sleep & Recovery screen, never a placeholder gate', async () => {
    await render(<WearablesShell />);
    await fireEvent.press(screen.getByLabelText('Recovery'));
    expect(screen.getByText('RECOVERY_OVERVIEW')).toBeTruthy();
    expect(screen.queryByText('FITNESS_OVERVIEW')).toBeNull();
    // syncs the route param so deep-links restore the last bucket
    expect(mockSetParams).toHaveBeenCalledWith({ bucket: 'recovery' });
  });

  it('mounts the Sleep & Recovery screen directly when deep-linked to recovery', async () => {
    mockRouteParams = { bucket: 'recovery' };
    await render(<WearablesShell />);
    expect(screen.getByText('RECOVERY_OVERVIEW')).toBeTruthy();
  });

  it('mounts the client AI insight panel into each bucket', async () => {
    await render(<WearablesShell />);
    // Fitness bucket → the H&F-scoped panel is mounted.
    expect(screen.getByText('AI_PANEL_HEALTH_FITNESS')).toBeTruthy();

    // Switch to Recovery → the S&R-scoped panel is mounted.
    await fireEvent.press(screen.getByLabelText('Recovery'));
    expect(screen.getByText('AI_PANEL_SLEEP_RECOVERY')).toBeTruthy();
    expect(screen.queryByText('AI_PANEL_HEALTH_FITNESS')).toBeNull();
  });

  it('S14: does not mount the AI panel while wearableAiInsights is off', async () => {
    mockAiInsightsFlag = false;
    await render(<WearablesShell />);
    expect(screen.getByText('FITNESS_OVERVIEW')).toBeTruthy();
    expect(screen.queryByText('AI_PANEL_HEALTH_FITNESS')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Recovery'));
    expect(screen.queryByText('AI_PANEL_SLEEP_RECOVERY')).toBeNull();
  });

  it("S14: refreshes this phone's connected health store once on open", async () => {
    await render(<WearablesShell />);
    await waitFor(() => expect(mockInvalidateWearables).toHaveBeenCalledTimes(1));
    expect(mockImportHistory).toHaveBeenCalledTimes(1);
    // A-317-1: the refresh is handed the server rows so it can require the
    // SAME connection this person connected through on this phone.
    expect(mockImportHistory).toHaveBeenCalledWith('APPLE_HEALTHKIT', expect.any(Array));
  });

  it('S14 A-317-1: does not refetch when this phone was never connected by this person', async () => {
    mockImportHistory.mockResolvedValue({ kind: 'not_authorized', source: 'APPLE_HEALTHKIT' });
    await render(<WearablesShell />);
    await waitFor(() => expect(mockImportHistory).toHaveBeenCalledTimes(1));
    expect(mockInvalidateWearables).not.toHaveBeenCalled();
  });

  it('S14: does not refresh when this phone has no connected health store', async () => {
    mockDeviceSource = 'HEALTH_CONNECT';
    await render(<WearablesShell />);
    expect(screen.getByText('FITNESS_OVERVIEW')).toBeTruthy();
    expect(mockImportHistory).not.toHaveBeenCalled();
  });

  // Opus B-317-5: connected on the server but not synced by this phone (after
  // a sign-out, reinstall or second phone) is said out loud, with Reconnect.
  it('B-317-5: says the phone is not syncing and routes Reconnect to Connections', async () => {
    mockImportHistory.mockResolvedValue({ kind: 'not_authorized', source: 'APPLE_HEALTHKIT' });
    await render(<WearablesShell />);
    await waitFor(() =>
      expect(
        screen.getByText('Apple Health is not syncing on this phone. Tap Reconnect to continue.'),
      ).toBeTruthy(),
    );
    await fireEvent.press(screen.getByLabelText('Reconnect Apple Health'));
    expect(mockNavigate).toHaveBeenCalledWith('Connections');
  });

  // Sol B-317-2: an incomplete refresh is never discarded silently.
  it('B-317-2: an incomplete refresh shows what happened and Try again re-runs it', async () => {
    mockImportHistory.mockResolvedValueOnce({
      kind: 'imported',
      source: 'APPLE_HEALTHKIT',
      connectionId: 'c1',
      postedCount: 3,
      complete: false,
    });
    await render(<WearablesShell />);
    await waitFor(() =>
      expect(screen.getByText(/Some of your Apple Health data didn't come in this time/)).toBeTruthy(),
    );
    await fireEvent.press(screen.getByLabelText('Try again to sync Apple Health'));
    await waitFor(() => expect(mockImportHistory).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByText(/Some of your Apple Health data didn't come in this time/)).toBeNull(),
    );
  });

  it('an unexpected refresh failure shows a reference and support path, and is reported', async () => {
    mockImportHistory.mockRejectedValue(new Error('boom'));
    await render(<WearablesShell />);
    await waitFor(() => expect(screen.getByText(/hello@thegrowthproject.app/)).toBeTruthy());
    expect(mockReportUnexpected).toHaveBeenCalled();
    expect(screen.queryByText(/Something went wrong/)).toBeNull();
  });
});
