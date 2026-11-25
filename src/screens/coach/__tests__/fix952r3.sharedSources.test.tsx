/**
 * FIX-952R3 (LS-952R3 B2 to B5, the class): every reader of the shared drafts selector (the Messages card, coach Home,
 * the drafts screen) follows every source the phone already has, from one place, usePendingAiDrafts:
 * - a closure from any reader of GET /coach/messages/unread-count, and from a client's chat or nudge gate (B3);
 * - closures saved next to the drafts, restored with them at a cold start; restored words drafts wait for my block list (B2);
 * - a newly heard closure takes out the drafts quoting a chat and reads the queue again; plain ones stay (B4);
 * - a roster read that changed who is on it reads the queue again; an unchanged one does not (B5).
 * And every file that reads the unread counts hands the answer to the one closure source (the class guard).
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { Text } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import { dehydrate, hydrate, QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
// Home reads the unread counts too; an older server's answer (no closed_client_ids) says nothing about closures.
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
import { RomanDraftsHero } from '../inboxStyleB';
import { useCoachHomeV11 } from '../home-v11/useCoachHomeV11';
import type { CoachHomeSources } from '../command-center/coachHomeSources';
import { COACH_AI_PENDING_DRAFTS_QUERY_KEY } from '../../../hooks/usePendingAiDrafts';
import { registerBlockSyncClient } from '../../../lib/blockSync';
import { useBlockedUsersStore } from '../../../store/blockedUsersStore';
import {
  rememberClosedClients,
  rememberUnreadCounts,
  useChatClosureHeard,
  useClosedClientsStore,
} from '../../../store/closedClientsStore';
import { rosterLoaded } from '../../../store/rosterVersion';

const never = () => new Promise<never>(() => undefined);
const sources = { monthSoFar: never, ltv: never, nextPayout: never, atRisk: never } as unknown as CoachHomeSources;
function HomeProbe() {
  const { data: d } = useCoachHomeV11(sources, never);
  return <Text testID="home-drafts">{`${d.draftsWaiting} waiting, ${d.draftKinds.nudges} nudges, ${d.draftKinds.workouts} workouts`}</Text>;
}
function ChatProbe({ closed }: { closed: boolean }) {
  useChatClosureHeard('coach-1', 'client-closed', true, closed);
  return null;
}

type Reader = 'messages_card' | 'coach_home' | 'drafts_screen';
const READERS: Reader[] = ['messages_card', 'coach_home', 'drafts_screen'];
const ui = (reader: Reader) => (reader === 'messages_card' ? <RomanDraftsHero /> : reader === 'coach_home' ? <HomeProbe /> : <PendingAiDraftsScreen />);
/** What a reader shows for `n` drafts, `nudges` of them nudges (the rest workouts). */
const shows = (reader: Reader, n: number, nudges: number) => (reader === 'coach_home'
  ? `${n} waiting, ${nudges} nudges, ${n - nudges} workouts`
  : `Roman has ${n} ${n === 1 ? 'draft' : 'drafts'} ready`);
type View = Awaited<ReturnType<typeof render>>;
const sees = (view: View, reader: Reader, n: number, nudges: number) => (reader === 'coach_home'
  ? view.getByTestId('home-drafts').props.children === shows(reader, n, nudges)
  : view.queryByText(shows(reader, n, nudges)) !== null);

const draft = (id: string, client: string, capability: string, extra: Record<string, unknown> = {}) =>
  ({ id, subject_user_id: client, capability, status: 'pending', payload: {}, ...extra });
const nClosed = draft('n-closed', 'client-closed', 'draft.send_notification');
const wClosed = draft('w-closed', 'client-closed', 'draft.assign_workout');
const nOpen = draft('n-open', 'client-open', 'draft.send_notification');
const wQuoted = draft('w-quoted', 'client-closed', 'draft.assign_workout', { provenance: [{ source: 'coach_messages', ref: 'message-1' }] });
const nMoved = draft('n-moved', 'client-moved', 'draft.send_notification');

let qc: QueryClient;
function freshClient() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  registerBlockSyncClient(qc);
  return qc;
}
const wrap = (node: React.ReactNode) => <QueryClientProvider client={qc}>{node}</QueryClientProvider>;

beforeEach(() => {
  freshClient();
  useBlockedUsersStore.setState({ userId: 'coach-1', hydrated: true, blocked: [] });
  useClosedClientsStore.setState({ bySource: {} });
  mockListPending.mockReset().mockImplementation(never);
});
afterEach(() => {
  qc.clear();
  useBlockedUsersStore.setState({ userId: null, hydrated: false, blocked: [] });
  useClosedClientsStore.setState({ bySource: {} });
});

describe.each(READERS)('on the %s', (reader) => {
  it('B3: an unread-count answer from any reader takes the closed client\'s words draft out, and the next answer brings it back', async () => {
    qc.setQueryData(COACH_AI_PENDING_DRAFTS_QUERY_KEY, { drafts: [nClosed, wClosed, nOpen] });
    const view = await render(wrap(ui(reader)));
    try {
      await waitFor(() => expect(sees(view, reader, 3, 2)).toBe(true));
      await act(async () => { rememberUnreadCounts('coach-1', { data: { by_client: {}, closed_client_ids: ['client-closed'] } }); });
      await waitFor(() => expect(sees(view, reader, 2, 1)).toBe(true));
      await act(async () => { rememberUnreadCounts('coach-1', { data: { by_client: {}, closed_client_ids: [] } }); });
      await waitFor(() => expect(sees(view, reader, 3, 2)).toBe(true));
      expect(mockListPending).not.toHaveBeenCalled();
    } finally {
      await view.unmount();
    }
  });

  it('B3: a client\'s chat or nudge gate saying closed takes it out; saying open again brings it back', async () => {
    qc.setQueryData(COACH_AI_PENDING_DRAFTS_QUERY_KEY, { drafts: [nClosed, wClosed, nOpen] });
    const view = await render(wrap(<><ChatProbe closed={false} />{ui(reader)}</>));
    try {
      await waitFor(() => expect(sees(view, reader, 3, 2)).toBe(true));
      await view.rerender(wrap(<><ChatProbe closed />{ui(reader)}</>));
      await waitFor(() => expect(sees(view, reader, 2, 1)).toBe(true));
      if (reader === 'drafts_screen') expect(view.getByTestId('ai-draft-approve-w-closed')).toBeTruthy();
      await view.rerender(wrap(<><ChatProbe closed={false} />{ui(reader)}</>));
      await waitFor(() => expect(sees(view, reader, 3, 2)).toBe(true));
    } finally {
      await view.unmount();
    }
  });

  it('C4: a closure heard for the signed-in coach applies before their block list is loaded', async () => {
    useBlockedUsersStore.setState({ userId: null, hydrated: false, blocked: [] });
    qc.setQueryData(COACH_AI_PENDING_DRAFTS_QUERY_KEY, { drafts: [nClosed, wClosed, nOpen] });
    const view = await render(wrap(ui(reader)));
    try {
      await waitFor(() => expect(sees(view, reader, 3, 2)).toBe(true));
      await act(async () => { rememberUnreadCounts('coach-1', { data: { closed_client_ids: ['client-closed'] } }); });
      await waitFor(() => expect(sees(view, reader, 2, 1)).toBe(true));
      await act(async () => { rememberUnreadCounts('coach-2', { data: { closed_client_ids: ['client-open'] } }); });
      expect(sees(view, reader, 2, 1)).toBe(true); // another coach's answer is not mine
    } finally {
      await view.unmount();
    }
  });

  it('B2: a closure saved next to the drafts is restored with them at a cold start', async () => {
    qc.setQueryData(COACH_AI_PENDING_DRAFTS_QUERY_KEY, { drafts: [nClosed, wClosed, nOpen] });
    rememberUnreadCounts('coach-1', { data: { closed_client_ids: ['client-closed'] } });
    const saved = dehydrate(qc);
    qc.clear();
    useClosedClientsStore.setState({ bySource: {} }); // a new process: memory is empty, the cache is restored
    hydrate(freshClient(), saved);
    const view = await render(wrap(ui(reader)));
    try {
      expect(sees(view, reader, 2, 1)).toBe(true);
      expect(mockListPending).not.toHaveBeenCalled();
    } finally {
      await view.unmount();
    }
  });

  it('B2: a restored answer\'s words drafts wait until my block list is known; then they show', async () => {
    qc.setQueryData(COACH_AI_PENDING_DRAFTS_QUERY_KEY, { drafts: [nClosed, wClosed, nOpen] }, { updatedAt: 1 });
    useBlockedUsersStore.setState({ userId: null, hydrated: false, blocked: [] });
    const view = await render(wrap(ui(reader)));
    try {
      await waitFor(() => expect(sees(view, reader, 1, 0)).toBe(true)); // the drafts read is held (offline)
      await act(async () => { useBlockedUsersStore.setState({ userId: 'coach-1', hydrated: true, blocked: [] }); });
      await waitFor(() => expect(sees(view, reader, 3, 2)).toBe(true));
    } finally {
      await view.unmount();
    }
  });

  it('B4: a newly heard closure takes out the drafts quoting a chat at once and reads the queue again; plain ones stay', async () => {
    qc.setQueryData(COACH_AI_PENDING_DRAFTS_QUERY_KEY, { drafts: [wQuoted, wClosed, nOpen] });
    mockListPending.mockResolvedValue({ drafts: [wClosed, nOpen] });
    const view = await render(wrap(ui(reader)));
    try {
      await waitFor(() => expect(sees(view, reader, 3, 1)).toBe(true));
      expect(mockListPending).not.toHaveBeenCalled();
      await act(async () => { rememberClosedClients('coach-1', 'inbox', ['client-closed']); });
      await waitFor(() => expect(sees(view, reader, 2, 1)).toBe(true));
      await waitFor(() => expect(mockListPending).toHaveBeenCalledTimes(1));
      if (reader === 'drafts_screen') {
        expect(view.queryByTestId('ai-draft-approve-w-quoted')).toBeNull();
        expect(view.getByTestId('ai-draft-approve-w-closed')).toBeTruthy();
      }
      // The same closure heard again is not new: no second read.
      await act(async () => { rememberUnreadCounts('coach-1', { data: { closed_client_ids: ['client-closed'] } }); });
      expect(mockListPending).toHaveBeenCalledTimes(1);
    } finally {
      await view.unmount();
    }
  });

  it('B5: a roster read that changed who is on it reads the queue again; the same roster does not', async () => {
    qc.setQueryData(COACH_AI_PENDING_DRAFTS_QUERY_KEY, { drafts: [nOpen, nMoved] });
    mockListPending.mockResolvedValue({ drafts: [nOpen] });
    const view = await render(wrap(ui(reader)));
    try {
      await waitFor(() => expect(sees(view, reader, 2, 2)).toBe(true));
      expect(mockListPending).not.toHaveBeenCalled();
      await act(async () => { rosterLoaded('active', ['client-open', `client-of-${reader}`]); });
      await waitFor(() => expect(sees(view, reader, 1, 1)).toBe(true));
      expect(mockListPending).toHaveBeenCalledTimes(1);
      await act(async () => { rosterLoaded('active', [`client-of-${reader}`, 'client-open']); });
      expect(mockListPending).toHaveBeenCalledTimes(1);
    } finally {
      await view.unmount();
    }
  });
});

it('every reader of the unread counts hands its answer to the one closure source', () => {
  const SRC = path.resolve(__dirname, '../../..');
  const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.name === '__tests__' || e.name === '__mocks__') return [];
    return e.isDirectory() ? files(full) : /\.tsx?$/.test(e.name) ? [full] : [];
  });
  const readers = files(SRC).filter((f) => fs.readFileSync(f, 'utf8').includes('coachApi.getUnreadCounts('));
  expect(readers.map((f) => path.relative(SRC, f)).sort()).toEqual([
    'navigation/CoachNavigator.tsx',
    'screens/coach/MessagesScreen.tsx',
    'screens/coach/client-detail/useNudgeGate.ts',
    'screens/coach/cross-pillar/CrossPillarMessagesScreen.tsx',
    'screens/coach/home-v11/useCoachHomeV11.ts',
    'screens/coach/lookup/ClientLookupScreen.tsx',
  ]);
  for (const f of readers) expect(fs.readFileSync(f, 'utf8')).toMatch(/rememberUnreadCounts\(/);
});
