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

jest.mock('../HealthFitnessScreen', () => {
  const ReactLocal = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => ReactLocal.createElement(Text, null, 'FITNESS_OVERVIEW'),
  };
});

jest.mock('../SleepRecoveryScreen', () => {
  const ReactLocal = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => ReactLocal.createElement(Text, null, 'RECOVERY_OVERVIEW'),
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
  it('mounts the Fitness overview by default and renders the freshness chip', () => {
    render(<WearablesShell />);
    expect(screen.getByText('FITNESS_OVERVIEW')).toBeTruthy();
    expect(screen.getByText('All sources current')).toBeTruthy();
  });

  it('switches to Recovery → mounts the Sleep & Recovery screen, never a placeholder gate', () => {
    render(<WearablesShell />);
    fireEvent.press(screen.getByLabelText('Recovery'));
    expect(screen.getByText('RECOVERY_OVERVIEW')).toBeTruthy();
    expect(screen.queryByText('FITNESS_OVERVIEW')).toBeNull();
    // syncs the route param so deep-links restore the last bucket
    expect(mockSetParams).toHaveBeenCalledWith({ bucket: 'recovery' });
  });

  it('mounts the Sleep & Recovery screen directly when deep-linked to recovery', () => {
    mockRouteParams = { bucket: 'recovery' };
    render(<WearablesShell />);
    expect(screen.getByText('RECOVERY_OVERVIEW')).toBeTruthy();
  });
});
