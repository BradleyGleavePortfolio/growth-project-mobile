// Leaderboard opens from the Community tab on the Community stack; a client
// with no coach gets no entry point and a calm explanation, never an error.
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => {
  const R = jest.requireActual('react');
  return {
    useNavigation: () => ({ navigate: mockNavigate }),
    NavigationContext: R.createContext(undefined),
  };
});
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
const mockUser: { current: { id: string; coach_id?: string } } = { current: { id: 'me-1' } };
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser.current }));
function mockTheme() {
  return { useTheme: () => ({ semanticColors: jest.requireActual('../../../theme/tokens').lightTokens }) };
}
jest.mock('../../../theme/useTheme', () => mockTheme());
jest.mock('../../../theme/ThemeProvider', () => mockTheme());
jest.mock('../../../config/featureFlags', () => ({ featureFlags: { communityTab: true } }));
jest.mock('../../../hooks/useCommunity', () => ({
  useCommunityMe: () => ({ data: { workspace_id: 'ws-1' }, isLoading: false, isError: false }),
  useCommunityBadge: () => ({ total: 0, cohortMessages: 0, dmMessages: 0, mentions: 0 }),
}));
jest.mock('../CommunityTodayScreen', () => () => null);
jest.mock('../CommunitySpaceScreen', () => () => null);
jest.mock('../CommunityDmListScreen', () => () => null);
jest.mock('../CommunityChallengesScreen', () => () => null);
const mockGetLeaderboard = jest.fn();
jest.mock('../../../services/leaderboardApi', () => ({ getLeaderboard: () => mockGetLeaderboard() }));

import CommunityTabScreen from '../CommunityTabScreen';
import LeaderboardScreen from '../../client/LeaderboardScreen';

beforeEach(() => {
  mockNavigate.mockReset();
  mockGetLeaderboard.mockReset();
});

describe('Community tab: leaderboard entry point', () => {
  it('opens Leaderboard on the Community stack for a client with a coach', async () => {
    mockUser.current = { id: 'me-1', coach_id: 'coach-1' };
    const { getByTestId } = await render(<CommunityTabScreen />);
    await fireEvent.press(getByTestId('community-leaderboard-link'));
    expect(mockNavigate).toHaveBeenCalledWith('Leaderboard');
  });

  it('shows no leaderboard entry for a client with no coach', async () => {
    mockUser.current = { id: 'me-1' };
    const { queryByTestId, getByTestId } = await render(<CommunityTabScreen />);
    expect(queryByTestId('community-leaderboard-link')).toBeNull();
    expect(getByTestId('community-safety-link')).toBeTruthy();
  });

  it('registers Leaderboard and its settings on the Community stack', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../../navigation/CommunityNavigator.tsx'), 'utf8');
    expect(src).toMatch(/<CommunityStack\.Screen name="Leaderboard" component=\{LeaderboardScreen\}/);
    expect(src).toMatch(/name="LeaderboardSettings" component=\{LeaderboardSettingsScreen\}/);
  });
});

describe('LeaderboardScreen: coachless client', () => {
  it('explains the board instead of loading, erroring or offering opt-in', async () => {
    mockUser.current = { id: 'me-1' };
    const { getByTestId, queryByTestId } = await render(<LeaderboardScreen />);
    expect(getByTestId('leaderboard-no-coach')).toBeTruthy();
    expect(queryByTestId('leaderboard-error')).toBeNull();
    expect(queryByTestId('leaderboard-opt-in-card')).toBeNull();
    expect(queryByTestId('leaderboard-settings-link')).toBeNull();
    expect(mockGetLeaderboard).not.toHaveBeenCalled();
  });
});
