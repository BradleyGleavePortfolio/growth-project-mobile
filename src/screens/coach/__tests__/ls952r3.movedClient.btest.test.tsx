/**
 * LS-952R3: normal 45-client coach, one client moves away. Home finishes its
 * ordinary roster refresh (44 remain), but the fresh raw drafts cache still
 * counts the former client's draft. All 45 rows fit the existing server page.
 */
import React from 'react';
import { Text } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockGetClients = jest.fn();
jest.mock('../../../services/api', () => ({ coachApi: {
  getClients: (...args: unknown[]) => mockGetClients(...args),
  getUnreadCounts: async () => ({ data: { by_client: {}, closed_client_ids: [] } }),
} }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-1', role: 'coach' }) }));
jest.mock('../../../hooks/useClientUnreadCount', () => ({ useClientUnreadCount: () => 0 }));
jest.mock('../home-v11/blockList', () => ({
  ...jest.requireActual('../home-v11/blockList'),
  useCoachBlockList: () => ({ known: true, blockedIds: [] }),
}));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => true,
}));
const mockListPending = jest.fn();
jest.mock('../../../api/coachAiExecutionApi', () => ({ coachAiExecutionApi: { listPending: () => mockListPending() } }));

import { useCoachHomeV11 } from '../home-v11/useCoachHomeV11';
import type { CoachHomeSources } from '../command-center/coachHomeSources';
import { useCoachStore } from '../../../store/coachStore';
import { useBlockedUsersStore } from '../../../store/blockedUsersStore';
import { useClosedClientsStore } from '../../../store/closedClientsStore';
import { COACH_AI_PENDING_DRAFTS_QUERY_KEY } from '../../../hooks/usePendingAiDrafts';

const never = () => new Promise<never>(() => undefined);
const sources = { monthSoFar: never, ltv: never, nextPayout: never, atRisk: never } as unknown as CoachHomeSources;
function HomeProbe() {
  const { data } = useCoachHomeV11(sources, never);
  const roster = useCoachStore((s) => s.clients.length);
  return <><Text testID="verified-roster">{String(roster)}</Text><Text testID="draft-count">{String(data.draftsWaiting)}</Text></>;
}

it('B5: a completed 44-of-45 roster refresh removes the moved client from the cached Home draft count', async () => {
  useCoachStore.getState().reset();
  useBlockedUsersStore.setState({ userId: 'coach-1', hydrated: true, blocked: [] });
  useClosedClientsStore.setState({ bySource: {} });
  const current = Array.from({ length: 44 }, (_, i) => ({
    id: `client-${i}`, name: `Client ${i}`, role: 'student', coach_id: 'coach-1', archived_at: null,
  }));
  mockGetClients.mockReset().mockResolvedValue({ data: current });
  const rows = Array.from({ length: 45 }, (_, i) => ({
    id: `n-${i}`, subject_user_id: `client-${i}`, capability: 'draft.send_notification', status: 'pending', payload: {},
  }));
  mockListPending.mockReset().mockResolvedValue({ drafts: rows.filter((d) => d.subject_user_id !== 'client-44') });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(COACH_AI_PENDING_DRAFTS_QUERY_KEY, { drafts: rows });
  const view = await render(<QueryClientProvider client={qc}><HomeProbe /></QueryClientProvider>);
  try {
    await waitFor(() => expect(mockGetClients).toHaveBeenCalled());
    await waitFor(() => expect(view.getByTestId('verified-roster').props.children).toBe('44'));
    expect(useCoachStore.getState().clients.some((c) => c.id === 'client-44')).toBe(false);
    expect(useCoachStore.getState().loadError).toBeNull();
    await waitFor(() => expect(view.getByTestId('draft-count').props.children).toBe('44'));
  } finally {
    await view.unmount();
    qc.clear();
    useCoachStore.getState().reset();
    useBlockedUsersStore.setState({ userId: null, hydrated: false, blocked: [] });
  }
});
