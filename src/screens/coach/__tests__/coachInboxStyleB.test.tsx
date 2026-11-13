/**
 * D10-BUILD-INBOX (owner #196-D10, K2 Style B): the coach Messages tab shows Roman's drafts card only while Stream 2
 * drafts wait, its button opens the Pending AI drafts screen, the page is the app page (owner #197-E6), and the
 * drafts screen counts drafts by kind.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }), semanticColors: jest.requireActual('../../../theme/tokens').lightTokens }),
}));
const mockCounts = jest.fn();
jest.mock('../../../services/api', () => ({ coachApi: { getUnreadCounts: () => mockCounts() } }));
jest.mock('../../../services/realtime', () => ({ subscribeToMessages: () => () => undefined }));
const mockUser: { id: string; role?: string } = { id: 'coach-1', role: 'coach' };
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ flags: { messaging_core_v2: false } }) }));
jest.mock('../broadcasts/BroadcastsEntry', () => ({ BroadcastsEntry: () => null }));
jest.mock('../CommunityReportsEntry', () => ({ CommunityReportsEntry: () => null }));
jest.mock('../CommunityEntry', () => ({ CommunityEntry: () => null }));
jest.mock('../../../store/coachStore', () => ({
  useCoachStore: () => ({ clients: [{ id: 'client-1', firstName: 'Ana', lastName: 'Ruiz', status: 'active' }], loadClients: async () => undefined }),
}));
const mockDrafts = jest.fn();
jest.mock('../../../hooks/usePendingAiDrafts', () => ({
  COACH_AI_PENDING_DRAFTS_QUERY_KEY: ['coach', 'ai', 'pending-drafts'],
  usePendingAiDrafts: (o: unknown) => mockDrafts(o),
}));
// DRAFTS-COUNT-M: the card also reads Path Copilot's workout changes (clientPathCopilot is on in jest); none wait here.
const mockPathDrafts = jest.fn();
jest.mock('../../../api/copilotApi', () => {
  const actual = jest.requireActual('../../../api/copilotApi');
  return { ...actual, copilotApi: { ...actual.copilotApi, pathChangeDrafts: () => mockPathDrafts() } };
});
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack, canGoBack: () => true }),
  useIsFocused: () => true,
  useFocusEffect: (cb: () => void | (() => void)) => jest.requireActual('react').useEffect(() => cb(), [cb]),
}));

import MessagesScreen from '../MessagesScreen';
import PendingAiDraftsScreen from '../PendingAiDraftsScreen';
import { draftKinds } from '../inboxStyleB';
import { coachInboxB } from '../../../theme/tokens';
import type { AiActionDraftRow } from '../../../api/types/coachAiExecution';

const row = (id: string, capability: string) => ({ id, capability, status: 'pending', payload: {} }) as unknown as AiActionDraftRow;
const queue = [
  row('d1', 'draft.assign_workout'), row('d2', 'draft.assign_workout'), row('d3', 'draft.send_notification'),
  row('d4', 'draft.coach_message'), // pre-Stream-2: its own surface, not counted
];

// DRAFTS-COUNT-M: the card's Copilot read is a query, so the screen is drawn under a query client.
let client: QueryClient;
const draw = (node: React.ReactElement) => render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
afterEach(() => client.clear());

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mockPathDrafts.mockReset().mockResolvedValue([]);
  mockNavigate.mockReset();
  mockDrafts.mockReset();
  mockUser.role = 'coach';
  mockCounts.mockResolvedValue({ data: { total: 0, by_client: {} } });
});

it('counts Stream 2 drafts by kind, as the coach Home does', () => {
  expect(draftKinds(queue)).toEqual({ total: 3, kinds: [{ count: 2, label: 'Workouts' }, { count: 1, label: 'Nudge' }] });
  expect(draftKinds([])).toEqual({ total: 0, kinds: [] });
});

it('shows Roman\'s drafts while drafts wait; the button opens the Pending AI drafts screen', async () => {
  mockDrafts.mockReturnValue({ data: { drafts: queue } });
  const view = await draw(<MessagesScreen />);
  expect(await view.findByText('Roman has 3 drafts ready')).toBeTruthy();
  expect(view.getByText('2 Workouts')).toBeTruthy();
  expect(view.getByText('1 Nudge')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: "Approve Roman's drafts, 3" }));
  expect(mockNavigate).toHaveBeenCalledWith('ClientsStack', { screen: 'PendingAiDrafts', initial: false });
  expect(mockDrafts).toHaveBeenCalledWith({ enabled: true });
});

it('draws no card when nothing waits', async () => {
  mockDrafts.mockReturnValue({ data: { drafts: [] } });
  const empty = await draw(<MessagesScreen />);
  expect(await empty.findByLabelText('Open messages with Ana Ruiz')).toBeTruthy();
  expect(empty.queryByTestId('inbox-roman-drafts')).toBeNull();
});

it('never reads drafts for a non-coach session', async () => {
  mockUser.role = 'client';
  const other = await draw(<MessagesScreen />);
  expect(await other.findByLabelText('Open messages with Ana Ruiz')).toBeTruthy();
  expect(other.queryByTestId('inbox-roman-drafts')).toBeNull();
  expect(mockDrafts).not.toHaveBeenCalled();
  expect(mockPathDrafts).not.toHaveBeenCalled(); // DRAFTS-COUNT-M: nor Copilot's read
});

it('sits on the app page (owner #197-E6)', async () => {
  mockDrafts.mockReturnValue({ data: { drafts: [] } });
  const view = await draw(<MessagesScreen />);
  const bg = StyleSheet.flatten((await view.findByTestId('coach-messages')).props.style).backgroundColor;
  expect(bg).toBe(coachInboxB.page);
  expect(String(bg).toUpperCase()).toBe('#F7FAF7');
});

it('the drafts screen says how many wait, counts them by kind, and Back goes back', async () => {
  mockDrafts.mockReturnValue({ data: { drafts: queue }, isLoading: false, isError: false, isFetching: false, error: null, refetch: jest.fn() });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = await render(<QueryClientProvider client={qc}><PendingAiDraftsScreen /></QueryClientProvider>);
  expect(await view.findByText('Roman has 3 drafts ready')).toBeTruthy();
  expect(view.getByText('Pending AI drafts')).toBeTruthy();
  expect(view.getByLabelText('2 Workouts')).toBeTruthy();
  expect(view.getByLabelText('1 Nudge')).toBeTruthy();
  expect(StyleSheet.flatten(view.getByTestId('pending-ai-drafts-screen').props.style).backgroundColor).toBe(coachInboxB.page);
  fireEvent.press(view.getByRole('button', { name: 'Back' }));
  expect(mockGoBack).toHaveBeenCalled();
  qc.clear();
});
