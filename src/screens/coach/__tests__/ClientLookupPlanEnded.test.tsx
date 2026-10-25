/**
 * RENEWAL3 L1-L3 (LOOKUP-FILTER): "Plan ended last 7 days {n}" in the Clients lookup, from CHURN-M's server list
 * (b#1130's GET /v1/coach/churned-clients, read with readPlanEnded as the coach Home reads it). The chip shows only while
 * the server answers with the list; {n} is the server's `total`; picked, it lists only this coach's own clients.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

const [mockGetClients, mockUnread, mockGet, mockPost, mockApprove, mockReject] = Array.from({ length: 6 }, () => jest.fn());
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a) },
  coachApi: { getClients: (...a: unknown[]) => mockGetClients(...a), getUnreadCounts: () => mockUnread(), sendNudge: jest.fn() },
}));
jest.mock('../../../api/coachAiExecutionApi', () => ({
  coachAiExecutionApi: { approveDraft: (id: string) => mockApprove(id), rejectDraft: (id: string) => mockReject(id) },
}));
jest.mock('../../../storage/mmkv', () => ({ cacheStorage: { getStringAsync: async () => undefined, set: async () => undefined } }));
jest.mock('../../../ui/haptics/haptics.service', () => ({ HapticService: { success: jest.fn(), error: jest.fn(), warning: jest.fn(), selection: jest.fn(), softImpact: jest.fn() } }));
let mockCoach = 'coach-1';
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: mockCoach, role: 'coach' }) }));
jest.mock('../../../theme/ThemeProvider', () => {
  const anyColor = new Proxy({}, { get: () => '#000000' });
  return { useTheme: () => ({ colors: anyColor, semanticColors: anyColor }) };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
const mockText = (t: string) => React.createElement(jest.requireActual('react-native').Text, null, t);
jest.mock('../../../ui', () => ({ Overline: jest.requireActual('react-native').Text, useScreenInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../../../ui/states/QuietStates', () => ({ QuietLoading: () => mockText('Loading'), QuietError: (p: { message: string }) => mockText(p.message) }));
jest.mock('../../../ui/empty-states', () => ({
  EmptyStateNoResults: (p: { onClearSearch: () => void }) => {
    const { Pressable } = jest.requireActual('react-native');
    return jest.requireActual('react').createElement(Pressable, { testID: 'stub-clear', onPress: p.onClearSearch }, mockText('No results'));
  },
}));
jest.mock('../../../components/HapticPressable', () => jest.requireActual('react-native').Pressable);
jest.mock('../lookup/ClientPeekSheet', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../components/home/PushPermissionCard', () => () => null);
jest.mock('../../../navigation/coachLanding', () => ({ coachLandingTab: () => 'CoachHome' }));

import ClientLookupScreen from '../lookup/ClientLookupScreen';
import { useCoachStore } from '../../../store/coachStore';
import { useBlockedUsersStore } from '../../../store/blockedUsersStore';

const wire = (id: string, name: string) => ({
  id, name, email: `${id}@example.com`, created_at: '2026-08-01T10:00:00.000Z',
  activity: { shared: true, last_active_on: '2026-10-20', check_ins_to_review: 0, last_workout_on: null },
});
const NAMES = ['Ana Lopez', 'Ava Price', 'Ben Carter', 'Bianca Shah', 'Chloe Dunn', 'Dev Patel', 'Elena Ruiz', 'Finn Walsh',
  'Grace Kim', 'Lena Fischer', 'Maya Ortiz', 'Omar Haddad', 'Sam Okafor', 'Theo Grant', 'Uma Reyes'];
const ROSTER = NAMES.map((n) => wire(n.split(' ')[0].toLowerCase(), n));
const row = (id: string, name: string, days: number, pkg = '12-week block', messaged: string | null = null) => ({
  client_id: id, first_name: name.split(' ')[0], name, avatar_url: null, ended_at: '2026-10-21T09:00:00Z', ended_on: '2026-10-21',
  days_since: days, group: days === 0 ? 'today' : 'this_week', package_name: pkg, last_coach_message_at: messaged,
});
// Newest end first, as the server sends it; "gone" is not on this coach's list.
const ROWS = [row('maya', 'Maya Ortiz', 0), row('dev', 'Dev Patel', 0, 'Monthly coaching'), row('sam', 'Sam Okafor', 1, 'Monthly coaching', '2026-10-20T15:00:00Z'),
  row('gone', 'Gone Client', 2), row('lena', 'Lena Fischer', 3)];
const page = (items: unknown[], extra: Record<string, unknown> = {}) => ({ time_zone: 'America/Los_Angeles', today: '2026-10-21', total: items.length, today_count: 2, items, next_cursor: null, ...extra });
const http404 = () => Promise.reject(Object.assign(new Error('404'), { response: { status: 404, data: { code: 'PLAN_RENEWAL_OFF' } } }));
let churned: (params: { cursor?: string }) => Promise<unknown>;
const navigate = jest.fn();
const nav = { navigate, setParams: jest.fn(), isFocused: () => true, addListener: () => () => undefined, getParent: () => ({ navigate, addListener: () => () => undefined }) } as never;
const churnReads = () => mockGet.mock.calls.filter(([url]) => url === '/v1/coach/churned-clients').length;

beforeEach(() => {
  jest.clearAllMocks();
  useCoachStore.getState().reset();
  mockCoach = 'coach-1';
  mockGetClients.mockImplementation(async (status: string) => ({ data: status === 'archived' ? [wire('old', 'Zed Old')] : ROSTER }));
  mockUnread.mockResolvedValue({ data: { total: 0, by_client: {} } });
  churned = () => Promise.resolve({ data: page(ROWS, { total: 7 }) });
  mockGet.mockImplementation((url: string, cfg: { params: { cursor?: string } }) => (url === '/v1/coach/churned-clients' ? churned(cfg.params) : Promise.reject(new Error(url))));
  mockPost.mockResolvedValue({ data: { enabled: true, reply: 'Hi Maya, how did the block feel?', approval: { required: true, status: 'pending', draft_id: 'dr-9' }, reason: { kind: 'plan_ended' } } });
  mockApprove.mockResolvedValue({ ok: true });
});

async function mount() {
  const view = await render(<ClientLookupScreen navigation={nav} />);
  await waitFor(() => expect(screen.getByTestId('lookup-count')).toBeTruthy());
  await waitFor(() => expect(screen.queryByText('Loading')).toBeNull()); // this phone's block list is read first
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return view;
}
const refresh = () => act(async () => { await screen.getByTestId('lookup-scroll').props.refreshControl.props.onRefresh(); });
const ids = (re: RegExp) => screen.getAllByTestId(re).map((n) => n.props.testID as string).filter((id, i, all) => all.indexOf(id) === i);
const chipIds = () => ids(/^lookup-chip-/);
const rowIds = () => ids(/^lookup-row-/);

describe('L1: the chip', () => {
  it("sits before Archived and counts the server's total, never one page's rows", async () => {
    churned = (p) => Promise.resolve({ data: p.cursor ? page(ROWS.slice(3), { total: 7 }) : page(ROWS.slice(0, 3), { total: 7, next_cursor: 'k' }) });
    await mount();
    expect(chipIds()).toEqual(['lookup-chip-review', 'lookup-chip-messages', 'lookup-chip-quiet', 'lookup-chip-new', 'lookup-chip-ended', 'lookup-chip-archived']);
    expect(within(screen.getByTestId('lookup-chip-ended')).getByText('Plan ended last 7 days 7')).toBeTruthy(); // RN3-38
    expect(screen.getByTestId('lookup-chip-ended').props.accessibilityLabel).toBe('Plan ended last 7 days, 7');
    expect(screen.getByTestId('lookup-chip-ended').props.accessibilityState).toEqual({ selected: false });
    expect(churnReads()).toBe(2); // both pages
  });
  it.each([
    ['off on this server (404)', http404],
    ['not the list', () => Promise.resolve({ data: { roster_size: 3 } })],
    ['not loaded', () => Promise.reject(new Error('Network Error'))],
  ])('is not there when the list is %s', async (_, answer) => {
    churned = answer;
    await mount();
    expect(screen.queryByTestId('lookup-chip-ended')).toBeNull();
    expect(screen.getByTestId('lookup-chip-archived')).toBeTruthy();
  });
  it('keeps the last count when a re-read fails, and goes when the server turns the list off', async () => {
    await mount();
    churned = () => Promise.reject(new Error('Network Error'));
    await refresh();
    expect(screen.getByTestId('lookup-chip-ended').props.accessibilityLabel).toBe('Plan ended last 7 days, 7');
    churned = http404;
    await refresh();
    expect(screen.queryByTestId('lookup-chip-ended')).toBeNull();
  });
  it('is not on the archived list', async () => {
    await mount();
    await fireEvent.press(screen.getByTestId('lookup-chip-archived'));
    await waitFor(() => expect(screen.getByText('1 archived client')).toBeTruthy());
    expect(screen.queryByTestId('lookup-chip-ended')).toBeNull();
  });
  it("never shows one coach's list to another coach", async () => {
    const view = await mount();
    mockCoach = 'coach-2';
    churned = () => Promise.reject(new Error('Network Error'));
    await view.rerender(<ClientLookupScreen navigation={nav} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await waitFor(() => expect(screen.getByTestId('lookup-chip-archived')).toBeTruthy());
    expect(screen.queryByTestId('lookup-chip-ended')).toBeNull();
  });
});

describe('L2: picked', () => {
  it("lists only this coach's clients whose plan ended, newest first, with RN3-30 and RN3-31", async () => {
    await mount();
    await fireEvent.press(screen.getByTestId('lookup-chip-ended'));
    expect(screen.getByTestId('lookup-chip-ended').props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByText('4 results')).toBeTruthy();
    expect(rowIds()).toEqual(['lookup-row-maya', 'lookup-row-dev', 'lookup-row-sam', 'lookup-row-lena']); // not "gone"
    // RN3-30 in two pieces: the package moves to the next line whole, never split inside "12-week" (RENEWAL3 L2's nowrap span).
    const line = (id: string) => within(screen.getByTestId(`lookup-line-${id}`)).getAllByText(/./).map((t) => t.props.children);
    expect([line('maya'), line('sam'), line('lena')]).toEqual([
      ['Plan ended today ·', '12-week block'], ['Plan ended 1 day ago ·', 'Monthly coaching'], ['Plan ended 3 days ago ·', '12-week block'],
    ]);
    expect(screen.getAllByText(/^Messaged /).map((t) => t.props.children)).toEqual(['Messaged Oct 20']); // only where the server says so
    expect(screen.getByTestId('lookup-row-sam').props.accessibilityLabel).toBe('Sam Okafor, Plan ended 1 day ago · Monthly coaching, Messaged Oct 20');
    expect(screen.getByTestId('lookup-row-maya').props.accessibilityLabel).toBe('Maya Ortiz, Plan ended today · 12-week block');
    // Roman's mark takes the bell's place on this filter only.
    expect(screen.queryByTestId('lookup-nudge-maya')).toBeNull();
    expect(screen.getByTestId('lookup-roman-maya').props.accessibilityLabel).toBe('Ask Roman to write to Maya');
    await fireEvent.press(screen.getByTestId('lookup-message-dev'));
    expect(navigate).toHaveBeenLastCalledWith('ClientsStack', { screen: 'ClientMessages', params: { clientId: 'dev', clientName: 'Dev Patel' }, initial: false });
    expect(mockPost).not.toHaveBeenCalled();
  });
  it('narrows with typing, and picking it again leaves the filter', async () => {
    await mount();
    await fireEvent.press(screen.getByTestId('lookup-chip-ended'));
    await fireEvent.changeText(screen.getByTestId('lookup-search'), 'sam');
    expect([screen.getByText('1 result'), rowIds()]).toEqual([expect.anything(), ['lookup-row-sam']]);
    await fireEvent.changeText(screen.getByTestId('lookup-search'), '');
    await fireEvent.press(screen.getByTestId('lookup-chip-ended'));
    expect(screen.queryByText(/results?$/)).toBeNull();
    expect(screen.getByTestId('lookup-everyone')).toBeTruthy();
  });
  it("asks Roman first, on b#1130's draft route, and sends only on Send", async () => {
    await mount();
    await fireEvent.press(screen.getByTestId('lookup-chip-ended'));
    await fireEvent.press(screen.getByTestId('lookup-roman-maya'));
    expect(screen.getByText('Ask Roman to write to Maya?')).toBeTruthy();
    expect(within(screen.getByTestId('home-draft-about-line')).getAllByText(/./).map((t) => t.props.children)).toEqual(['Plan ended today ·', '12-week block']); // RN3-34, package kept whole
    expect(mockPost).not.toHaveBeenCalled();
    await act(async () => { fireEvent.press(screen.getByTestId('home-draft-ask')); });
    expect(mockPost).toHaveBeenCalledWith('/v1/coach/churned-clients/maya/draft', {});
    await waitFor(() => expect(screen.getByTestId('home-draft-text').props.children).toBe('Hi Maya, how did the block feel?'));
    expect(mockApprove).not.toHaveBeenCalled();
    const before = churnReads();
    await act(async () => { fireEvent.press(screen.getByTestId('home-draft-send')); });
    expect(mockApprove).toHaveBeenCalledWith('dr-9');
    await waitFor(() => expect(churnReads()).toBe(before + 1)); // "Messaged" comes from the re-read
  });
});

describe('L3: nobody in it', () => {
  it('shows 0 and the drawn empty state, and Clear search leaves the filter', async () => {
    churned = () => Promise.resolve({ data: page([]) });
    await mount();
    expect(screen.getByTestId('lookup-chip-ended').props.accessibilityLabel).toBe('Plan ended last 7 days, 0');
    await fireEvent.press(screen.getByTestId('lookup-chip-ended'));
    expect([screen.getByText('0 results'), screen.getByText('No results')]).toBeTruthy();
    await fireEvent.press(screen.getByTestId('stub-clear'));
    expect(screen.getByTestId('lookup-chip-ended').props.accessibilityState).toEqual({ selected: false });
    expect(screen.getByTestId('lookup-everyone')).toBeTruthy();
  });
});

describe('L1-L2: the count and the list agree (LO C1)', () => {
  it('counts what it lists when every server row is on this roster', async () => {
    churned = () => Promise.resolve({ data: page(ROWS.filter((r) => r.client_id !== 'gone')) });
    await mount();
    expect(screen.getByTestId('lookup-chip-ended').props.accessibilityLabel).toBe('Plan ended last 7 days, 4');
    await fireEvent.press(screen.getByTestId('lookup-chip-ended'));
    expect([screen.getByText('4 results'), rowIds().length]).toEqual([expect.anything(), 4]);
  });
});

describe('L1: no read where the chip cannot show (LO C3)', () => {
  it('does not read the list for a roster under 15', async () => {
    mockGetClients.mockImplementation(async (status: string) => ({ data: status === 'archived' ? [] : ROSTER.slice(0, 5) }));
    await mount();
    expect([screen.queryByTestId('lookup-chip-ended'), churnReads()]).toEqual([null, 0]);
    await refresh();
    expect(churnReads()).toBe(0);
  });
});

describe('L2: blocked clients never show (b#1141; owner: hide all messaging)', () => {
  afterEach(() => act(() => { useBlockedUsersStore.setState({ blocked: [] }); }));
  it('leaves out a client this coach blocked, with no Message or Ask Roman; the others stay (control)', async () => {
    await mount();
    await act(() => { useBlockedUsersStore.setState({ blocked: [{ id: 'maya', displayName: 'Maya Ortiz', role: 'client', blockedAt: '2026-10-21T10:00:00Z' }] }); });
    expect(screen.getByTestId('lookup-chip-ended').props.accessibilityLabel).toBe('Plan ended last 7 days, 6');
    await fireEvent.press(screen.getByTestId('lookup-chip-ended'));
    expect(rowIds()).toEqual(['lookup-row-dev', 'lookup-row-sam', 'lookup-row-lena']);
    expect([screen.queryByTestId('lookup-message-maya'), screen.queryByTestId('lookup-roman-maya')]).toEqual([null, null]);
    expect([screen.getByTestId('lookup-message-dev'), screen.getByTestId('lookup-roman-dev')].every(Boolean)).toBe(true);
  });
  it('on a cold start, leaves out a client GET /users/blocks names before any chat screen has read the list (LO B1)', async () => {
    await act(() => { useBlockedUsersStore.setState({ blocked: [], hydrated: false, userId: null }); }); // app start
    const base = mockGet.getMockImplementation()!;
    mockGet.mockImplementation((url: string, cfg: { params: { cursor?: string } }) => (url === '/users/blocks'
      ? Promise.resolve({ data: { blocked: [{ blockedId: 'maya', displayName: 'Maya Ortiz', blockedAt: '2026-10-21T10:00:00Z' }] } })
      : base(url, cfg)));
    await mount();
    await waitFor(() => expect(screen.getByTestId('lookup-chip-ended').props.accessibilityLabel).toBe('Plan ended last 7 days, 6'));
    await fireEvent.press(screen.getByTestId('lookup-chip-ended'));
    expect(rowIds()).toEqual(['lookup-row-dev', 'lookup-row-sam', 'lookup-row-lena']);
    expect([screen.queryByTestId('lookup-message-maya'), screen.queryByTestId('lookup-roman-maya')]).toEqual([null, null]);
  });
  it('re-reads when the draft route says the client is gone (404), and sends nothing', async () => {
    await mount();
    await fireEvent.press(screen.getByTestId('lookup-chip-ended'));
    await fireEvent.press(screen.getByTestId('lookup-roman-maya'));
    mockPost.mockRejectedValueOnce(Object.assign(new Error('404'), { response: { status: 404, data: { code: 'CHURNED_CLIENT_NOT_FOUND' } } }));
    churned = () => Promise.resolve({ data: page(ROWS.slice(1), { total: 6 }) });
    const before = churnReads();
    await act(async () => { fireEvent.press(screen.getByTestId('home-draft-ask')); });
    await waitFor(() => expect(screen.getByText("Roman can't write this right now. Nothing was sent.")).toBeTruthy());
    expect(screen.queryByTestId('home-draft-ask')).toBeNull(); // only Not now: a second ask gets the same 404 (LO C2)
    await waitFor(() => expect(churnReads()).toBe(before + 1));
    expect(mockApprove).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('home-draft-close'));
    await waitFor(() => expect(screen.queryByTestId('lookup-row-maya')).toBeNull());
  });
});

describe("L2: Roman's mark (RENEWAL3 L2, Sol B2)", () => {
  it('puts the deep disc, gold ring and gold serif R on the row button, hidden from screen readers', async () => {
    await mount();
    await fireEvent.press(screen.getByTestId('lookup-chip-ended'));
    const mark = within(screen.getByTestId('lookup-roman-maya')).getByTestId('roman-mark', { includeHiddenElements: true });
    expect(mark.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(within(mark).getByText('R', { includeHiddenElements: true })).toBeTruthy();
    await fireEvent.press(screen.getByTestId('lookup-roman-maya'));
    expect(within(screen.getByTestId('home-draft-head')).getByTestId('roman-mark', { includeHiddenElements: true })).toBeTruthy(); // K3a's head
  });
});
