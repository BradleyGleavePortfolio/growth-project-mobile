/**
 * LS-952R3: the raw drafts cache is persisted, but the new closure store is not.
 * Reproduce a normal cold restart after Messages learned an opposite-party block:
 * restore both raw query answers, open Home or drafts without mounting Messages,
 * and hold the drafts request offline. Allowed nudge and workout must stay.
 */
import React from 'react';
import { Text } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import { dehydrate, hydrate, QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }), semanticColors: jest.requireActual('../../../theme/tokens').lightTokens }),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-1', role: 'coach' }) }));
jest.mock('../../../store/coachStore', () => {
  const state = { clients: [], filterStatus: 'active', loadError: null, loadClients: async () => undefined };
  const useCoachStore = (sel?: (s: typeof state) => unknown) => sel ? sel(state) : state;
  useCoachStore.getState = () => state;
  return { useCoachStore };
});
jest.mock('../../../services/api', () => ({ coachApi: { getUnreadCounts: async () => ({ data: { by_client: {} } }) } }));
jest.mock('../../../hooks/useClientUnreadCount', () => ({ useClientUnreadCount: () => 0 }));
jest.mock('../home-v11/blockList', () => ({
  ...jest.requireActual('../home-v11/blockList'),
  useCoachBlockList: () => ({ known: true, blockedIds: [] }),
}));
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
import { useCoachHomeV11 } from '../home-v11/useCoachHomeV11';
import type { CoachHomeSources } from '../command-center/coachHomeSources';
import { COACH_AI_PENDING_DRAFTS_QUERY_KEY } from '../../../hooks/usePendingAiDrafts';
import { useBlockedUsersStore } from '../../../store/blockedUsersStore';
import { rememberClosedClients, useClosedClientsStore } from '../../../store/closedClientsStore';

const never = () => new Promise<never>(() => undefined);
const sources = { monthSoFar: never, ltv: never, nextPayout: never, atRisk: never } as unknown as CoachHomeSources;
function HomeProbe() {
  const { data } = useCoachHomeV11(sources, never);
  return <Text testID="home-count">{String(data.draftsWaiting)}</Text>;
}

it.each(['home', 'drafts'] as const)(
  'B2: a known closed client does not reappear on %s after ordinary cold-start cache restore',
  async (reader) => {
    const previous = new QueryClient();
    const drafts = [
      { id: 'n-closed', subject_user_id: 'client-closed', capability: 'draft.send_notification', status: 'pending', payload: {} },
      { id: 'w-closed', subject_user_id: 'client-closed', capability: 'draft.assign_workout', status: 'pending', payload: {} },
      { id: 'n-open', subject_user_id: 'client-open', capability: 'draft.send_notification', status: 'pending', payload: {} },
    ];
    previous.setQueryData(COACH_AI_PENDING_DRAFTS_QUERY_KEY, { drafts });
    previous.setQueryData(['messaging', 'v2', 'coach-inbox', 'all'], {
      pages: [{ items: [], total_unread: 0, next_cursor: null, closed_client_ids: ['client-closed'] }],
      pageParams: [null],
    });
    rememberClosedClients('coach-1', 'inbox', ['client-closed']);
    const saved = dehydrate(previous);
    previous.clear();
    // Process restart: only QueryClient data is restored; the new store is in-memory.
    useClosedClientsStore.setState({ bySource: {} });
    useBlockedUsersStore.setState({ userId: 'coach-1', hydrated: true, blocked: [] });
    mockListPending.mockReset().mockImplementation(never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    hydrate(qc, saved);
    const view = await render(
      <QueryClientProvider client={qc}>{reader === 'home' ? <HomeProbe /> : <PendingAiDraftsScreen />}</QueryClientProvider>,
    );
    try {
      expect(qc.getQueryData(['messaging', 'v2', 'coach-inbox', 'all'])).toMatchObject({
        pages: [{ closed_client_ids: ['client-closed'] }],
      });
      // Fresh restored data is reused, exactly as at boot; no server response can repair this assertion.
      expect(mockListPending).not.toHaveBeenCalled();
      if (reader === 'home') {
        await waitFor(() => expect(view.getByTestId('home-count').props.children).toBe('2'));
      } else {
        expect(view.getByTestId('ai-draft-approve-w-closed')).toBeTruthy();
        expect(view.getByTestId('ai-draft-approve-n-open')).toBeTruthy();
        expect(view.queryByTestId('ai-draft-approve-n-closed')).toBeNull();
        expect(view.getByText('Roman has 2 drafts ready')).toBeTruthy();
      }
    } finally {
      await view.unmount();
      qc.clear();
      useBlockedUsersStore.setState({ userId: null, hydrated: false, blocked: [] });
    }
  },
);
