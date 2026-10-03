/**
 * B-314-4: member wins (More > Community) are live while the Community tab is
 * flag-gated OFF, so Community safety must be reachable from the wins screen
 * without the tab.
 *
 * 1. A real React Navigation stack (NavigationContainer + native stack) with
 *    the production MoreStack route names and the real screens, communityTab
 *    OFF: wins -> Community safety (safety contact shown), block a member from
 *    a win -> they are on the blocked list -> Unblock -> back on wins the feed
 *    is refetched and their win is back.
 * 2. The production MoreStack registers CommunitySafety unconditionally (not
 *    inside any featureFlags gate), so the route above exists in the app.
 */
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { Alert, type AlertButton } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

jest.mock('../../config/featureFlags', () => {
  const actual = jest.requireActual('../../config/featureFlags');
  return { ...actual, featureFlags: { ...actual.featureFlags, communityTab: false } };
});
jest.mock('../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));
jest.mock('../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  const { View } = require('react-native');
  return { ...actual, SafeAreaView: View };
});
jest.mock('../../components/HapticPressable', () => {
  const React = require('react');
  const { Pressable } = require('react-native');
  return {
    __esModule: true,
    default: ({
      children,
      onPress,
      testID,
    }: {
      children: React.ReactNode;
      onPress?: () => void;
      testID?: string;
    }) => React.createElement(Pressable, { onPress, testID }, children),
  };
});
jest.mock('../../components/community', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { ThreadHeader: ({ title }: { title: string }) => React.createElement(Text, null, title) };
});
jest.mock('../../components/SkeletonLoader', () => ({ SkeletonCard: () => null }));
jest.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'u-me', coach_id: 'u-coach' }),
}));
jest.mock('../../services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));

const mockGetFeed = jest.fn();
jest.mock('../../api/communityWinsApi', () => ({
  communityWinsApi: {
    getFeed: (...a: unknown[]) => mockGetFeed(...a),
    postWin: jest.fn(),
    deleteWin: jest.fn(),
  },
}));

const mockBlocked = new Set<string>();
const mockBlock = jest.fn(async (id: string) => {
  mockBlocked.add(id);
});
const mockUnblock = jest.fn(async (id: string) => {
  mockBlocked.delete(id);
});
jest.mock('../../api/communitySafetyApi', () => {
  const actual = jest.requireActual('../../api/communitySafetyApi');
  return {
    ...actual,
    communitySafetyApi: {
      report: jest.fn(),
      block: (id: string) => mockBlock(id),
      unblock: (id: string) => mockUnblock(id),
      listBlocks: async () =>
        mockBlocked.has('u-alice')
          ? [{ user_id: 'u-alice', name: 'Alice', blocked_at: '2026-10-02T00:00:00Z' }]
          : [],
      getSafetyInfo: async () => ({
        contact_email: 'safety@example.test',
        report_reasons: [],
        guidelines: ['Be kind.'],
        response_commitment: 'Reports are reviewed within 24 hours.',
      }),
      listNotices: async () => ({ notices: [], unread_count: 0 }),
      markNoticeRead: jest.fn(),
    },
  };
});

import CommunityScreen from '../../screens/client/CommunityScreen';
import CommunitySafetyScreen from '../../screens/community/CommunitySafetyScreen';
import { SUPPORT_EMAIL } from '../../constants/support';
import type { MoreStackParamList } from '../ClientNavigator';

const ALICE_WIN = {
  id: 'win-other',
  userId: 'u-alice',
  displayName: 'Alice',
  title: 'Deadlift PR',
  description: '100 kg',
  createdAt: new Date(Date.now() - 3_600_000).toISOString(),
  isMine: false,
};

const Stack = createNativeStackNavigator<MoreStackParamList>();

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  mockBlocked.clear();
  mockBlock.mockClear();
  mockUnblock.mockClear();
  // Blocking hides the blocked member's wins (two-way, server side).
  mockGetFeed.mockReset().mockImplementation(async () => (mockBlocked.has('u-alice') ? [] : [ALICE_WIN]));
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => alertSpy.mockRestore());

function pressAlertButton(text: string) {
  const call = alertSpy.mock.calls[alertSpy.mock.calls.length - 1];
  const buttons = (call[2] ?? []) as AlertButton[];
  const b = buttons.find((x) => x.text === text);
  if (!b?.onPress) throw new Error(`no alert button ${text}`);
  return b.onPress();
}

describe('Community safety from More > Community with the Community tab OFF (B-314-4)', () => {
  it('wins -> safety contact, block -> blocked list -> unblock -> feed restored', async () => {
    const { featureFlags } = jest.requireMock('../../config/featureFlags');
    expect(featureFlags.communityTab).toBe(false);

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const screen = await render(
      <QueryClientProvider client={qc}>
        <NavigationContainer>
          <Stack.Navigator initialRouteName="Community" screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Community" component={CommunityScreen} />
            <Stack.Screen name="CommunitySafety" component={CommunitySafetyScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </QueryClientProvider>,
    );

    // Block Alice from her win: her win leaves the feed.
    expect(await screen.findByText('Deadlift PR')).toBeTruthy();
    await fireEvent.press(await screen.findByTestId('win-menu-win-other'));
    await fireEvent.press(screen.getByTestId('win-menu-win-other-block'));
    await act(async () => {
      await pressAlertButton('Block');
    });
    expect(mockBlock).toHaveBeenCalledWith('u-alice');
    await waitFor(() => expect(screen.queryByText('Deadlift PR')).toBeNull());

    // Open Community safety from the wins screen.
    await fireEvent.press(screen.getByTestId('wins-open-safety'));
    expect(await screen.findByTestId('community-safety-screen')).toBeTruthy();
    // The app's one support email is shown, never the server-sent address (B-314-11).
    expect(await screen.findByText('Be kind.')).toBeTruthy();
    expect(screen.getByText(SUPPORT_EMAIL)).toBeTruthy();
    expect(screen.queryByText('safety@example.test')).toBeNull();
    expect(await screen.findByTestId('community-safety-block-u-alice')).toBeTruthy();

    // Unblock Alice.
    await fireEvent.press(screen.getByTestId('community-safety-unblock-u-alice'));
    await act(async () => {
      await pressAlertButton('Unblock');
    });
    expect(mockUnblock).toHaveBeenCalledWith('u-alice');
    await waitFor(() => expect(screen.queryByTestId('community-safety-block-u-alice')).toBeNull());

    // Back to wins: the feed was refetched and Alice's win is back.
    await fireEvent.press(screen.getByTestId('community-safety-back'));
    expect(await screen.findByText('Deadlift PR')).toBeTruthy();
  });
});

describe('production MoreStack registration', () => {
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'ClientNavigator.tsx'), 'utf8');

  it('registers CommunitySafety in the More stack outside any feature-flag gate', () => {
    const line = SRC.split('\n').find((l) => /MoreStackNav\.Screen name="CommunitySafety"/.test(l));
    expect(line).toBeDefined();
    expect(line).toContain('component={CommunitySafetyScreen}');
    expect(line?.trim().startsWith('<MoreStackNav.Screen')).toBe(true);
    // Not wrapped in a `{featureFlags.x && (` or ternary on the lines just above.
    const idx = SRC.indexOf('name="CommunitySafety" component={CommunitySafetyScreen}');
    const before = SRC.slice(Math.max(0, idx - 200), idx);
    expect(before).not.toMatch(/featureFlags\.[A-Za-z]+\s*(&&|\?)\s*\(?\s*$/);
  });

  it('declares the route in MoreStackParamList', () => {
    expect(SRC).toMatch(/export type MoreStackParamList = \{[\s\S]*?CommunitySafety: undefined;/);
  });
});
