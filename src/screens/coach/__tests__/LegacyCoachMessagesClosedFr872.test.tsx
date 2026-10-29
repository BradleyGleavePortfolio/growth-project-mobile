/**
 * FR-872 (Opus B1, Sol B1; b#1153 CONTRACT 6375583793): the legacy coach list (messaging_core_v2 off) hides a client
 * who blocked the coach. Her row is gone from the server's counts; her id is in closed_client_ids next to total.
 */
import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }), semanticColors: jest.requireActual('../../../theme/tokens').lightTokens }),
}));
const mockCounts = jest.fn();
jest.mock('../../../services/api', () => ({ coachApi: { getUnreadCounts: () => mockCounts() } }));
jest.mock('../../../services/realtime', () => ({ subscribeToMessages: () => () => undefined }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-1' }) }));
jest.mock('../../../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ flags: { messaging_core_v2: false } }) }));
jest.mock('../broadcasts/BroadcastsEntry', () => ({ BroadcastsEntry: () => null }));
jest.mock('../CommunityReportsEntry', () => ({ CommunityReportsEntry: () => null }));
jest.mock('../CommunityEntry', () => ({ CommunityEntry: () => null }));
const mockClients = [
  { id: 'client-1', firstName: 'Ana', lastName: 'Ruiz', status: 'active' },
  { id: 'client-2', firstName: 'Ben', lastName: 'Ode', status: 'active' },
];
jest.mock('../../../store/coachStore', () => ({ useCoachStore: () => ({ clients: mockClients, loadClients: async () => undefined }) }));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn() }),
  useFocusEffect: (cb: () => void | (() => void)) => jest.requireActual('react').useEffect(() => cb(), [cb]),
}));
const MessagesScreen = require('../MessagesScreen').default;

it.each([
  ['listed', ['client-1'], false],
  ['not listed (unblocked, or an older server)', undefined, true],
])('a client %s in closed_client_ids (%p): her row shows = %p', async (_case, ids, shown) => {
  mockCounts.mockResolvedValue({ data: { total: 1, by_client: { 'client-2': 1 }, closed_client_ids: ids } });
  const view = await render(<MessagesScreen />);
  expect(await view.findByLabelText('Open messages with Ben Ode, 1 unread')).toBeTruthy();
  expect(!!view.queryByLabelText(/Open messages with Ana Ruiz/)).toBe(shown);
});
