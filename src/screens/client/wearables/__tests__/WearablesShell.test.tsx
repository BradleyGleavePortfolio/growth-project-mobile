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
import { fireEvent, render, screen } from '@testing-library/react-native';

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
jest.mock('../../../../hooks/useWearableConnections', () => ({
  useWearableConnections: () => mockUseWearableConnections(),
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
});
