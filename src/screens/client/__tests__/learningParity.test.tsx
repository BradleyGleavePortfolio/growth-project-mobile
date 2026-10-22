import React from 'react';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import { fireEvent, render } from '@testing-library/react-native';
import CoachGuidelinesScreen from '../CoachGuidelinesScreen';
import { coachApi } from '../../../services/api';
const mockBack = jest.fn();
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: mockBack }) }));
jest.mock('../../../hooks/useCurrentUser', () => { const user = { id: 'student' }; return { useCurrentUser: () => user }; });
jest.mock('../../../theme/ThemeProvider', () => ({ useTheme: () => ({ colors: {}, semanticColors: jest.requireActual('../../../theme/tokens').lightTokens }) }));
jest.mock('../../../services/api', () => ({ coachApi: { getMyGuidelines: jest.fn() } }));
const getGuidelines = jest.mocked(coachApi.getMyGuidelines);
function response<T>(data: T): AxiosResponse<T> { return { data, status: 200, statusText: 'OK', headers: {}, config: { headers: new AxiosHeaders() } }; }
beforeEach(() => { jest.clearAllMocks(); });
test('guidelines retain back and retry; show title and created date rather than invented plan', async () => {
  getGuidelines.mockRejectedValueOnce(new Error('Internal error'));
  getGuidelines.mockResolvedValueOnce(response({ title: 'Training notes', description: 'Use a steady pace.', created_at: '2026-10-01T12:00:00Z' }));
  const screen = await render(<CoachGuidelinesScreen />);
  await fireEvent.press(await screen.findByText('Retry'));
  expect(await screen.findByText('Training notes')).toBeTruthy(); expect(screen.getByText('Added Oct 1, 2026')).toBeTruthy();
  expect(screen.getByText('Use a steady pace.')).toBeTruthy(); expect(screen.queryByText('Your Workout Plan')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Back' })); expect(mockBack).toHaveBeenCalled();
});
test('guidelines omit absent dates and distinguish no guidelines', async () => {
  getGuidelines.mockResolvedValueOnce(response({ description: 'Read the notes.' }));
  const screen = await render(<CoachGuidelinesScreen />); await screen.findByText('Read the notes.');
  expect(screen.queryByText(/Added/)).toBeNull(); await screen.unmount();
  getGuidelines.mockResolvedValueOnce(response(null));
  expect(await (await render(<CoachGuidelinesScreen />)).findByText('No guidelines yet')).toBeTruthy();
});
