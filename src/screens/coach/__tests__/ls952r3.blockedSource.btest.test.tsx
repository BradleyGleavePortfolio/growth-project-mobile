/**
 * LS-952R3: a plain workout survives a block, but a workout that quotes the
 * blocked chat does not (backend main withoutBlockedSources). Exercise the
 * ordinary local block event with a fresh cached queue, not a remote race.
 */
import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }), semanticColors: jest.requireActual('../../../theme/tokens').lightTokens }),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-1', role: 'coach' }) }));
jest.mock('../../../hooks/useClientUnreadCount', () => ({ useClientUnreadCount: () => 0 }));
jest.mock('../../../ui/layout/Screen', () => ({ useScreenInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }) }));
jest.mock('../copilot/PathChangeDrafts', () => ({
  PATH_DRAFTS_KEY: ['coach', 'path-drafts'],
  usePathChangeDrafts: () => ({ data: [], isLoading: false, isError: false }),
  PathChangeDrafts: () => null,
}));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), canGoBack: () => true, goBack: jest.fn() }),
  useIsFocused: () => true,
}));
const mockListPending = jest.fn();
jest.mock('../../../api/coachAiExecutionApi', () => ({ coachAiExecutionApi: { listPending: () => mockListPending() } }));

import PendingAiDraftsScreen from '../PendingAiDraftsScreen';
import { COACH_AI_PENDING_DRAFTS_QUERY_KEY } from '../../../hooks/usePendingAiDrafts';
import { blockPlaced, registerBlockSyncClient } from '../../../lib/blockSync';
import { useBlockedUsersStore } from '../../../store/blockedUsersStore';
import { useClosedClientsStore } from '../../../store/closedClientsStore';

it('B4: blocking a client removes the cached workout quoting their chat, but keeps a plain workout', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  registerBlockSyncClient(qc);
  useBlockedUsersStore.setState({ userId: 'coach-1', hydrated: true, blocked: [] });
  useClosedClientsStore.setState({ bySource: {} });
  const plain = {
    id: 'w-plain', subject_user_id: 'client-blocked', capability: 'draft.assign_workout', status: 'pending',
    payload: { notificationBody: 'A plain workout adjustment.' }, provenance: [],
  };
  const open = {
    id: 'n-open', subject_user_id: 'client-open', capability: 'draft.send_notification', status: 'pending',
    payload: { body: 'An allowed check-in.' }, provenance: [],
  };
  const quoted = {
    id: 'w-quoted', subject_user_id: 'client-blocked', capability: 'draft.assign_workout', status: 'pending',
    payload: { notificationBody: 'Quoted chat: I prefer the outdoor walk this week.' },
    provenance: [{ source: 'coach_messages', ref: 'message-from-client-blocked' }],
  };
  qc.setQueryData(COACH_AI_PENDING_DRAFTS_QUERY_KEY, { drafts: [quoted, plain, open] });
  // A fresh post-block server answer applies withoutBlockedSources. A fix may
  // revalidate instead of attempting to resolve message authors on the phone.
  mockListPending.mockReset().mockResolvedValue({ drafts: [plain, open] });
  const view = await render(<QueryClientProvider client={qc}><PendingAiDraftsScreen /></QueryClientProvider>);
  try {
    expect(view.getByTestId('ai-draft-approve-w-quoted')).toBeTruthy();
    expect(mockListPending).not.toHaveBeenCalled();
    await act(async () => { blockPlaced('client-blocked', { displayName: 'Ana Ruiz', role: 'client' }); });
    expect(useBlockedUsersStore.getState().isBlocked('client-blocked')).toBe(true);
    await waitFor(() => expect(view.queryByTestId('ai-draft-approve-w-quoted')).toBeNull());
    expect(view.queryByText(/Quoted chat: I prefer the outdoor walk/)).toBeNull();
    expect(view.getByTestId('ai-draft-approve-w-plain')).toBeTruthy();
    expect(view.getByTestId('ai-draft-approve-n-open')).toBeTruthy();
    expect(view.getByText('Roman has 2 drafts ready')).toBeTruthy();
  } finally {
    await view.unmount();
    qc.clear();
    useBlockedUsersStore.setState({ userId: null, hydrated: false, blocked: [] });
  }
});
