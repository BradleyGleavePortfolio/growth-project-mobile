import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { crossPillarApi, coachApi, practiceTypeApi } from '../services/api';
import Home from '../screens/coach/cross-pillar/CrossPillarHomeScreen';
import Clients from '../screens/coach/cross-pillar/CrossPillarClientsListScreen';
import Assignments from '../screens/coach/cross-pillar/CrossPillarAssignmentsScreen';
import Profile from '../screens/coach/cross-pillar/CrossPillarClientDetailScreen';
import Messages from '../screens/coach/cross-pillar/CrossPillarMessagesScreen';
import Practice from '../screens/coach/cross-pillar/PracticeSelectionScreen';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../theme/ThemeProvider', () => ({ useTheme: () => ({
  colors: jest.requireActual('../screens/client/wearables/recoveryTestColors').testColors,
}) }));
const mockBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockBack, navigate: jest.fn() }),
  useRoute: () => ({ params: { current: 'both', email: 'profile-test', name: 'Test client' } }),
}));
jest.mock('../components/coach/UniversalClientSearch', () => ({ __esModule: true, default: () => null, UniversalClientSearch: () => null }));
jest.mock('../services/api', () => ({
  crossPillarApi: { getAnalytics: jest.fn(), getClients: jest.fn(), getClient: jest.fn() },
  coachApi: { getUnreadCounts: jest.fn() },
  practiceTypeApi: { get: jest.fn(), set: jest.fn() },
}));

const failure = new Error('Request failed with status code 403');
beforeEach(() => {
  jest.clearAllMocks();
  for (const read of [crossPillarApi.getAnalytics, crossPillarApi.getClients, crossPillarApi.getClient, coachApi.getUnreadCounts]) {
    jest.mocked(read).mockRejectedValue(failure);
  }
});

it.each([
  [Home, 'The overview could not load. Try again in a moment.', crossPillarApi.getAnalytics],
  [Clients, 'The roster could not load. Try again in a moment.', crossPillarApi.getClients],
  [Assignments, 'The roster could not load. Try again in a moment.', crossPillarApi.getClients],
  [Profile, 'The profile could not load. Try again in a moment.', crossPillarApi.getClient],
  [Messages, 'The inbox could not load. Try again in a moment.', coachApi.getUnreadCounts],
] as const)('shows task-specific copy and retries the same read', async (Screen, copy, read) => {
  const screen = await render(<Screen />);
  expect(await screen.findByText(copy)).toBeTruthy();
  expect(screen.queryByText(failure.message)).toBeNull();
  const count = jest.mocked(read).mock.calls.length;
  await fireEvent.press(screen.getByText('Retry'));
  await waitFor(() => expect(read).toHaveBeenCalledTimes(count + 1));
});

it.each([
  [failure, "Couldn't save practice. Try again."],
  [{ response: { status: 503, data: { code: 'PRACTICE_FEDERATION_FAILED' } } }, 'Your practice did not sync across both products. Try again in a moment.'],
] as const)('keeps practice save errors plain and on the same screen', async (err, copy) => {
  jest.mocked(practiceTypeApi.set).mockRejectedValueOnce(err);
  const screen = await render(<Practice />);
  await fireEvent.press(screen.getByLabelText('Save practice'));
  expect(await screen.findByText(copy)).toBeTruthy();
  expect(practiceTypeApi.set).toHaveBeenCalledWith('both');
  expect(mockBack).not.toHaveBeenCalled();
});
