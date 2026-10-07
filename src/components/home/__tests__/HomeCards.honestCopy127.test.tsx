import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
const mockUser = { id: 'u1', coach_id: 'c1' };
const mockGet = jest.fn();
const mockSet = jest.fn().mockResolvedValue(undefined);
const mockInsights = { isLoading: false, isError: false,
  data: { status: 'ok', insights: [{ text: 'Logged pattern', correlation: 0.5, weeks: 3 }], notes: [] } };
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../services/api', () => ({ __esModule: true, default: { get: () => mockGet() } }));
jest.mock('../../../storage/mmkv', () => ({ prefsStorage: { getStringAsync: async () => null, set: (...args: unknown[]) => mockSet(...args) } }));
jest.mock('../../../hooks/useHolisticInsights', () => ({ useHolisticInsights: () => mockInsights }));
import CoachIntroductionBanner from '../CoachIntroductionBanner';
import HolisticInsightsTile from '../HolisticInsightsTile';
it.each(['coachless', '404'])('no invented coach promise: %s', async (state) => {
  mockUser.coach_id = state === 'coachless' ? '' : 'c1';
  mockGet.mockRejectedValue({ response: { status: 404 } });
  await render(<CoachIntroductionBanner />);
  expect(screen.queryByText(/Your coach will assign/)).toBeNull();
  expect(screen.queryByTestId(/waiting-for-coach-banner|coach-intro-not-found/)).toBeNull();
});
it('retains the real coach introduction and per-user dismiss action', async () => {
  mockUser.coach_id = 'c1';
  mockGet.mockResolvedValue({ data: { id: 'c1', name: 'Bradley' } });
  await render(<CoachIntroductionBanner />);
  await fireEvent.press(await screen.findByLabelText('Dismiss coach introduction banner'));
  expect(mockSet).toHaveBeenCalledWith('home.coach_intro_banner_dismissed:u1', 'true');
  expect(screen.queryByTestId('coach-intro-banner')).toBeNull();
});
it.each(['empty', 'insufficient_data', 'finance_unavailable', 'error'])('hides nonessential insights: %s', async (state) => {
  mockInsights.isError = state === 'error';
  mockInsights.data = { status: state === 'empty' || state === 'error' ? 'ok' : state, insights: [], notes: [] };
  await render(<HolisticInsightsTile />);
  expect(screen.queryByText('Holistic insights')).toBeNull();
});
it('keeps verified insight detail and its optional action', async () => {
  mockInsights.isError = false;
  mockInsights.data = { status: 'ok', insights: [{ text: 'Logged pattern', correlation: 0.5, weeks: 3 }], notes: [] };
  const onPress = jest.fn();
  await render(<HolisticInsightsTile onPress={onPress} />);
  expect(screen.getByText('Logged pattern')).toBeTruthy();
  expect(screen.getByText('Correlation +0.50 over 3 weeks')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('View holistic insights'));
  expect(onPress).toHaveBeenCalledTimes(1);
});
