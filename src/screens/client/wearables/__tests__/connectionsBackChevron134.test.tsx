/**
 * CLIENT-POLISH-134 (agent 134, B13 B16): Connected devices gets the shared
 * back chevron (the More stack hides the native header; operator 18:33 "chevrons
 * yes") and its status dot takes radius.chip (U-594-1), at 360 x 800 and 390 x 844.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContext } from '@react-navigation/native';

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
import { layout, radius } from '../../../../theme/tokens';

const DEVICES = [
  { name: 'Android 360x800', frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, bottom: 24, left: 0, right: 0 } },
  { name: 'iPhone 390x844', frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 } },
] as const;

const oura = {
  id: 'c-OURA', user_id: 'u1', provider: 'OURA', external_account_id: null, access_token_expires_at: null,
  scopes: [], webhook_subscription_id: null, channel_expires_at: null, status: 'connected', last_error: null,
  last_synced_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(), backfilled_until: null, disconnected_at: null,
  created_at: '2026-05-01T00:00:00.000Z', updated_at: '2026-05-31T09:00:00.000Z',
};
const result = (over: Record<string, unknown>) => ({
  data: undefined, isLoading: false, isError: false, error: null, isRefetching: false, refetch: jest.fn(), ...over,
});

describe.each(DEVICES)('Connected devices back chevron at $name', ({ frame, insets }) => {
  const goBack = jest.fn();
  const nav = { canGoBack: () => true, goBack } as unknown as React.ContextType<typeof NavigationContext>;
  const mount = (withNav: boolean) =>
    render(
      <SafeAreaProvider initialMetrics={{ frame, insets }}>
        {withNav ? <NavigationContext.Provider value={nav}><ConnectionsScreen /></NavigationContext.Provider> : <ConnectionsScreen />}
      </SafeAreaProvider>,
    );

  beforeEach(() => goBack.mockClear());

  it('shows Back above the title, under the same Screen top, and goes back', async () => {
    mockConnections.mockReturnValue(result({ data: [oura] }));
    await mount(true);
    expect(StyleSheet.flatten(screen.getByTestId('connections').props.style).paddingTop).toBe(insets.top + layout.statusBarGap);
    await fireEvent.press(screen.getByTestId('connections-top-back'));
    expect(goBack).toHaveBeenCalledTimes(1);
    // Rows keep their one action each; Back is the only addition.
    expect(screen.getAllByRole('button').map((b) => b.props.accessibilityLabel).sort()).toEqual([
      'Back', 'Connect Apple Health', 'Disconnect Oura',
    ]);
  });

  it('keeps Back on the loading and error states', async () => {
    mockConnections.mockReturnValue(result({ isLoading: true }));
    const view = await mount(true);
    expect(screen.getByTestId('connections-top-back')).toBeTruthy();
    mockConnections.mockReturnValue(result({ isError: true, error: new Error('x') }));
    await view.rerender(
      <SafeAreaProvider initialMetrics={{ frame, insets }}>
        <NavigationContext.Provider value={nav}><ConnectionsScreen /></NavigationContext.Provider>
      </SafeAreaProvider>,
    );
    expect(screen.getByTestId('connections-error')).toBeTruthy();
    expect(screen.getByTestId('connections-top-back')).toBeTruthy();
  });

  it('shows no Back outside a stack, and the status dot is round (radius.chip)', async () => {
    mockConnections.mockReturnValue(result({ data: [oura] }));
    await mount(false);
    expect(screen.queryByTestId('connections-top-back')).toBeNull();
    const dots: Array<number | string | undefined> = [];
    const walk = (n: unknown): void => {
      if (n == null || typeof n !== 'object') return;
      if (Array.isArray(n)) return n.forEach(walk);
      const node = n as { props?: { style?: unknown }; children?: unknown };
      const s = StyleSheet.flatten(node.props?.style as never) as { width?: number; height?: number; borderRadius?: number } | undefined;
      if (s?.width === 6 && s?.height === 6) dots.push(s.borderRadius);
      walk(node.children);
    };
    walk(screen.toJSON());
    expect(dots).toEqual([radius.chip]);
  });
});
