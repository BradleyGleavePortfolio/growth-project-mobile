/**
 * DRAFTS-COUNT-M (owner #197-E5; OPERATOR RULING 17:4x 11-09, which undoes agent 201's D10I-W4 for this count only):
 * the coach Messages card counts Roman's drafts as coach Home does, workout changes included with Path Copilot on, so
 * Home, the card (both coach Messages screens) and the drafts screen headline show one number from one function.
 * OPERATOR RULINGS 15:1x 11-12: the card follows Home exactly while a read is on its way (the partial number) and never
 * hides when Copilot's read fails first. Real inboxStyleB, PathChangeDrafts and the count; mocked at the api edge
 * (coachAiExecutionApi.listPending, copilotApi.pathChangeDrafts) or by seeding the two query keys.
 * Fixture: the renders harness's 'plan' state, 2 workouts, 1 meal plan, 3 nudges and 2 plan changes.
 */
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { act, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }), semanticColors: jest.requireActual('../../../theme/tokens').lightTokens }),
}));
const mockUser: { id: string; role: string } = { id: 'coach-1', role: 'coach' };
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../store/coachStore', () => {
  const state = { clients: [], filterStatus: 'active', loadError: null, loadClients: async () => undefined };
  const useCoachStore = (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state);
  useCoachStore.getState = () => state;
  return { useCoachStore };
});
jest.mock('../../../services/api', () => ({ coachApi: { getUnreadCounts: async () => ({ data: { total: 0, by_client: {} } }) } }));
jest.mock('../../../services/realtime', () => ({ subscribeToMessages: () => () => undefined }));
jest.mock('../../../hooks/useClientUnreadCount', () => ({ useClientUnreadCount: () => 0 }));
jest.mock('../home-v11/blockList', () => ({
  ...jest.requireActual('../home-v11/blockList'),
  useCoachBlockList: () => ({ known: true, blockedIds: [] }),
}));
const mockServerFlags = { messaging_core_v2: true };
jest.mock('../../../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ flags: mockServerFlags }) }));
jest.mock('../broadcasts/BroadcastsEntry', () => ({ BroadcastsEntry: () => null }));
jest.mock('../CommunityReportsEntry', () => ({ CommunityReportsEntry: () => null }));
jest.mock('../CommunityEntry', () => ({ CommunityEntry: () => null }));
jest.mock('../../../ui/layout/Screen', () => ({
  ...jest.requireActual('../../../ui/layout/Screen'),
  useScreenInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), canGoBack: () => false, goBack: jest.fn() }),
  useIsFocused: () => true,
  useFocusEffect: (cb: () => void | (() => void)) => jest.requireActual('react').useEffect(() => cb(), [cb]),
}));
const mockListPending = jest.fn();
jest.mock('../../../api/coachAiExecutionApi', () => ({ coachAiExecutionApi: { listPending: () => mockListPending() } }));
const mockPath = jest.fn();
jest.mock('../../../api/copilotApi', () => {
  const actual = jest.requireActual('../../../api/copilotApi');
  return { ...actual, copilotApi: { ...actual.copilotApi, pathChangeDrafts: () => mockPath() } };
});
jest.mock('../../../api/programsApi', () => ({ programsApi: { assignableClients: async () => [] } }));
// The drafts screen's plan-change cards themselves are not under test here: a stub per card.
jest.mock('../copilot/PathChangeDraftCard', () => ({
  PathChangeDraftCard: ({ draft }: { draft: { id: string } }) =>
    jest.requireActual('react').createElement(jest.requireActual('react-native').Text, { testID: `path-card-${draft.id}` }, draft.id),
}));
const mockInbox = jest.fn();
jest.mock('../../../api/messagingV2Api', () => ({
  messagingV2Api: { getCoachInbox: () => mockInbox() },
  toMessagingError: () => ({ isFeatureDisabled: false, userMessage: 'Not available' }),
  MUTE_LABELS: {},
}));

import MessagesScreen from '../MessagesScreen';
import PendingAiDraftsScreen from '../PendingAiDraftsScreen';
import { RomanDraftsHero } from '../inboxStyleB';
import { PATH_DRAFTS_KEY } from '../copilot/PathChangeDrafts';
import { useCoachHomeV11 } from '../home-v11/useCoachHomeV11';
import type { CoachHomeSources } from '../command-center/coachHomeSources';
import { COACH_AI_PENDING_DRAFTS_QUERY_KEY } from '../../../hooks/usePendingAiDrafts';
import { featureFlags } from '../../../config/featureFlags';
import { blockPlaced, registerBlockSyncClient } from '../../../lib/blockSync';
import { useBlockedUsersStore } from '../../../store/blockedUsersStore';
import { useClosedClientsStore } from '../../../store/closedClientsStore';

const never = () => new Promise<never>(() => undefined);
const draft = (id: string, capability: string, client: string) => ({ id, subject_user_id: client, capability, status: 'pending', payload: {} });
const SIX = [
  draft('w1', 'draft.assign_workout', 'c1'), draft('w2', 'draft.assign_workout', 'c2'), draft('m1', 'draft.assign_meal_plan', 'c3'),
  draft('n1', 'draft.send_notification', 'c4'), draft('n2', 'draft.send_notification', 'c5'), draft('n3', 'draft.send_notification', 'c6'),
];
const PLAN = [
  { id: 'p1', clientId: 'c1', reason: 'Two short nights in a row.', sentAt: '2026-11-12T10:00:00.000Z',
    change: { kind: 'move_session', assignment_id: 'a1', workout: 'Upper body', from_at: '2026-11-13T10:00:00.000Z', to_at: '2026-11-14T10:00:00.000Z' } },
  { id: 'p2', clientId: 'c4', reason: 'Training load went up this week.', sentAt: '2026-11-12T11:00:00.000Z',
    change: { kind: 'set_calorie_target', target_id: 't1', from_kcal: 2100, to_kcal: 2250 } },
];

type Answer = unknown[] | 'never' | 'fail';
const answer = (a: Answer) => (a === 'never' ? never() : a === 'fail' ? Promise.reject(new Error('down')) : Promise.resolve(a));
/** The drafts list's answer (GET /ai/gateway/drafts, status pending) for the same rows. */
const listed = (a: Answer) => (Array.isArray(a) ? Promise.resolve({ drafts: a }) : answer(a));
const homeSources = {
  monthSoFar: never, ltv: never, nextPayout: never, atRisk: never, actionQueue: async () => [],
  pathChangeDrafts: () => mockPath(),
} as unknown as CoachHomeSources;
const homeRetry: { current: (() => Promise<void>) | null } = { current: null };
/** Coach Home through its own hook, with sources whose pathChangeDrafts answers the same rows (the screen passes the flag). */
function HomeProbe() {
  const { data: d, retryDrafts } = useCoachHomeV11(homeSources, never, featureFlags.clientPathCopilot);
  homeRetry.current = retryDrafts;
  return <Text testID="home-count">{`${d.draftsWaiting}|${d.draftsState}|${d.draftKinds.workoutChanges}`}</Text>;
}

let qc: QueryClient;
const wrap = (node: React.ReactNode) => <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
type View = Awaited<ReturnType<typeof render>>;
const numberIn = (s: unknown) => Number(/(\d+)/.exec(String(s))?.[1]);
/** Home's draftsWaiting, the card's number (null: no card) and the drafts screen headline (null: none). */
function counts(view: View) {
  const home = view.queryByTestId('home-count');
  const card = view.queryByTestId('inbox-roman-drafts');
  const screen = view.queryByTestId('pending-ai-drafts-screen');
  const head = screen ? within(screen).queryByText(/^Roman has \d+ drafts? ready$/) : null;
  return {
    home: home ? numberIn(String(home.props.children).split('|')[0]) : null,
    card: card ? numberIn(within(card).getByText(/^Roman has \d+ drafts? ready$/).props.children) : null,
    screen: head ? numberIn(head.props.children) : null,
  };
}
const cardButton = (view: View) => view.queryByTestId('inbox-drafts-open')?.props.accessibilityLabel ?? null;
const homeLine = (view: View) => String(view.getByTestId('home-count').props.children);

type J = { props: Record<string, unknown>; children: (J | string)[] | null };
function findJ(node: unknown, id: string): J | null {
  if (!node || typeof node === 'string') return null;
  if (Array.isArray(node)) { for (const n of node) { const f = findJ(n, id); if (f) return f; } return null; }
  const j = node as J;
  if (j.props?.testID === id) return j;
  return findJ(j.children ?? [], id);
}
/** The loading ghost of Roman's card (InboxSkeleton hero: the 200 pt shape) under the inbox's loading state. */
const ghosts = (view: View) => (findJ(view.toJSON(), 'inbox-loading')?.children ?? [])
  .filter((c) => typeof c !== 'string' && StyleSheet.flatten(c.props.style as object)?.height === 200).length;

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  registerBlockSyncClient(qc);
  useBlockedUsersStore.setState({ userId: 'coach-1', hydrated: true, blocked: [] });
  useClosedClientsStore.setState({ bySource: {} });
  mockUser.role = 'coach';
  mockServerFlags.messaging_core_v2 = true;
  mockListPending.mockReset();
  mockPath.mockReset();
  mockInbox.mockReset().mockResolvedValue({ items: [], total_unread: 0, next_cursor: null, closed_client_ids: [] });
  homeRetry.current = null;
});
afterEach(() => {
  qc.clear();
  jest.restoreAllMocks();
  useBlockedUsersStore.setState({ userId: null, hydrated: false, blocked: [] });
  useClosedClientsStore.setState({ bySource: {} });
});

describe('case 1: flag on, both lists answered', () => {
  it.each([['CoachInboxV2', true], ['the legacy list', false]])('the card on %s counts the workout changes as Home does', async (_name, v2) => {
    mockServerFlags.messaging_core_v2 = v2;
    mockListPending.mockImplementation(() => listed(SIX));
    mockPath.mockImplementation(() => answer(PLAN));
    const view = await render(wrap(<MessagesScreen />));
    try {
      expect(await view.findByText('Roman has 8 drafts ready')).toBeTruthy();
      const card = within(view.getByTestId('inbox-roman-drafts'));
      expect(['2 Workouts', '1 Meal plan', '3 Nudges', '2 Workout changes'].map((t) => !!card.queryByText(t))).toEqual([true, true, true, true]);
      expect(cardButton(view)).toBe("Approve Roman's drafts, 8");
    } finally {
      await view.unmount();
    }
  });
});

describe('case 2: flag on, only plan changes wait', () => {
  it.each([
    [PLAN, 'Roman has 2 drafts ready', '2 Workout changes'],
    [PLAN.slice(0, 1), 'Roman has 1 draft ready', '1 Workout change'],
  ])('the card shows them (%#)', async (rows, title, chip) => {
    mockListPending.mockImplementation(() => listed([]));
    mockPath.mockImplementation(() => answer(rows));
    const view = await render(wrap(<RomanDraftsHero />));
    try {
      expect(await view.findByText(title)).toBeTruthy();
      expect(view.getByText(chip)).toBeTruthy();
    } finally {
      await view.unmount();
    }
  });
});

describe('case 3: flag off', () => {
  it('counts the six drafts in three chips and sends no Copilot read', async () => {
    jest.replaceProperty(featureFlags, 'clientPathCopilot', false);
    mockListPending.mockImplementation(() => listed(SIX));
    mockPath.mockImplementation(() => answer(PLAN));
    const view = await render(wrap(<RomanDraftsHero />));
    try {
      expect(await view.findByText('Roman has 6 drafts ready')).toBeTruthy();
      expect(['2 Workouts', '1 Meal plan', '3 Nudges'].map((t) => !!view.queryByText(t))).toEqual([true, true, true]);
      expect(view.queryByText(/Workout change/)).toBeNull();
      expect(mockPath).not.toHaveBeenCalled();
    } finally {
      await view.unmount();
    }
  });
  it('a Copilot answer kept on the phone from a build with the switch on is not counted', async () => {
    jest.replaceProperty(featureFlags, 'clientPathCopilot', false);
    qc.setQueryData(COACH_AI_PENDING_DRAFTS_QUERY_KEY, { drafts: SIX });
    qc.setQueryData(PATH_DRAFTS_KEY, PLAN);
    mockListPending.mockImplementation(never);
    const view = await render(wrap(<RomanDraftsHero />));
    try {
      expect(view.getByText('Roman has 6 drafts ready')).toBeTruthy();
      expect(view.queryByText(/Workout change/)).toBeNull();
      expect(mockPath).not.toHaveBeenCalled();
    } finally {
      await view.unmount();
    }
  });
});

describe('case 4 (Branch point 1, OPERATOR RULINGS 15:1x): a read with no answer yet; the card follows Home', () => {
  it.each([
    ['Copilot still on its way', SIX, 'never', 6, 'loading'],
    ['Copilot failed with no answer', SIX, 'fail', 6, 'error'],
    ['the list still on its way, Copilot answered', 'never', PLAN, 2, 'loading'],
  ] as [string, Answer, Answer, number, string][])('%s: the partial number, as Home counts it', async (_name, list, path, n, state) => {
    mockListPending.mockImplementation(() => listed(list));
    mockPath.mockImplementation(() => answer(path));
    const view = await render(wrap(<><HomeProbe /><RomanDraftsHero /></>));
    try {
      await waitFor(() => expect(homeLine(view)).toBe(`${n}|${state}|${Array.isArray(path) ? path.length : 0}`));
      await waitFor(() => expect(counts(view)).toEqual({ home: n, card: n, screen: null }));
      expect(cardButton(view)).toBe(`Approve Roman's drafts, ${n}`);
      if (n === 6) expect(view.queryByText(/Workout change/)).toBeNull();
    } finally {
      await view.unmount();
    }
  });
});

describe('case 5: Copilot failed after a good answer', () => {
  it('the last good number stays on the card, as Home keeps its count', async () => {
    mockListPending.mockImplementation(() => listed(SIX));
    mockPath.mockImplementation(() => answer(PLAN));
    const view = await render(wrap(<><HomeProbe /><RomanDraftsHero /></>));
    try {
      await waitFor(() => expect(counts(view)).toEqual({ home: 8, card: 8, screen: null }));
      mockPath.mockImplementation(() => answer('fail'));
      await act(async () => {
        await qc.refetchQueries({ queryKey: PATH_DRAFTS_KEY });
        await homeRetry.current?.();
      });
      await waitFor(() => expect(qc.getQueryState(PATH_DRAFTS_KEY)?.status).toBe('error'));
      await waitFor(() => expect(homeLine(view)).toBe('8|error|2'));
      expect(counts(view)).toEqual({ home: 8, card: 8, screen: null });
      expect(view.getByText('2 Workout changes')).toBeTruthy();
    } finally {
      await view.unmount();
    }
  });
});

describe('case 6: nothing waits', () => {
  it('no card when both lists answer empty', async () => {
    mockListPending.mockImplementation(() => listed([]));
    mockPath.mockImplementation(() => answer([]));
    const view = await render(wrap(<><HomeProbe /><MessagesScreen /></>));
    try {
      await waitFor(() => expect(homeLine(view)).toBe('0|ok|0'));
      expect(view.queryByTestId('inbox-roman-drafts')).toBeNull();
    } finally {
      await view.unmount();
    }
  });
});

describe('case 7: one number, Home, the card and the drafts screen headline', () => {
  const ROWS: [string, boolean, Answer, Answer, { home: number; card: number | null; screen: number | null }][] = [
    ['1 both answered', true, SIX, PLAN, { home: 8, card: 8, screen: 8 }],
    ['2 only plan changes', true, [], PLAN, { home: 2, card: 2, screen: 2 }],
    ['2 one plan change', true, [], PLAN.slice(0, 1), { home: 1, card: 1, screen: 1 }],
    ['3 flag off', false, SIX, PLAN, { home: 6, card: 6, screen: 6 }],
    ['4 Copilot on its way', true, SIX, 'never', { home: 6, card: 6, screen: 6 }],
    ['4 Copilot failed', true, SIX, 'fail', { home: 6, card: 6, screen: 6 }],
    ['4 the list on its way', true, 'never', PLAN, { home: 2, card: 2, screen: 2 }],
    ['6 nothing waits', true, [], [], { home: 0, card: null, screen: null }],
  ];
  it.each(ROWS)('%s', async (_name, flag, list, path, want) => {
    jest.replaceProperty(featureFlags, 'clientPathCopilot', flag);
    mockListPending.mockImplementation(() => listed(list));
    mockPath.mockImplementation(() => answer(path));
    const view = await render(wrap(<><HomeProbe /><RomanDraftsHero /><PendingAiDraftsScreen /></>));
    try {
      await waitFor(() => expect(counts(view)).toEqual(want));
      const drawn = [want.home, want.card, want.screen].filter((v) => v !== null && v > 0);
      expect(new Set(drawn).size).toBeLessThanOrEqual(1);
      if (!flag) expect(mockPath).not.toHaveBeenCalled();
    } finally {
      await view.unmount();
    }
  });
});

describe('case 8: CoachInboxV2 loading draws one Roman card', () => {
  it('only plan changes cached: the real card in the header, no ghost', async () => {
    qc.setQueryData(PATH_DRAFTS_KEY, PLAN);
    mockListPending.mockImplementation(never);
    mockPath.mockImplementation(never);
    mockInbox.mockImplementation(never);
    const view = await render(wrap(<MessagesScreen />));
    try {
      expect(view.getByTestId('inbox-loading')).toBeTruthy();
      expect(view.getByText('Roman has 2 drafts ready')).toBeTruthy();
      expect([view.queryAllByTestId('inbox-roman-drafts').length, ghosts(view)]).toEqual([1, 0]);
    } finally {
      await view.unmount();
    }
  });
  it('nothing cached: the ghost only', async () => {
    mockListPending.mockImplementation(never);
    mockPath.mockImplementation(never);
    mockInbox.mockImplementation(never);
    const view = await render(wrap(<MessagesScreen />));
    try {
      expect(view.getByTestId('inbox-loading')).toBeTruthy();
      expect([view.queryAllByTestId('inbox-roman-drafts').length, ghosts(view)]).toEqual([0, 1]);
    } finally {
      await view.unmount();
    }
  });
});

describe('case 9: a block', () => {
  it("takes the client's words draft out of the card at once; their plan change stays, as on Home and the drafts screen", async () => {
    mockListPending.mockImplementation(() => listed(SIX));
    mockPath.mockImplementation(() => answer(PLAN));
    const view = await render(wrap(<><HomeProbe /><RomanDraftsHero /><PendingAiDraftsScreen /></>));
    try {
      await waitFor(() => expect(counts(view)).toEqual({ home: 8, card: 8, screen: 8 }));
      const reads = mockListPending.mock.calls.length;
      await act(async () => { blockPlaced('c4', { displayName: 'Dee Fox', role: 'client' }); });
      expect(counts(view)).toEqual({ home: 7, card: 7, screen: 7 });
      expect(within(view.getByTestId('inbox-roman-drafts')).getByText('2 Nudges')).toBeTruthy();
      expect(within(view.getByTestId('inbox-roman-drafts')).getByText('2 Workout changes')).toBeTruthy();
      expect(mockListPending.mock.calls.length).toBe(reads);
    } finally {
      await view.unmount();
    }
  });
});
