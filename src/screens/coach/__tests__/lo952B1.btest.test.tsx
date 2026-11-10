/**
 * LO-952 B-TEST B1: the Pending AI drafts header (back, headline, subtitle, kind tiles) must scroll with the drafts.
 * At 320 pt and 130% text it fills the screen when it sits above the list, and no draft (Approve / Reject) can be
 * reached. Same mocks as coachInboxStyleB.test.tsx.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
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
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack, canGoBack: () => true }),
  useIsFocused: () => true,
  useFocusEffect: (cb: () => void | (() => void)) => jest.requireActual('react').useEffect(() => cb(), [cb]),
}));

import PendingAiDraftsScreen from '../PendingAiDraftsScreen';
import type { AiActionDraftRow } from '../../../api/types/coachAiExecution';

const row = (id: string, capability: string) => ({ id, capability, status: 'pending', payload: {} }) as unknown as AiActionDraftRow;
const queue = [
  row('d1', 'draft.assign_workout'), row('d2', 'draft.assign_workout'), row('d3', 'draft.send_notification'),
  row('d4', 'draft.coach_message'), // pre-Stream-2: its own surface, not counted
];

beforeEach(() => {
  mockNavigate.mockReset();
  mockDrafts.mockReset();
  mockUser.role = 'coach';
  mockCounts.mockResolvedValue({ data: { total: 0, by_client: {} } });
});

it('B1: the drafts header and kind tiles sit inside the scrolling list, not above it', async () => {
  mockDrafts.mockReturnValue({ data: { drafts: queue }, isLoading: false, isError: false, isFetching: false, error: null, refetch: jest.fn() });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = await render(<QueryClientProvider client={qc}><PendingAiDraftsScreen /></QueryClientProvider>);
  expect(await view.findByText('Roman has 3 drafts ready')).toBeTruthy();
  // The drafts FlatList's scroll view is the only node on this screen with a contentContainerStyle.
  type Node = { parent: Node | null; props: Record<string, unknown> } | null;
  const inList = (n: Node) => { for (let up = n?.parent ?? null; up; up = up.parent) if (up.props.contentContainerStyle) return true; return false; };
  expect(inList(view.getAllByText('Approve')[0] as unknown as Node)).toBe(true); // control: the cards are in the list
  expect(inList(view.getByTestId('pending-ai-drafts-kinds') as unknown as Node)).toBe(true);
  expect(inList(view.getByText('Roman has 3 drafts ready') as unknown as Node)).toBe(true);
  qc.clear();
});
