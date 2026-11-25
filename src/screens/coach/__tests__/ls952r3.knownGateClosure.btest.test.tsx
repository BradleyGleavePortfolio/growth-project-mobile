/**
 * LS-952R3: a client file/risk nudge gate already learns closed_client_ids
 * without ever opening Messages. That is the same server-confirmed closure
 * input the legacy Messages writer consumes; shared drafts must not ignore it.
 */
import React from 'react';
import { Text } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-1', role: 'coach' }) }));
jest.mock('../home-v11/blockList', () => ({ useCoachBlockList: () => ({ known: true, blockedIds: [] }) }));
jest.mock('../../../services/api', () => ({
  coachApi: { getUnreadCounts: async () => ({ data: { by_client: {}, closed_client_ids: ['client-closed'] } }) },
}));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn() }),
  useIsFocused: () => true,
}));
const mockListPending = jest.fn();
jest.mock('../../../api/coachAiExecutionApi', () => ({ coachAiExecutionApi: { listPending: () => mockListPending() } }));

import { useNudgeGate } from '../client-detail/useNudgeGate';
import { RomanDraftsHero } from '../inboxStyleB';
import { COACH_AI_PENDING_DRAFTS_QUERY_KEY } from '../../../hooks/usePendingAiDrafts';
import { useBlockedUsersStore } from '../../../store/blockedUsersStore';
import { useClosedClientsStore } from '../../../store/closedClientsStore';
import { closedRefusals } from '../../../components/messaging/closedRefusal';

function GateProbe() {
  const gate = useNudgeGate('client-closed');
  return <Text testID="known-pair">{`${gate.pair}:${String(gate.closed)}`}</Text>;
}

it('B3: a closure already confirmed by the client-file nudge gate leaves the shared cached count', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useBlockedUsersStore.setState({ userId: 'coach-1', hydrated: true, blocked: [] });
  useClosedClientsStore.setState({ bySource: {} });
  closedRefusals.clearAll();
  mockListPending.mockReset();
  qc.setQueryData(COACH_AI_PENDING_DRAFTS_QUERY_KEY, { drafts: [
    { id: 'n-closed', subject_user_id: 'client-closed', capability: 'draft.send_notification', status: 'pending', payload: {} },
    { id: 'w-closed', subject_user_id: 'client-closed', capability: 'draft.assign_workout', status: 'pending', payload: {} },
    { id: 'n-open', subject_user_id: 'client-open', capability: 'draft.send_notification', status: 'pending', payload: {} },
  ] });
  const view = await render(
    <QueryClientProvider client={qc}><GateProbe /><RomanDraftsHero /></QueryClientProvider>,
  );
  try {
    await waitFor(() => expect(view.getByTestId('known-pair').props.children).toBe('them:true'));
    expect(mockListPending).not.toHaveBeenCalled();
    expect(view.getByText('1 Workout')).toBeTruthy();
    await waitFor(() => expect(view.queryByText('Roman has 3 drafts ready')).toBeNull());
    expect(view.getByText('Roman has 2 drafts ready')).toBeTruthy();
  } finally {
    await view.unmount();
    qc.clear();
    useBlockedUsersStore.setState({ userId: null, hydrated: false, blocked: [] });
    closedRefusals.clearAll();
  }
});
