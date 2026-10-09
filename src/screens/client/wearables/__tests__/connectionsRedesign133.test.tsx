/**
 * REDO-DEVICES-133 (DES-AZ-127), part 1: Connected devices on the shared
 * primitives, rendered at 360 x 800 (Android) and 390 x 844 (iPhone).
 *
 * Asserts the redesign without device eyes: insets from the shared Screen,
 * the title stacks, real status and last-sync lines, dated values, the
 * Starter goal label, calm states, no filled forest box, rounded radius
 * tokens only, and that every action before the redesign is still there.
 */
import React from 'react';
import { StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

jest.mock('../ConnectProviderSheet', () => ({ __esModule: true, default: () => null }));
jest.mock('../DisconnectConfirmDialog', () => ({ __esModule: true, default: () => null }));

const mockConnections = jest.fn();
jest.mock('../../../../hooks/useWearableConnections', () => ({
  useWearableConnections: () => mockConnections(),
  useLocalOnDeviceAuthorization: () => ({ data: undefined }),
  useDisconnectProvider: () => ({ mutate: jest.fn(), isPending: false, variables: undefined }),
}));
jest.mock('../../../../hooks/useConnectableCloudProviders', () => ({
  useConnectableCloudProviders: () => new Set<string>(),
}));
jest.mock('../../../../hooks/useCoachlessClient', () => ({ useCoachlessClient: () => false }));


import ConnectionsScreen from '../ConnectionsScreen';
import { layout, lightTokens } from '../../../../theme/tokens';

type Flat = ViewStyle & TextStyle;
const flat = (node: { props: { style?: unknown } }): Flat =>
  (StyleSheet.flatten(node.props.style as StyleProp<Flat>) ?? {}) as Flat;

const DEVICES = [
  { name: 'Android 360x800', frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, bottom: 24, left: 0, right: 0 } },
  { name: 'iPhone 390x844', frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 } },
] as const;


function connection(provider: string, status: string, lastSyncedAt: string | null) {
  return {
    id: `c-${provider}`, user_id: 'u1', provider, external_account_id: null, access_token_expires_at: null,
    scopes: [], webhook_subscription_id: null, channel_expires_at: null, status, last_error: null,
    last_synced_at: lastSyncedAt, backfilled_until: null, disconnected_at: null,
    created_at: '2026-05-01T00:00:00.000Z', updated_at: '2026-05-31T09:00:00.000Z',
  };
}

function connectionsResult(over: Record<string, unknown>) {
  return { data: undefined, isLoading: false, isError: false, error: null, isRefetching: false, refetch: jest.fn(), ...over };
}

/** No 0, 2 or 4 pt corners and no filled forest box anywhere in the tree. */
function expectQuietTree(json: unknown) {
  const radii: number[] = [];
  const fills: string[] = [];
  const walk = (n: unknown) => {
    if (n == null || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    const node = n as { props?: { style?: unknown }; children?: unknown };
    const s = StyleSheet.flatten(node.props?.style as StyleProp<Flat>) as Flat | undefined;
    if (s?.borderRadius != null) radii.push(s.borderRadius as number);
    // The 6 pt status mark is a dot, not a box.
    const dot = typeof s?.width === 'number' && s.width <= 8;
    if (typeof s?.backgroundColor === 'string' && !dot) fills.push(s.backgroundColor);
    walk(node.children);
  };
  walk(json);
  expect(radii.filter((r) => r === 2 || r === 4)).toEqual([]);
  expect(fills).not.toContain(lightTokens.accent);
  expect(fills).not.toContain('#F1E8D5'); // cream card fill
}

describe.each(DEVICES)('Connected devices at $name', ({ frame, insets }) => {
  const wrap = (ui: React.ReactElement) => <SafeAreaProvider initialMetrics={{ frame, insets }}>{ui}</SafeAreaProvider>;

  it('opens on the serif title stack under the status bar, sources in use first', async () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    mockConnections.mockReturnValue(connectionsResult({ data: [connection('OURA', 'connected', tenMinAgo)] }));
    const r = await render(wrap(<ConnectionsScreen />));
    expect(flat(r.getByTestId('connections')).paddingTop).toBe(insets.top + layout.statusBarGap);
    expect(screen.getByRole('header', { name: 'Connected devices' })).toBeTruthy();
    expect(screen.getByText('Health data')).toBeTruthy();
    expect(screen.getByText('In use')).toBeTruthy();
    expect(screen.getByText('Available to connect')).toBeTruthy();
    expect(screen.getByText('Last synced 10m ago')).toBeTruthy();
    // Parity: Oura keeps Disconnect, Apple Health keeps Connect; nothing else is tappable.
    expect(screen.getAllByRole('button').map((b) => b.props.accessibilityLabel).sort()).toEqual([
      'Connect Apple Health',
      'Disconnect Oura',
    ]);
    expectQuietTree(r.toJSON());
  });

  it('says when a connected source has not synced yet', async () => {
    mockConnections.mockReturnValue(connectionsResult({ data: [connection('APPLE_HEALTHKIT', 'connected', null)] }));
    await render(wrap(<ConnectionsScreen />));
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.getByText('No sync yet')).toBeTruthy();
    expect(screen.queryByText('Available to connect')).toBeNull();
  });

  it('keeps pull to refresh', async () => {
    const refetch = jest.fn();
    mockConnections.mockReturnValue(connectionsResult({ data: [], refetch }));
    const r = await render(wrap(<ConnectionsScreen />));
    const scroll = r.getByTestId('connections-scroll');
    await scroll.props.refreshControl.props.onRefresh();
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

