import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { darkTokens, lightTokens } from '../theme/tokens';
import { getLeaderboard, setLeaderboardOptIn, type LeaderboardResponse } from '../services/leaderboardApi';
import LeaderboardScreen from '../screens/client/LeaderboardScreen';
import LeaderboardSettingsScreen from '../screens/client/LeaderboardSettingsScreen';

const mockNavigate = jest.fn();
const mockBack = jest.fn();
const mockTheme = { semanticColors: lightTokens };
jest.mock('../theme/ThemeProvider', () => ({ useTheme: () => mockTheme }));
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'self', coach_id: 'coach' }) }));
jest.mock('../services/leaderboardApi', () => ({ getLeaderboard: jest.fn(), setLeaderboardOptIn: jest.fn() }));
jest.mock('@react-navigation/native', () => ({
  NavigationContext: jest.requireActual('react').createContext({
    navigate: (...args: string[]) => mockNavigate(...args), goBack: () => mockBack(),
    canGoBack: () => true, addListener: () => () => {},
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: jest.requireActual('react-native').View,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
const api = { get: jest.mocked(getLeaderboard), save: jest.mocked(setLeaderboardOptIn) };
function board(optedIn = true): LeaderboardResponse {
  return {
    entries: optedIn ? [{ rank: 6, userId: 'self', displayName: 'Dana', combinedScore: 72, weekDelta: null, isRequester: true }] : [],
    selfRank: optedIn ? 6 : null,
    viewer: { is_opted_in: optedIn, rank: optedIn ? 6 : null, score: optedIn ? 72 : null },
  };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockTheme.semanticColors = lightTokens;
  api.get.mockResolvedValue(board());
  api.save.mockResolvedValue({ success: true, enabled: true });
});
it('shows only a computed self-rank hero and preserves back, settings and sticky self row', async () => {
  await render(<LeaderboardScreen />);
  expect(await screen.findByTestId('leaderboard-self-hero')).toHaveTextContent(/Your rank: 6/);
  expect(screen.getByTestId('leaderboard-self-hero')).toHaveTextContent(/72 of 100/);
  expect(screen.getByTestId('leaderboard-sticky-self-row')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('leaderboard-back'));
  await fireEvent.press(screen.getByTestId('leaderboard-settings-link'));
  expect(mockBack).toHaveBeenCalled();
  expect(mockNavigate).toHaveBeenCalledWith('LeaderboardSettings');
});
it('keeps opt-in and optional display name reachable without inventing a rank', async () => {
  api.get.mockResolvedValue(board(false));
  await render(<LeaderboardScreen />);
  await screen.findByTestId('leaderboard-opt-in-card');
  expect(screen.queryByTestId('leaderboard-self-hero')).toBeNull();
  await fireEvent.changeText(screen.getByTestId('leaderboard-display-name-input'), ' Dana T. ');
  await fireEvent.press(screen.getByTestId('leaderboard-opt-in-button'));
  expect(api.save).toHaveBeenCalledWith({ enabled: true, displayName: 'Dana T.' });
});
it('does not show a hero for an opted-in board without a computed rank or score', async () => {
  api.get.mockResolvedValue({ entries: [], selfRank: null, viewer: { is_opted_in: true, rank: null, score: null } });
  await render(<LeaderboardScreen />);
  expect(await screen.findByText('No leaderboard entries to show yet.')).toBeTruthy();
  expect(screen.queryByTestId('leaderboard-self-hero')).toBeNull();
});
it('keeps retry reachable after a leaderboard load failure', async () => {
  api.get.mockRejectedValueOnce(new Error('offline'));
  await render(<LeaderboardScreen />);
  await fireEvent.press(await screen.findByLabelText('Retry loading leaderboard'));
  expect(await screen.findByTestId('leaderboard-self-hero')).toBeTruthy();
  expect(api.get).toHaveBeenCalledTimes(2);
});
it.each([lightTokens, darkTokens])('uses the active settings palette and preserves name saving and opt-out', async (palette) => {
  mockTheme.semanticColors = palette;
  await render(<LeaderboardSettingsScreen />);
  const toggle = await screen.findByTestId('leaderboard-opt-in-switch');
  expect(toggle.props.onTintColor).toBe(palette.accent);
  expect(toggle.props.tintColor).toBe(palette.border);
  expect(screen.queryByText('Hidden from this leaderboard.')).toBeNull();
  await fireEvent.changeText(screen.getByTestId('leaderboard-settings-name-input'), 'Dana T.');
  await fireEvent.press(screen.getByTestId('leaderboard-settings-save-name'));
  await waitFor(() => expect(api.save).toHaveBeenCalledWith({ enabled: true, displayName: 'Dana T.' }));
  await waitFor(() => expect(screen.getByTestId('leaderboard-opt-in-switch').props.disabled).toBe(false));
  await fireEvent(screen.getByTestId('leaderboard-opt-in-switch'), 'change', { nativeEvent: { value: false } });
  await waitFor(() => expect(api.save).toHaveBeenLastCalledWith({ enabled: false, displayName: undefined }));
  expect(screen.getByText('Hidden from this leaderboard.')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('leaderboard-settings-back'));
  expect(mockBack).toHaveBeenCalled();
});
