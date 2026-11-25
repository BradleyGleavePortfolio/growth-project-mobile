/**
 * LS-952R2 B1: a server-confirmed closed client must leave the new draft count too,
 * not just the conversation row. The gateway cache is still fresh after the inbox
 * learns the client blocked this coach; no second gateway read is needed to hide it.
 */
import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: new Proxy({}, { get: () => '#000000' }),
    semanticColors: jest.requireActual('../../../theme/tokens').lightTokens,
  }),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'coach-1', role: 'coach' }),
}));
jest.mock('../../../store/coachStore', () => ({
  useCoachStore: () => ({
    clients: [
      { id: 'client-closed', firstName: 'Ana', lastName: 'Ruiz', status: 'active' },
      { id: 'client-open', firstName: 'Ben', lastName: 'Ode', status: 'active' },
    ],
    loadClients: async () => undefined,
  }),
}));
jest.mock('../../../services/realtime', () => ({ subscribeToMessages: () => () => undefined }));
jest.mock('../broadcasts/BroadcastsEntry', () => ({ BroadcastsEntry: () => null }));
jest.mock('../CommunityReportsEntry', () => ({ CommunityReportsEntry: () => null }));
jest.mock('../CommunityEntry', () => ({ CommunityEntry: () => null }));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn() }),
  useIsFocused: () => true,
  useFocusEffect: (cb: () => void | (() => void)) =>
    jest.requireActual('react').useEffect(() => cb(), [cb]),
}));
const mockListPending = jest.fn();
jest.mock('../../../api/coachAiExecutionApi', () => ({
  coachAiExecutionApi: { listPending: () => mockListPending() },
}));
const mockInbox = jest.fn();
jest.mock('../../../api/messagingV2Api', () => ({
  messagingV2Api: { getCoachInbox: () => mockInbox() },
  toMessagingError: () => ({ isFeatureDisabled: false, userMessage: 'Not available' }),
  MUTE_LABELS: {},
}));

import CoachInboxV2, { coachInboxKey } from '../CoachInboxV2';
import { COACH_AI_PENDING_DRAFTS_QUERY_KEY } from '../../../hooks/usePendingAiDrafts';
import { useBlockedUsersStore } from '../../../store/blockedUsersStore';

it.each(['closed_client_ids', 'closed_thread', 'later_page'] as const)(
  'B1: a server-confirmed %s client leaves the cached Roman draft count',
  async (shape) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 120_000 } } });
    useBlockedUsersStore.setState({ userId: 'coach-1', hydrated: true, blocked: [] });
    mockListPending.mockReset();
    const page = { items: [], total_unread: 0, next_cursor: null, closed_client_ids: [] as string[] };
    mockInbox.mockResolvedValue(page);
    qc.setQueryData(coachInboxKey('all'), { pages: [page], pageParams: [null] });
    qc.setQueryData(COACH_AI_PENDING_DRAFTS_QUERY_KEY, {
      drafts: [
        { id: 'n-closed', subject_user_id: 'client-closed', capability: 'draft.send_notification', status: 'pending', payload: {} },
        { id: 'n-open', subject_user_id: 'client-open', capability: 'draft.send_notification', status: 'pending', payload: {} },
      ],
    });
    const view = await render(
      <QueryClientProvider client={qc}><CoachInboxV2 onFeatureDisabled={jest.fn()} /></QueryClientProvider>,
    );
    try {
      expect(view.getByText('Roman has 2 drafts ready')).toBeTruthy();
      expect(view.getByTestId('inbox-client-client-closed')).toBeTruthy();
      await act(async () => {
        const closedPage = {
          ...page,
          closed_client_ids: shape === 'closed_thread' ? [] : ['client-closed'],
          items: shape === 'closed_thread' ? [{
            thread_id: 'coach-1:client-closed', kind: 'coach_client', coach_id: 'coach-1',
            client_id: 'client-closed', counterpart: { user_id: 'client-closed', display_name: 'Ana Ruiz' },
            last_message: null, unread_count: 0, muted: false, muted_until: null, pinned: false,
            blocked_by_me: false, closed: true, last_activity_at: null,
          }] : [],
        };
        qc.setQueryData(coachInboxKey('all'), {
          pages: shape === 'later_page' ? [{ ...page, next_cursor: 'page-2' }, closedPage] : [closedPage],
          pageParams: shape === 'later_page' ? [null, 'page-2'] : [null],
        });
      });
      // Control: the existing inbox applies the very same server answer already.
      await waitFor(() => expect(view.queryByTestId('inbox-client-client-closed')).toBeNull());
      expect(view.queryByTestId('inbox-row-client-closed')).toBeNull();
      expect(mockListPending).not.toHaveBeenCalled();
      await waitFor(() => expect(view.queryByText('Roman has 2 drafts ready')).toBeNull());
      expect(view.getByText('Roman has 1 draft ready')).toBeTruthy();
    } finally {
      view.unmount();
      qc.clear();
      useBlockedUsersStore.setState({ userId: null, hydrated: false, blocked: [] });
    }
  },
);
