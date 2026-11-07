/**
 * FIX-952R2 (LS-952R2 B1, the class): a client whose chat Messages already heard is closed leaves Roman's drafts on
 * every reader of the shared selector, not only the Messages card: the Messages card, coach Home and the drafts screen,
 * for each closure the server sends (closed_client_ids, a closed thread, a closure on a later page, the legacy Messages
 * list's closed_client_ids). Only the words draft leaves, as for my own block: the closed client's workout stays, and
 * so do the open client's drafts. No second drafts read. The next answer without the closure brings the draft back.
 */
import React from 'react';
import { Text } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }), semanticColors: jest.requireActual('../../../theme/tokens').lightTokens }),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-1', role: 'coach' }) }));
jest.mock('../../../store/coachStore', () => {
  const state = {
    clients: [
      { id: 'client-closed', firstName: 'Ana', lastName: 'Ruiz', status: 'active' },
      { id: 'client-open', firstName: 'Ben', lastName: 'Ode', status: 'active' },
    ],
    filterStatus: 'active',
    loadError: null,
    loadClients: async () => undefined,
  };
  const useCoachStore = (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state);
  useCoachStore.getState = () => state;
  return { useCoachStore };
});
const mockUnreadCounts = jest.fn();
jest.mock('../../../services/api', () => ({ coachApi: { getUnreadCounts: () => mockUnreadCounts() } }));
jest.mock('../../../services/realtime', () => ({ subscribeToMessages: () => () => undefined }));
jest.mock('../../../hooks/useClientUnreadCount', () => ({ useClientUnreadCount: () => 0 }));
jest.mock('../home-v11/blockList', () => ({
  ...jest.requireActual('../home-v11/blockList'),
  useCoachBlockList: () => ({ known: true, blockedIds: [] }),
}));
jest.mock('../broadcasts/BroadcastsEntry', () => ({ BroadcastsEntry: () => null }));
jest.mock('../CommunityReportsEntry', () => ({ CommunityReportsEntry: () => null }));
jest.mock('../CommunityEntry', () => ({ CommunityEntry: () => null }));
jest.mock('../../../ui/layout/Screen', () => ({
  ...jest.requireActual('../../../ui/layout/Screen'),
  useScreenInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));
jest.mock('../copilot/PathChangeDrafts', () => ({
  PATH_DRAFTS_KEY: ['coach', 'path-drafts'],
  usePathChangeDrafts: () => ({ data: [], isLoading: false, isError: false }),
  PathChangeDrafts: () => null,
}));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), canGoBack: () => false, goBack: jest.fn() }),
  useIsFocused: () => true,
  useFocusEffect: (cb: () => void | (() => void)) => jest.requireActual('react').useEffect(() => cb(), [cb]),
}));
const mockListPending = jest.fn();
jest.mock('../../../api/coachAiExecutionApi', () => ({ coachAiExecutionApi: { listPending: () => mockListPending() } }));
const mockInbox = jest.fn();
jest.mock('../../../api/messagingV2Api', () => ({
  messagingV2Api: { getCoachInbox: () => mockInbox() },
  toMessagingError: () => ({ isFeatureDisabled: false, userMessage: 'Not available' }),
  MUTE_LABELS: {},
}));
let mockV2 = true;
jest.mock('../../../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ flags: { messaging_core_v2: mockV2 } }) }));

import MessagesScreen from '../MessagesScreen';
import { coachInboxKey } from '../CoachInboxV2';
import PendingAiDraftsScreen from '../PendingAiDraftsScreen';
import { useCoachHomeV11 } from '../home-v11/useCoachHomeV11';
import type { CoachHomeSources } from '../command-center/coachHomeSources';
import { COACH_AI_PENDING_DRAFTS_QUERY_KEY } from '../../../hooks/usePendingAiDrafts';
import { useBlockedUsersStore } from '../../../store/blockedUsersStore';

const never = () => new Promise<never>(() => undefined);
const sources = { monthSoFar: never, ltv: never, nextPayout: never, atRisk: never } as unknown as CoachHomeSources;
function HomeProbe() {
  const { data: d } = useCoachHomeV11(sources, never);
  return <Text testID="home-drafts">{`${d.draftsWaiting} waiting, ${d.draftKinds.nudges} nudges, ${d.draftKinds.workouts} workouts`}</Text>;
}

type Closure = 'closed_client_ids' | 'closed_thread' | 'later_page' | 'legacy_closed_client_ids';
type Reader = 'messages_card' | 'coach_home' | 'drafts_screen';

const page = (over: Record<string, unknown> = {}) => ({ items: [], total_unread: 0, next_cursor: null, closed_client_ids: [] as string[], ...over });
const closedThread = {
  thread_id: 'coach-1:client-closed', kind: 'coach_client', coach_id: 'coach-1', client_id: 'client-closed',
  counterpart: { user_id: 'client-closed', display_name: 'Ana Ruiz' }, last_message: null, unread_count: 0, muted: false,
  muted_until: null, pinned: false, blocked_by_me: false, closed: true, last_activity_at: null,
};
function inboxAnswer(closure: Closure, closed: boolean) {
  if (!closed || closure === 'legacy_closed_client_ids') return { pages: [page()], pageParams: [null] };
  if (closure === 'closed_thread') return { pages: [page({ items: [closedThread] })], pageParams: [null] };
  const shut = page({ closed_client_ids: ['client-closed'] });
  if (closure === 'later_page') return { pages: [page({ next_cursor: 'page-2' }), shut], pageParams: [null, 'page-2'] };
  return { pages: [shut], pageParams: [null] };
}
const legacyAnswer = (closed: boolean) => ({ data: { by_client: {}, closed_client_ids: closed ? ['client-closed'] : [] } });

/** What each reader shows: [before the closure, after it]. */
const SHOWS: Record<Reader, readonly [string, string]> = {
  messages_card: ['Roman has 3 drafts ready', 'Roman has 2 drafts ready'],
  coach_home: ['3 waiting, 2 nudges, 1 workouts', '2 waiting, 1 nudges, 1 workouts'],
  drafts_screen: ['Roman has 3 drafts ready', 'Roman has 2 drafts ready'],
};
const CLOSURES: Closure[] = ['closed_client_ids', 'closed_thread', 'later_page', 'legacy_closed_client_ids'];
const READERS: Reader[] = ['messages_card', 'coach_home', 'drafts_screen'];
const ROWS = CLOSURES.flatMap((closure) => READERS.map((reader) => [closure, reader] as const));

it.each(ROWS)('a %s closure leaves the closed client words draft on the %s', async (closure, reader) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 120_000 } } });
  useBlockedUsersStore.setState({ userId: 'coach-1', hydrated: true, blocked: [] });
  mockListPending.mockReset();
  mockV2 = closure !== 'legacy_closed_client_ids';
  mockInbox.mockResolvedValue(page());
  mockUnreadCounts.mockResolvedValue(legacyAnswer(false));
  qc.setQueryData(coachInboxKey('all'), inboxAnswer(closure, false));
  qc.setQueryData(COACH_AI_PENDING_DRAFTS_QUERY_KEY, {
    drafts: [
      { id: 'n-closed', subject_user_id: 'client-closed', capability: 'draft.send_notification', status: 'pending', payload: {} },
      { id: 'w-closed', subject_user_id: 'client-closed', capability: 'draft.assign_workout', status: 'pending', payload: {} },
      { id: 'n-open', subject_user_id: 'client-open', capability: 'draft.send_notification', status: 'pending', payload: {} },
    ],
  });
  const wrap = (ui: React.ReactElement) => <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
  const messages = await render(wrap(<MessagesScreen />));
  const other = reader === 'messages_card' ? null : await render(wrap(reader === 'coach_home' ? <HomeProbe /> : <PendingAiDraftsScreen />));
  const sees = (text: string) => (reader === 'coach_home'
    ? other!.getByTestId('home-drafts').props.children === text
    : (reader === 'messages_card' ? messages : other!).queryByText(text) !== null);
  const answer = async (closed: boolean) => {
    await act(async () => {
      if (closure === 'legacy_closed_client_ids') {
        mockUnreadCounts.mockResolvedValue(legacyAnswer(closed));
        await messages.rerender(wrap(<MessagesScreen key={closed ? 'closed' : 'open'} />));
      } else {
        qc.setQueryData(coachInboxKey('all'), inboxAnswer(closure, closed));
      }
    });
  };
  try {
    await waitFor(() => expect(sees(SHOWS[reader][0])).toBe(true));
    await answer(true);
    await waitFor(() => expect(sees(SHOWS[reader][1])).toBe(true));
    if (reader === 'drafts_screen') {
      expect(other!.queryByTestId('ai-draft-approve-n-closed')).toBeNull();
      expect(other!.getByTestId('ai-draft-approve-w-closed')).toBeTruthy(); // a messaging block is not a roster move
      expect(other!.getByTestId('ai-draft-approve-n-open')).toBeTruthy();
    }
    expect(mockListPending).not.toHaveBeenCalled();
    await answer(false); // the block is lifted: the next answer brings the draft back
    await waitFor(() => expect(sees(SHOWS[reader][0])).toBe(true));
  } finally {
    await other?.unmount();
    await messages.unmount();
    qc.clear();
    useBlockedUsersStore.setState({ userId: null, hydrated: false, blocked: [] });
  }
});

it('a closure heard for one coach is not used once the block list is not theirs (sign-out, switch)', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 120_000 } } });
  useBlockedUsersStore.setState({ userId: 'coach-1', hydrated: true, blocked: [] });
  mockV2 = true;
  qc.setQueryData(coachInboxKey('all'), inboxAnswer('closed_client_ids', true));
  qc.setQueryData(COACH_AI_PENDING_DRAFTS_QUERY_KEY, {
    drafts: [{ id: 'n-closed', subject_user_id: 'client-closed', capability: 'draft.send_notification', status: 'pending', payload: {} }],
  });
  const wrap = (ui: React.ReactElement) => <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
  const messages = await render(wrap(<MessagesScreen />));
  const home = await render(wrap(<HomeProbe />));
  try {
    await waitFor(() => expect(home.getByTestId('home-drafts').props.children).toBe('0 waiting, 0 nudges, 0 workouts'));
    await messages.unmount();
    await act(async () => { useBlockedUsersStore.setState({ userId: 'coach-2', hydrated: true, blocked: [] }); });
    await waitFor(() => expect(home.getByTestId('home-drafts').props.children).toBe('1 waiting, 1 nudges, 0 workouts'));
  } finally {
    await home.unmount();
    qc.clear();
    useBlockedUsersStore.setState({ userId: null, hydrated: false, blocked: [] });
  }
});
