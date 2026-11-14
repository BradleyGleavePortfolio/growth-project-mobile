/**
 * CHECKIN-DRAFT-M (owner #203-E14 "A and drafts list"; OPERATOR RULINGS w203ci: REC 1 one drafts list, main's; REC 2
 * no chip): a draft Roman wrote for a client's check-in is drawn in main's Roman's drafts list as layout B's card
 * (the client's name, Check-in · {day}, Roman's text, Drafted by Roman, Not sent, Review draft, Back to check-in), and
 * the one count (DRAFTS-COUNT-M) counts it, so the headline, coach Home and the Messages card agree with the cards.
 * The real PendingAiDraftsScreen, inboxStyleB card, Home's hook and the sheet; services/api mocked at its edge
 * (the drafts queue through coachAiExecutionApi.listPending, as draftsCountM.test.tsx does).
 */
import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }), semanticColors: jest.requireActual('../../../theme/tokens').lightTokens, colorScheme: 'light' }),
}));
const mockUser: { id: string; role: string } = { id: 'coach-1', role: 'coach' };
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
const mockRoster = { clients: [{ id: 'client-1', firstName: 'Jordan', lastName: 'Reyes', email: 'j@example.test', status: 'active' }] as unknown[] };
jest.mock('../../../store/coachStore', () => {
  const state = { get clients() { return mockRoster.clients; }, filterStatus: 'active', loadError: null, loadClients: async () => undefined };
  const useCoachStore = (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state);
  useCoachStore.getState = () => state;
  return { useCoachStore };
});
const mockPatch = jest.fn();
const mockPost = jest.fn();
const mockCheckIns = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { patch: (...a: unknown[]) => mockPatch(...a), post: (...a: unknown[]) => mockPost(...a), get: jest.fn() },
  coachApi: {
    getUnreadCounts: async () => ({ data: { total: 0, by_client: {} } }),
    getClientCheckIns: (...a: unknown[]) => mockCheckIns(...a),
  },
}));
jest.mock('../../../services/realtime', () => ({ subscribeToMessages: () => () => undefined }));
jest.mock('../../../hooks/useClientUnreadCount', () => ({ useClientUnreadCount: () => 0 }));
jest.mock('../home-v11/blockList', () => ({
  ...jest.requireActual('../home-v11/blockList'),
  useCoachBlockList: () => ({ known: true, blockedIds: [] }),
}));
jest.mock('../../../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ flags: { messaging_core_v2: true } }) }));
jest.mock('../../../ui/layout/Screen', () => ({
  ...jest.requireActual('../../../ui/layout/Screen'),
  useScreenInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate, canGoBack: () => false, goBack: jest.fn() }),
  useIsFocused: () => true,
  useFocusEffect: (cb: () => void | (() => void)) => jest.requireActual('react').useEffect(() => cb(), [cb]),
}));
const mockListPending = jest.fn();
jest.mock('../../../api/coachAiExecutionApi', () => {
  const actual = jest.requireActual('../../../api/coachAiExecutionApi');
  return { ...actual, coachAiExecutionApi: { ...actual.coachAiExecutionApi, listPending: () => mockListPending() } };
});
jest.mock('../../../api/copilotApi', () => {
  const actual = jest.requireActual('../../../api/copilotApi');
  return { ...actual, copilotApi: { ...actual.copilotApi, pathChangeDrafts: async () => [] } };
});
jest.mock('../../../api/programsApi', () => ({ programsApi: { assignableClients: async () => [] } }));

import PendingAiDraftsScreen from '../PendingAiDraftsScreen';
import { RomanDraftsHero } from '../inboxStyleB';
import { romanDraftsCount } from '../romanDraftsCount';
import { useCoachHomeV11 } from '../home-v11/useCoachHomeV11';
import type { CoachHomeSources } from '../command-center/coachHomeSources';
import { featureFlags } from '../../../config/featureFlags';
import { useBlockedUsersStore } from '../../../store/blockedUsersStore';
import { useClosedClientsStore } from '../../../store/closedClientsStore';

const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const TODAY = localDay();
const REPLY = 'Hi Jordan, thanks for checking in. What helped you make that space this week?';
/** A draft bound to a check-in, as both reads answer it (b#1234 CONTRACT: payload {clientId, body}, the check_in entry). */
const bound = (id: string, client: string, ref: string, date = TODAY, body = REPLY) => ({
  id, capability: 'draft.coach_message', status: 'pending', subject_user_id: client, tenant_coach_id: 'coach-1', created_at: '2026-11-13T10:00:00.000Z',
  payload: { clientId: client, body },
  provenance: [
    { source: 'coach_messages', ref: 'm-1', count: 1, hash: 'h0', origin: 'local' },
    { source: 'check_in', ref, count: 1, hash: 'h1', origin: 'local', date },
  ],
});
const stream2 = (id: string, client: string) => ({
  id, capability: 'draft.assign_workout', status: 'pending', subject_user_id: client, tenant_coach_id: 'coach-1', created_at: '2026-11-13T09:00:00.000Z',
  payload: { workoutPlanId: 'w', scheduledFor: '2026-11-20T09:00:00.000Z' },
});
const unbound = { id: 'u-1', capability: 'draft.coach_message', status: 'pending', subject_user_id: 'client-1', payload: { clientId: 'client-1', body: 'A Home ask.' }, provenance: [{ source: 'coach_messages', ref: 'm-1' }] };
const wearable = { id: 'wm-1', capability: 'draft.coach_wearable_message', status: 'pending', subject_user_id: 'client-1', payload: { body: 'Sleep note.' } };

const never = () => new Promise<never>(() => undefined);
const homeSources = { monthSoFar: never, ltv: never, nextPayout: never, atRisk: never, actionQueue: async () => [], pathChangeDrafts: async () => [] } as unknown as CoachHomeSources;
function HomeProbe() {
  const { data: d } = useCoachHomeV11(homeSources, never, false);
  return <Text testID="home-count">{`${d.draftsWaiting}|${d.draftsState}|${JSON.stringify(d.draftKinds)}`}</Text>;
}

let qc: QueryClient;
const wrap = (node: React.ReactNode) => <QueryClientProvider client={qc}>{node}</QueryClientProvider>;

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  jest.replaceProperty(featureFlags, 'clientPathCopilot', false);
  useBlockedUsersStore.setState({ userId: 'coach-1', hydrated: true, blocked: [] });
  useClosedClientsStore.setState({ bySource: {} });
  mockListPending.mockReset();
  mockPatch.mockReset().mockResolvedValue({ data: { id: 'd-7', status: 'approved' } });
  mockPost.mockReset();
  mockCheckIns.mockReset().mockResolvedValue({ data: [{ id: 'ci-7', user_id: 'client-1', date: `${TODAY}T00:00:00.000Z`, notes: 'Busy week, sessions done.', mood: 4, energy: 3, sleep_hours: 7 }] });
  mockNavigate.mockReset();
});
afterEach(() => {
  qc.clear();
  jest.restoreAllMocks();
  useBlockedUsersStore.setState({ userId: null, hydrated: false, blocked: [] });
});

describe('CHECKIN-DRAFT-M: the check-in card in Roman\'s drafts list', () => {
  it('case 17: a bound row draws the B card with the roster name and Check-in · Today; unbound and wearable rows stay undrawn; the Stream 2 card is unchanged', async () => {
    mockListPending.mockResolvedValue({ drafts: [bound('d-7', 'client-1', 'ci-7'), unbound, wearable, stream2('w-1', 'client-2')] });
    const view = await render(wrap(<PendingAiDraftsScreen />));
    const card = within(await view.findByTestId('checkin-draft-card-d-7'));
    expect(card.getByText('Jordan Reyes')).toBeTruthy();
    expect(card.getByText('Check-in · Today')).toBeTruthy();
    expect(card.getByText(REPLY)).toBeTruthy();
    expect(card.getByText('Drafted by Roman')).toBeTruthy();
    expect(card.getByText('Not sent')).toBeTruthy();
    expect(card.getByText('Review draft')).toBeTruthy();
    expect(card.getByText('Back to check-in')).toBeTruthy();
    expect(view.queryByText('A Home ask.')).toBeNull();
    expect(view.queryByText('Sleep note.')).toBeNull();
    expect(view.queryByTestId('checkin-draft-card-u-1')).toBeNull();
    expect(view.getByTestId('ai-draft-card-draft.assign_workout')).toBeTruthy();
    expect(view.getByText('Workout suggestion')).toBeTruthy();
    expect(view.getByText('Roman has 2 drafts ready')).toBeTruthy();
  });

  it('case 17: an older day reads as its date; a client not on the roster keeps main\'s card label', async () => {
    mockListPending.mockResolvedValue({ drafts: [bound('d-8', 'abcdef12-3456-7890', 'ci-8', '2026-11-03')] });
    const view = await render(wrap(<PendingAiDraftsScreen />));
    const card = within(await view.findByTestId('checkin-draft-card-d-8'));
    expect(card.getByText('client abcdef12')).toBeTruthy();
    expect(card.getByText('Check-in · Nov 3')).toBeTruthy();
  });

  it('case 18: one Stream 2 draft and one bound draft read 2 on the headline, coach Home and the Messages card; the chips show only the Stream 2 kind', async () => {
    mockListPending.mockResolvedValue({ drafts: [bound('d-7', 'client-1', 'ci-7'), stream2('w-1', 'client-2')] });
    const view = await render(wrap(<><HomeProbe /><RomanDraftsHero /><PendingAiDraftsScreen /></>));
    await waitFor(() => expect(String(view.getByTestId('home-count').props.children)).toMatch(/^2\|ok\|/));
    const heroCard = within(view.getByTestId('inbox-roman-drafts'));
    expect(heroCard.getByText('Roman has 2 drafts ready')).toBeTruthy();
    expect(heroCard.getByText('1 Workout')).toBeTruthy();
    expect(heroCard.queryByText(/Check-in/)).toBeNull();
    expect(view.getAllByText('Roman has 2 drafts ready')).toHaveLength(2);
    expect(JSON.parse(String(view.getByTestId('home-count').props.children).split('|')[2])).toEqual({ workouts: 1, mealPlans: 0, nudges: 0, workoutChanges: 0 });
  });

  it('case 18: the one count as a unit counts each bound row once and no other coach_message row', async () => {
    const rows = [bound('d-7', 'client-1', 'ci-7'), bound('d-9', 'client-2', 'ci-9'), unbound, wearable, stream2('w-1', 'client-2')];
    const c = romanDraftsCount(rows, 'ok', null);
    expect(c.waiting).toBe(3);
    expect(c.kinds).toEqual({ workouts: 1, mealPlans: 0, nudges: 0, workoutChanges: 0 });
    expect(romanDraftsCount([bound('d-7', 'client-1', 'ci-7')], 'ok', { n: 2, state: 'ok' }).waiting).toBe(3);
  });

  it('case 19: a block on the client takes the bound draft out of the list and the count at once, with no new read', async () => {
    mockListPending.mockResolvedValue({ drafts: [bound('d-7', 'client-1', 'ci-7'), stream2('w-1', 'client-2')] });
    const view = await render(wrap(<><RomanDraftsHero /><PendingAiDraftsScreen /></>));
    await view.findByTestId('checkin-draft-card-d-7');
    const reads = mockListPending.mock.calls.length;
    await act(async () => { useBlockedUsersStore.setState({ blocked: [{ id: 'client-1', displayName: 'Jordan Reyes' } as never] }); });
    await waitFor(() => expect(view.queryByTestId('checkin-draft-card-d-7')).toBeNull());
    expect(view.getAllByText('Roman has 1 draft ready')).toHaveLength(2);
    expect(mockListPending.mock.calls.length).toBe(reads);
  });

  it('case 20: Review draft opens the sheet at ready with that day\'s check-in; Send sends that draft', async () => {
    mockListPending.mockResolvedValue({ drafts: [bound('d-7', 'client-1', 'ci-7')] });
    const view = await render(wrap(<PendingAiDraftsScreen />));
    await fireEvent.press(await view.findByLabelText('Review draft'));
    expect(await view.findByText("Roman's draft for Jordan")).toBeTruthy();
    expect(view.getByTestId('checkin-draft-text').props.children).toBe(REPLY);
    expect(mockPost).not.toHaveBeenCalled();
    await waitFor(() => expect(within(view.getByTestId('checkin-draft-source')).getByText('Busy week, sessions done.')).toBeTruthy());
    expect(mockCheckIns).toHaveBeenCalledWith('client-1', { from: TODAY, to: TODAY });
    expect(view.getByText('Jordan Reyes · Check-in')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('Send to Jordan'));
    expect(await view.findByText('Sent by you in Messages.')).toBeTruthy();
    expect(mockPatch.mock.calls).toEqual([['/ai/gateway/drafts/d-7', { decision: 'approved' }]]);
  });

  it('case 20: the source read failing leaves the panel out and the draft still sends', async () => {
    mockCheckIns.mockRejectedValue(new Error('Network Error'));
    mockListPending.mockResolvedValue({ drafts: [bound('d-7', 'client-1', 'ci-7')] });
    const view = await render(wrap(<PendingAiDraftsScreen />));
    await fireEvent.press(await view.findByLabelText('Review draft'));
    await view.findByText("Roman's draft for Jordan");
    await waitFor(() => expect(mockCheckIns).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(view.queryByTestId('checkin-draft-source')).toBeNull();
    await fireEvent.press(view.getByLabelText('Send to Jordan'));
    expect(await view.findByText('Sent by you in Messages.')).toBeTruthy();
  });

  it('case 20: Back to check-in opens that client\'s file on the Timeline', async () => {
    mockListPending.mockResolvedValue({ drafts: [bound('d-7', 'client-1', 'ci-7')] });
    const view = await render(wrap(<PendingAiDraftsScreen />));
    await fireEvent.press(await view.findByLabelText('Back to check-in'));
    expect(mockNavigate).toHaveBeenCalledWith('ClientDetail', { clientId: 'client-1', clientName: 'Jordan Reyes', initialTab: 'timeline' });
  });
});
