/**
 * FIX-952R3 (LS-952R3 B1, LO-952R3 C1, the class): every reader of the shared drafts selector (the Messages card,
 * coach Home, the drafts screen) counts the coach's whole queue, read through the real API wrapper from the server's
 * paged queue (backend ai-gateway.controller.ts listDrafts `order=oldest`, `after`, ai-approval.service.ts pageQueue),
 * pages the server filtered short or wholly included, not the route's default newest 50.
 */
import React from 'react';
import { Text } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }), semanticColors: jest.requireActual('../../../theme/tokens').lightTokens }),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-1', role: 'coach' }) }));
jest.mock('../../../store/coachStore', () => {
  const state = { clients: [], filterStatus: 'active', loadError: null, loadClients: async () => undefined };
  const useCoachStore = (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state);
  useCoachStore.getState = () => state;
  return { useCoachStore };
});
const mockGet = jest.fn();
// The drafts read goes through the real wrapper to this transport; Home's unread read says nothing about closures.
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: (...args: unknown[]) => mockGet(...args) },
  coachApi: { getUnreadCounts: async () => ({ data: { by_client: {} } }) },
}));
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

import PendingAiDraftsScreen from '../PendingAiDraftsScreen';
import { RomanDraftsHero } from '../inboxStyleB';
import { useCoachHomeV11 } from '../home-v11/useCoachHomeV11';
import type { CoachHomeSources } from '../command-center/coachHomeSources';
import { _setMockModeForTesting } from '../../../api/coachAiExecutionApi';
import { registerBlockSyncClient } from '../../../lib/blockSync';
import { useBlockedUsersStore } from '../../../store/blockedUsersStore';
import { useClosedClientsStore } from '../../../store/closedClientsStore';

const never = () => new Promise<never>(() => undefined);
const sources = { monthSoFar: never, ltv: never, nextPayout: never, atRisk: never } as unknown as CoachHomeSources;
function HomeProbe() {
  const { data: d } = useCoachHomeV11(sources, never);
  return <Text testID="home-drafts">{`${d.draftsWaiting} waiting, ${d.draftKinds.nudges} nudges, ${d.draftKinds.workouts} workouts`}</Text>;
}

type Reader = 'messages_card' | 'coach_home' | 'drafts_screen';
const READERS: Reader[] = ['messages_card', 'coach_home', 'drafts_screen'];
const ui = (reader: Reader) => (reader === 'messages_card' ? <RomanDraftsHero /> : reader === 'coach_home' ? <HomeProbe /> : <PendingAiDraftsScreen />);
type View = Awaited<ReturnType<typeof render>>;
const sees = (view: View, reader: Reader, n: number) => (reader === 'coach_home'
  ? view.getByTestId('home-drafts').props.children === `${n} waiting, ${n / 2} nudges, ${n / 2} workouts`
  : view.queryByText(`Roman has ${n} drafts ready`) !== null);

// 45 clients, a nudge and a workout each (90 drafts), oldest first, among 40 rows the server leaves out of its answer.
const queue = Array.from({ length: 45 }, (_, i) => [
  { id: `n-${i}`, subject_user_id: `client-${i}`, capability: 'draft.send_notification', status: 'pending', payload: {} },
  { id: `w-${i}`, subject_user_id: `client-${i}`, capability: 'draft.assign_workout', status: 'pending', payload: {} },
]).flat();
const scanned = [
  ...queue.slice(0, 30),
  ...Array.from({ length: 40 }, (_, i) => ({ id: `gone-${i}`, gone: true })), // a page wholly filtered, one part filtered
  ...queue.slice(30),
];
const SCAN = 35; // rows the server looks at per page; it answers only those it keeps, so a page can be short or empty

let qc: QueryClient;
beforeEach(() => {
  _setMockModeForTesting('off');
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  registerBlockSyncClient(qc);
  useBlockedUsersStore.setState({ userId: 'coach-1', hydrated: true, blocked: [] });
  useClosedClientsStore.setState({ bySource: {} });
  mockGet.mockReset().mockImplementation(async (_path: string, options?: { params?: Record<string, string> }) => {
    const params = options?.params ?? {};
    if (params.order !== 'oldest') return { data: [...queue].reverse().slice(0, 50) }; // the route's default: newest 50
    const start = params.after ? scanned.findIndex((r) => r.id === params.after) + 1 : 0;
    const seen = scanned.slice(start, start + SCAN);
    const items = seen.filter((r) => !('gone' in r));
    const more = start + seen.length < scanned.length;
    return { data: { items, total: queue.length, next_cursor: more ? seen[seen.length - 1].id : null } };
  });
});
afterEach(() => {
  qc.clear();
  useBlockedUsersStore.setState({ userId: null, hydrated: false, blocked: [] });
  useClosedClientsStore.setState({ bySource: {} });
});

describe.each(READERS)('on the %s', (reader) => {
  it('B1: all 90 drafts for 45 clients count, read to the end through pages the server filtered short or wholly', async () => {
    const view = await render(<QueryClientProvider client={qc}>{ui(reader)}</QueryClientProvider>);
    try {
      await waitFor(() => expect(sees(view, reader, 90)).toBe(true));
      const pages = mockGet.mock.calls.filter(([, o]) => o?.params?.order === 'oldest');
      expect(pages).toHaveLength(Math.ceil(scanned.length / SCAN)); // a short and an empty page did not end the read
      expect(sees(view, reader, 50)).toBe(false);
    } finally {
      await view.unmount();
    }
  });
});
