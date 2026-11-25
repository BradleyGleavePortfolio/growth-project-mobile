/**
 * LS-952 B2: a normal block must remove that person's cached drafts from
 * the new Messages hero immediately, just as it removes their inbox row.
 */
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn() }),
  useIsFocused: () => true,
}));
const mockListPending = jest.fn();
jest.mock('../../../api/coachAiExecutionApi', () => ({
  coachAiExecutionApi: { listPending: () => mockListPending() },
}));

import { RomanDraftsHero } from '../inboxStyleB';
import { COACH_AI_PENDING_DRAFTS_QUERY_KEY } from '../../../hooks/usePendingAiDrafts';
import { blockPlaced, registerBlockSyncClient } from '../../../lib/blockSync';
import { useBlockedUsersStore } from '../../../store/blockedUsersStore';

it('drops a newly blocked client from the cached Messages draft count immediately', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  registerBlockSyncClient(client);
  useBlockedUsersStore.setState({ userId: 'coach-1', blocked: [] });
  client.setQueryData(COACH_AI_PENDING_DRAFTS_QUERY_KEY, {
    drafts: [
      { id: 'n1', subject_user_id: 'client-blocked', capability: 'draft.send_notification', status: 'pending', payload: {} },
      { id: 'w1', subject_user_id: 'client-open', capability: 'draft.assign_workout', status: 'pending', payload: {} },
    ],
  });
  const view = await render(
    <QueryClientProvider client={client}><RomanDraftsHero /></QueryClientProvider>,
  );
  try {
    expect(view.getByText('Roman has 2 drafts ready')).toBeTruthy();
    await act(async () => {
      blockPlaced('client-blocked', { displayName: 'Ana Ruiz', role: 'client' });
    });
    expect(useBlockedUsersStore.getState().isBlocked('client-blocked')).toBe(true);
    expect(view.queryByText('Roman has 2 drafts ready')).toBeNull();
    expect(view.getByText('Roman has 1 draft ready')).toBeTruthy();
    expect(mockListPending).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    client.clear();
    useBlockedUsersStore.setState({ userId: null, blocked: [] });
  }
});
