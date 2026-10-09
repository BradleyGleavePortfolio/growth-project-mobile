/**
 * FWC-SAFE-128 U10: the backend runs the community content filter on a chosen
 * leaderboard display name and answers 422 `community.content.rejected` with
 * its own message. The screens show that message, so the client knows to pick
 * another name instead of retrying the same one; any other failure keeps the
 * generic retry copy.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { lightTokens } from '../theme/tokens';
import { getLeaderboard, setLeaderboardOptIn, type LeaderboardResponse } from '../services/leaderboardApi';
import LeaderboardScreen from '../screens/client/LeaderboardScreen';
import LeaderboardSettingsScreen from '../screens/client/LeaderboardSettingsScreen';

const mockTheme = { semanticColors: lightTokens };
jest.mock('../theme/ThemeProvider', () => ({ useTheme: () => mockTheme }));
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'self', coach_id: 'coach' }) }));
jest.mock('../services/leaderboardApi', () => ({ getLeaderboard: jest.fn(), setLeaderboardOptIn: jest.fn() }));
jest.mock('@react-navigation/native', () => ({
  NavigationContext: jest.requireActual('react').createContext({
    navigate: () => {}, goBack: () => {}, canGoBack: () => true, addListener: () => () => {},
  }),
}));
// Screen (src/ui) reads SafeAreaInsetsContext; null = no provider = zero insets.
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: jest.requireActual('react-native').View,
  SafeAreaInsetsContext: jest.requireActual('react').createContext(null),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const REJECTED =
  'This display name was not saved because it appears to contain abusive or explicit language. Choose another name.';
function rejectedName(): Error {
  return Object.assign(new Error('Request failed with status code 422'), {
    isAxiosError: true,
    response: {
      status: 422,
      data: { error: 'content_rejected', code: 'community.content.rejected', message: REJECTED },
    },
  });
}
const api = { get: jest.mocked(getLeaderboard), save: jest.mocked(setLeaderboardOptIn) };
function board(optedIn: boolean): LeaderboardResponse {
  return {
    entries: optedIn ? [{ rank: 1, userId: 'self', displayName: 'Dana', combinedScore: 72, weekDelta: null, isRequester: true }] : [],
    selfRank: optedIn ? 1 : null,
    viewer: { is_opted_in: optedIn, rank: optedIn ? 1 : null, score: optedIn ? 72 : null },
  };
}
beforeEach(() => {
  jest.clearAllMocks();
  api.get.mockResolvedValue(board(true));
  api.save.mockResolvedValue({ success: true, enabled: true });
});

it('opt-in card: a refused name shows the reason from the server, not a generic retry', async () => {
  api.get.mockResolvedValue(board(false));
  api.save.mockRejectedValueOnce(rejectedName());
  await render(<LeaderboardScreen />);
  await fireEvent.changeText(await screen.findByTestId('leaderboard-display-name-input'), 'kys');
  await fireEvent.press(screen.getByTestId('leaderboard-opt-in-button'));
  expect(await screen.findByText(REJECTED)).toBeTruthy();
  expect(screen.queryByText('Could not save your preference. Try again.')).toBeNull();
  // Try again still leads back to the opt-in card.
  await fireEvent.press(screen.getByLabelText('Retry loading leaderboard'));
  expect(await screen.findByTestId('leaderboard-opt-in-card')).toBeTruthy();
});

it('settings: a refused name shows the reason and keeps the typed name for editing', async () => {
  api.save.mockRejectedValueOnce(rejectedName());
  await render(<LeaderboardSettingsScreen />);
  await fireEvent.changeText(await screen.findByTestId('leaderboard-settings-name-input'), 'kys');
  await fireEvent.press(screen.getByTestId('leaderboard-settings-save-name'));
  expect(await screen.findByText(REJECTED)).toBeTruthy();
  expect(screen.getByTestId('leaderboard-settings-name-input').props.value).toBe('kys');
});

it('settings: turning back on with a refused name reverts the switch and says why', async () => {
  await render(<LeaderboardSettingsScreen />);
  await fireEvent.changeText(await screen.findByTestId('leaderboard-settings-name-input'), 'kys');
  await fireEvent(screen.getByTestId('leaderboard-opt-in-switch'), 'change', { nativeEvent: { value: false } });
  await waitFor(() => expect(api.save).toHaveBeenLastCalledWith({ enabled: false, displayName: undefined }));
  await waitFor(() => expect(screen.getByTestId('leaderboard-opt-in-switch').props.disabled).toBe(false));
  api.save.mockRejectedValueOnce(rejectedName());
  await fireEvent(screen.getByTestId('leaderboard-opt-in-switch'), 'change', { nativeEvent: { value: true } });
  expect(await screen.findByText(REJECTED)).toBeTruthy();
  expect(api.save).toHaveBeenLastCalledWith({ enabled: true, displayName: 'kys' });
  expect(screen.getByTestId('leaderboard-opt-in-switch').props.value).toBe(false);
});

it('any other failure keeps the generic retry copy', async () => {
  api.save.mockRejectedValueOnce(Object.assign(new Error('500'), { response: { status: 500, data: {} } }));
  await render(<LeaderboardSettingsScreen />);
  await fireEvent.changeText(await screen.findByTestId('leaderboard-settings-name-input'), 'Dana T.');
  await fireEvent.press(screen.getByTestId('leaderboard-settings-save-name'));
  expect(await screen.findByText('Could not save your display name. Try again.')).toBeTruthy();
});
