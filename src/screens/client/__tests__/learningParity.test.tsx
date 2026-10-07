import React from 'react';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import { act, fireEvent, render } from '@testing-library/react-native';
import CoachGuidelinesScreen from '../CoachGuidelinesScreen';
import ClientPathCopilotScreen from '../ClientPathCopilotScreen';
import { coachApi } from '../../../services/api';
import { fetchClientPathCopilot } from '../../../services/wave11Adapters';
const mockBack = jest.fn();
const mockFlags: { clientPathCopilot: boolean } = jest.requireMock('../../../config/featureFlags').featureFlags;
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: mockBack }) }));
jest.mock('../../../hooks/useCurrentUser', () => { const user = { id: 'student' }; return { useCurrentUser: () => user }; });
jest.mock('../../../theme/ThemeProvider', () => ({ useTheme: () => ({ colors: {}, semanticColors: jest.requireActual('../../../theme/tokens').lightTokens }) }));
jest.mock('../../../services/api', () => ({ coachApi: { getMyGuidelines: jest.fn() } }));
jest.mock('../../../services/wave11Adapters', () => ({ fetchClientPathCopilot: jest.fn() }));
jest.mock('../../../config/featureFlags', () => ({ featureFlags: { clientPathCopilot: true } }));
jest.mock('../../../ui/skeletons/Skeleton', () => ({ SkeletonScreen: () => null }));
const getGuidelines = jest.mocked(coachApi.getMyGuidelines);
const fetchPath = jest.mocked(fetchClientPathCopilot);
function response<T>(data: T): AxiosResponse<T> { return { data, status: 200, statusText: 'OK', headers: {}, config: { headers: new AxiosHeaders() } }; }
beforeEach(() => { jest.clearAllMocks(); mockFlags.clientPathCopilot = true; });
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
test('path keeps flag gating, refresh and factual empty state without promised milestones', async () => {
  fetchPath.mockResolvedValue({ suggestions: [], pendingVerifiedProgress: [], isStale: true, generatedAt: '' });
  const screen = await render(<ClientPathCopilotScreen />); expect(await screen.findByText('No suggestions are available.')).toBeTruthy();
  await act(async () => screen.getByLabelText('Client Path Copilot screen').props.refreshControl.props.onRefresh());
  expect(fetchPath).toHaveBeenCalledTimes(2); await screen.unmount(); mockFlags.clientPathCopilot = false;
  expect((await render(<ClientPathCopilotScreen />)).getByText('Path suggestions are not available on this account.')).toBeTruthy();
});
test('path shows only supplied suggestions and keeps a failed load distinct from emptiness', async () => {
  fetchPath.mockRejectedValueOnce(new Error('offline'));
  const screen = await render(<ClientPathCopilotScreen />); expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('No suggestions yet')).toBeNull();
  fetchPath.mockResolvedValue({ suggestions: [{ id: 's', headline: 'Recorded pattern', body: 'Recorded context.', createdAt: '', topic: 'training', pinnedByCoach: false, requiresCoachApproval: true }], pendingVerifiedProgress: [], isStale: false, generatedAt: '' });
  await act(async () => screen.getByLabelText('Client Path Copilot screen').props.refreshControl.props.onRefresh());
  expect(await screen.findByText('Recorded pattern')).toBeTruthy(); expect(screen.getByText(/Awaiting/)).toBeTruthy();
});
