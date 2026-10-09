// CLIENT-POLISH-134 (agent 134, B13 B28): Leaderboard and Leaderboard settings
// take their top from the shared Screen (react-native-safe-area-context
// insets + 12 pt), not their own inset hook, on both phones the Q5 bar names.
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { layout } from '../theme/tokens';
import { getLeaderboard, type LeaderboardResponse } from '../services/leaderboardApi';
import LeaderboardScreen from '../screens/client/LeaderboardScreen';
import LeaderboardSettingsScreen from '../screens/client/LeaderboardSettingsScreen';

jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: jest.requireActual('../theme/tokens').lightTokens }),
}));
const mockUser: { current: { id: string; coach_id?: string } } = { current: { id: 'self', coach_id: 'coach' } };
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser.current }));
jest.mock('../services/leaderboardApi', () => ({ getLeaderboard: jest.fn(), setLeaderboardOptIn: jest.fn() }));
jest.mock('@react-navigation/native', () => ({
  NavigationContext: jest.requireActual('react').createContext({
    navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true, addListener: () => () => {},
  }),
}));

const DEVICES = [
  { name: 'Android 360x800', frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, bottom: 16, left: 0, right: 0 } },
  { name: 'iPhone 390x844', frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 } },
];

function board(): LeaderboardResponse {
  return {
    entries: [{ rank: 1, userId: 'self', displayName: 'Dana', combinedScore: 72, weekDelta: null, isRequester: true }],
    selfRank: 1,
    viewer: { is_opted_in: true, rank: 1, score: 72 },
  };
}

function mount(node: React.ReactElement, device: (typeof DEVICES)[number]) {
  return render(<SafeAreaProvider initialMetrics={{ frame: device.frame, insets: device.insets }}>{node}</SafeAreaProvider>);
}

const topOf = (testID: string) => StyleSheet.flatten(screen.getByTestId(testID).props.style).paddingTop;

describe.each(DEVICES)('leaderboard insets on $name', (device) => {
  beforeEach(() => {
    mockUser.current = { id: 'self', coach_id: 'coach' };
    jest.mocked(getLeaderboard).mockResolvedValue(board());
  });

  it('the board sits insets.top + 12 under the status bar, Back and Settings kept', async () => {
    await mount(<LeaderboardScreen />, device);
    expect(await screen.findByTestId('leaderboard-self-hero')).toBeTruthy();
    expect(topOf('leaderboard-screen')).toBe(device.insets.top + layout.statusBarGap);
    expect(screen.getByTestId('leaderboard-back')).toBeTruthy();
    expect(screen.getByTestId('leaderboard-settings-link')).toBeTruthy();
  });

  it('the coachless shell uses the same Screen top', async () => {
    mockUser.current = { id: 'self' };
    await mount(<LeaderboardScreen />, device);
    expect(screen.getByTestId('leaderboard-no-coach')).toBeTruthy();
    expect(topOf('leaderboard-screen')).toBe(device.insets.top + layout.statusBarGap);
  });

  it('Leaderboard settings sits insets.top + 12 under the status bar with Back', async () => {
    await mount(<LeaderboardSettingsScreen />, device);
    expect(await screen.findByTestId('leaderboard-opt-in-switch')).toBeTruthy();
    expect(topOf('leaderboard-settings-screen')).toBe(device.insets.top + layout.statusBarGap);
    expect(screen.getByTestId('leaderboard-settings-back')).toBeTruthy();
  });
});
