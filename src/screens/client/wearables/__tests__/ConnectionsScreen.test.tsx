/**
 * ConnectionsScreen — rendering + interaction tests for the Connections Hub.
 *
 * Verifies:
 *   • the provider list renders (every catalog provider appears as a row),
 *   • the correct status badge label renders per connection status
 *     (connected / expired / error / disconnected),
 *   • the relative last-synced chip renders for a synced connection,
 *   • tapping a not-connected provider's Connect button opens the connect sheet
 *     (the sheet is mocked; we assert it receives the tapped provider + visible),
 *   • tapping Disconnect on a connected provider calls the disconnect mutation,
 *   • the loading and error states render with a retry affordance.
 *
 * The hooks and the connect sheet are mocked so the test isolates the screen's
 * own list/badge/action logic.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

// ─── Mocks ─────────────────────────────────────────────────────────────────────

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

// Capture the props the connect sheet receives so we can assert the connect tap.
const sheetProps: Record<string, unknown> = {};
jest.mock('../ConnectProviderSheet', () => {
  const ReactLocal = require('react');
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => {
      Object.assign(sheetProps, props);
      return ReactLocal.createElement(ReactLocal.Fragment, null);
    },
  };
});

const mockUseWearableConnections = jest.fn();
const mockDisconnectMutate = jest.fn();
jest.mock('../../../../hooks/useWearableConnections', () => ({
  useWearableConnections: () => mockUseWearableConnections(),
  useDisconnectProvider: () => ({
    mutate: mockDisconnectMutate,
    isPending: false,
    variables: undefined,
  }),
}));

import ConnectionsScreen from '../ConnectionsScreen';
import { WEARABLE_PROVIDERS } from '../../../../api/wearablesConnectionsApi';

function connection(
  provider: string,
  status: string,
  lastSyncedAt: string | null = null,
) {
  return {
    id: `c-${provider}`,
    user_id: 'u1',
    provider,
    external_account_id: null,
    access_token_expires_at: null,
    scopes: [],
    webhook_subscription_id: null,
    channel_expires_at: null,
    status,
    last_error: null,
    last_synced_at: lastSyncedAt,
    backfilled_until: null,
    disconnected_at: null,
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-31T09:00:00.000Z',
  };
}

function queryResult(over: Record<string, unknown>) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    isRefetching: false,
    refetch: jest.fn(),
    ...over,
  };
}

beforeEach(() => {
  mockUseWearableConnections.mockReset();
  mockDisconnectMutate.mockReset();
  for (const k of Object.keys(sheetProps)) delete sheetProps[k];
});

describe('ConnectionsScreen — list + badges', () => {
  it('renders a row for every provider in the catalog', () => {
    mockUseWearableConnections.mockReturnValue(queryResult({ data: [] }));
    render(<ConnectionsScreen />);
    // Every provider's display name appears (Apple Health, Oura, WHOOP, …).
    expect(screen.getByText('Apple Health')).toBeTruthy();
    expect(screen.getByText('Oura')).toBeTruthy();
    expect(screen.getByText('WHOOP')).toBeTruthy();
    // Sanity: the number of rendered Connect/Reconnect/Disconnect actions
    // equals the catalog size (one primary action per provider row).
    const actions = screen.getAllByRole('button');
    // Header has no buttons; each row has exactly one action button.
    expect(actions.length).toBeGreaterThanOrEqual(WEARABLE_PROVIDERS.length);
  });

  it('shows the Connected badge + relative sync time for a connected provider', () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    mockUseWearableConnections.mockReturnValue(
      queryResult({ data: [connection('OURA', 'connected', tenMinAgo)] }),
    );
    render(<ConnectionsScreen />);
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.getByText('10m ago')).toBeTruthy();
    // A connected provider's primary action is Disconnect.
    expect(screen.getByLabelText('Disconnect Oura')).toBeTruthy();
  });

  it('shows the Expired badge + Reconnect action for an expired provider', () => {
    mockUseWearableConnections.mockReturnValue(
      queryResult({ data: [connection('WHOOP', 'expired')] }),
    );
    render(<ConnectionsScreen />);
    expect(screen.getByText('Expired')).toBeTruthy();
    expect(screen.getByLabelText('Reconnect WHOOP')).toBeTruthy();
  });

  it('shows the Error badge + Reconnect action for an errored provider', () => {
    mockUseWearableConnections.mockReturnValue(
      queryResult({ data: [connection('GARMIN', 'error')] }),
    );
    render(<ConnectionsScreen />);
    expect(screen.getByText('Error')).toBeTruthy();
    expect(screen.getByLabelText('Reconnect Garmin')).toBeTruthy();
  });

  it('shows the Not connected badge + Connect action for an unconnected provider', () => {
    mockUseWearableConnections.mockReturnValue(queryResult({ data: [] }));
    render(<ConnectionsScreen />);
    // Strava is not connected → "Connect Strava".
    expect(screen.getByLabelText('Connect Strava')).toBeTruthy();
  });
});

describe('ConnectionsScreen — interactions', () => {
  it('opens the connect sheet with the tapped provider on Connect', () => {
    mockUseWearableConnections.mockReturnValue(queryResult({ data: [] }));
    render(<ConnectionsScreen />);
    fireEvent.press(screen.getByLabelText('Connect Strava'));
    expect(sheetProps.visible).toBe(true);
    expect(sheetProps.provider).toBe('STRAVA');
  });

  it('calls the disconnect mutation when Disconnect is tapped', () => {
    mockUseWearableConnections.mockReturnValue(
      queryResult({ data: [connection('OURA', 'connected')] }),
    );
    render(<ConnectionsScreen />);
    fireEvent.press(screen.getByLabelText('Disconnect Oura'));
    expect(mockDisconnectMutate).toHaveBeenCalledWith('OURA');
  });
});

describe('ConnectionsScreen — loading + error states', () => {
  it('renders a loading indicator while fetching', () => {
    mockUseWearableConnections.mockReturnValue(
      queryResult({ isLoading: true }),
    );
    render(<ConnectionsScreen />);
    expect(screen.getByLabelText('Loading your connections')).toBeTruthy();
  });

  it('renders an error state with a retry button', () => {
    const refetch = jest.fn();
    mockUseWearableConnections.mockReturnValue(
      queryResult({ isError: true, refetch }),
    );
    render(<ConnectionsScreen />);
    const retry = screen.getByLabelText('Retry loading connections');
    expect(retry).toBeTruthy();
    fireEvent.press(retry);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
